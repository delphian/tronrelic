/**
 * @file prompt-variable-registry.ts
 *
 * Core-owned registry of prompt variables — the `{%name%}` tokens expanded into
 * a prompt before it reaches the model. Promoted out of the trp-ai-assistant
 * plugin so one service owns every variable, classification persists across
 * restarts, and the lethal-trifecta detector can see when a `secret` variable is
 * in play (the private-data ingress the tool-scoped trifecta signal historically
 * could not model).
 *
 * Two kinds coexist behind one registry, following the Menu module's
 * dual-backing pattern (code-registered + DB-persisted in one service):
 *  - `dynamic` — code-registered resolvers (a provider plugin or core module
 *    registers them every boot through the service-registry watch). Held in
 *    memory only; admins may classify them but cannot edit or delete them.
 *  - `static` — admin-authored constant strings persisted one document per
 *    variable in `module_ai-tools_variables`; full CRUD from the admin UI.
 *
 * Classification: a static variable stores its sensitivity on the document; a
 * dynamic variable carries a code-declared default that an admin override (in
 * the core `_kv` store) can tighten or relax. A new static variable defaults to
 * `secret` (fail-safe — its pasted content is unknown).
 */

import type {
    AiToolSensitivity,
    IDatabaseService,
    IExpandedPromptVariable,
    IPromptVariableDefinition,
    IPromptVariableInfo,
    IPromptVariableRegistry,
    IStaticPromptVariable,
    IStaticPromptVariableInput,
    IStaticPromptVariableUpdate,
    ISystemLogService
} from '@/types';

/** Collection owned by this module (manual `module_<id>_` prefix), one doc per static variable. */
const COLLECTION = 'module_ai-tools_variables';

/** Core `_kv` key (manually namespaced) for admin classification overrides on dynamic variables. */
const CLASSIFICATIONS_KEY = 'ai-tools:variable-classifications';

/**
 * Matches every `{%name%}` reference in a prompt. Kept identical to the legacy
 * plugin pattern so existing prompts (which may use `:,./` in names) still
 * expand after the registry moved to core.
 */
const VARIABLE_PATTERN = /\{%([a-zA-Z0-9_:,./-]+)%\}/g;

/** Allowed shape for an admin-created variable name (lowercase kebab). */
const VARIABLE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Sensitivity assumed for a dynamic variable that declares no default and has no override. */
const DEFAULT_DYNAMIC_SENSITIVITY: AiToolSensitivity = 'internal';

/** Persisted shape under {@link CLASSIFICATIONS_KEY}: variable name → admin-set sensitivity. */
type Classifications = Record<string, AiToolSensitivity>;

/** Base class for caller-actionable validation errors; handlers map these to status codes. */
export class PromptVariableValidationError extends Error {
    constructor(message: string, public readonly statusCode: number = 400) {
        super(message);
        this.name = 'PromptVariableValidationError';
    }
}

/** Thrown when an operation targets a variable name that does not exist. */
export class PromptVariableNotFoundError extends PromptVariableValidationError {
    constructor() {
        super('Variable not found', 404);
        this.name = 'PromptVariableNotFoundError';
    }
}

/** Thrown when a create would collide with an existing variable name. */
export class DuplicateVariableNameError extends PromptVariableValidationError {
    constructor(message = 'A variable with that name already exists') {
        super(message, 409);
        this.name = 'DuplicateVariableNameError';
    }
}

/** A registered dynamic variable plus the provider that registered it. */
interface DynamicEntry {
    definition: IPromptVariableDefinition;
    providerId: string;
}

/**
 * Core registry holding code-registered dynamic variables and DB-persisted
 * static variables behind the `'prompt-variables'` service.
 */
export class PromptVariableRegistry implements IPromptVariableRegistry {
    /** Code-registered dynamic variables, keyed by name (memory only). */
    private readonly dynamic = new Map<string, DynamicEntry>();

    /** Admin-authored static variables mirrored from the collection, keyed by name. */
    private readonly statics = new Map<string, IStaticPromptVariable>();

    /** Admin sensitivity overrides for dynamic variables, mirrored from `_kv`. */
    private classifications: Classifications = {};

    /**
     * @param logger - Module-scoped logger for diagnostics.
     * @param database - Core database for static persistence and the override KV.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {}

    /**
     * Ensure the unique index on the static collection and hydrate both the
     * static variables and the dynamic classification overrides into memory.
     * Idempotent; call once during module `init()` before any provider registers.
     *
     * @returns Resolves once storage is loaded.
     */
    async load(): Promise<void> {
        await this.database.createIndex(COLLECTION, { name: 1 }, { unique: true });

        const collection = this.database.getCollection<IStaticPromptVariable>(COLLECTION);
        const docs = await collection.find({}).toArray();
        this.statics.clear();
        for (const doc of docs) {
            const cleaned = stripMongoId(doc);
            this.statics.set(cleaned.name, cleaned);
        }

        this.classifications = (await this.database.get<Classifications>(CLASSIFICATIONS_KEY)) ?? {};

        this.logger.info(
            { statics: this.statics.size, overrides: Object.keys(this.classifications).length },
            'Prompt variable registry loaded'
        );
    }

    /** @inheritdoc */
    registerVariable(definition: IPromptVariableDefinition, providerId: string = 'unknown'): void {
        // Name collisions across kinds are not allowed in either direction:
        // `createStatic` already rejects a static that shadows a dynamic, and
        // here a dynamic is refused when an admin static already owns the name.
        // Letting a plugin-registered dynamic take a name an admin authored as a
        // static would let plugin code masquerade as / silently replace the
        // admin's variable — a security boundary, not a mere ambiguity. The
        // pre-existing static stays authoritative; the colliding registration is
        // dropped with a loud error rather than throwing, so a sibling variable
        // in the same batch still registers.
        if (this.statics.has(definition.name)) {
            this.logger.error(
                { variable: definition.name, provider: providerId },
                `Dynamic variable "${definition.name}" rejected: an admin static variable already owns that name`
            );
            return;
        }
        this.dynamic.set(definition.name, { definition, providerId });
        this.logger.info({ variable: definition.name, provider: providerId }, `Prompt variable registered: ${definition.name}`);
    }

    /** @inheritdoc */
    unregisterVariable(name: string): boolean {
        const removed = this.dynamic.delete(name);
        if (removed) {
            this.logger.info({ variable: name }, `Prompt variable unregistered: ${name}`);
        }
        return removed;
    }

    /** @inheritdoc */
    async resolve(name: string): Promise<string> {
        const entry = this.dynamic.get(name);
        if (entry) {
            try {
                return await entry.definition.resolve();
            } catch (err) {
                throw new Error(`Failed to resolve prompt variable {%${name}%}: ${(err as Error).message}`);
            }
        }
        const stat = this.statics.get(name);
        if (stat) {
            return stat.content;
        }
        throw new Error(`Unknown prompt variable: {%${name}%}`);
    }

    /** @inheritdoc */
    async expandAll(text: string): Promise<string> {
        const { expanded } = await this.expandWithMetadata(text);
        return expanded;
    }

    /** @inheritdoc */
    async expandWithMetadata(text: string): Promise<{ expanded: string; variables: IExpandedPromptVariable[] }> {
        const matches = [...text.matchAll(VARIABLE_PATTERN)];
        if (matches.length === 0) {
            return { expanded: text, variables: [] };
        }

        const uniqueNames = [...new Set(matches.map(match => match[1]))];
        const resolved = new Map<string, string>();
        await Promise.all(uniqueNames.map(async (name) => {
            resolved.set(name, await this.resolve(name));
        }));

        const variables: IExpandedPromptVariable[] = uniqueNames.map(name => ({
            name,
            pattern: `{%${name}%}`,
            sizeBytes: Buffer.byteLength(resolved.get(name) ?? '', 'utf-8')
        }));

        const expanded = text.replace(VARIABLE_PATTERN, (match, name) => resolved.get(name) ?? match);
        return { expanded, variables };
    }

    /** @inheritdoc */
    async listInfo(): Promise<IPromptVariableInfo[]> {
        // Resolve dynamic sizes concurrently — each resolver may hit a service or
        // the DB, so awaiting them one at a time in a loop serializes I/O the
        // panel does not need serialized.
        const dynamicInfos = await Promise.all(
            [...this.dynamic.entries()].map(([name, entry]) => this.buildDynamicInfo(name, entry))
        );
        const staticInfos = [...this.statics.values()].map(stat => this.buildStaticInfo(stat));

        const infos = [...dynamicInfos, ...staticInfos];
        infos.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
        return infos;
    }

    /**
     * Build the admin info for one static variable. Includes `content` so the
     * admin edit form can prefill it (omitting it would erase the text on edit).
     *
     * @param stat - The static variable.
     * @returns Its serializable info.
     */
    private buildStaticInfo(stat: IStaticPromptVariable): IPromptVariableInfo {
        return {
            name: stat.name,
            pattern: `{%${stat.name}%}`,
            description: stat.description,
            category: stat.category,
            kind: 'static',
            sensitivity: stat.sensitivity,
            sensitivitySource: 'override',
            editable: true,
            sizeBytes: Buffer.byteLength(stat.content, 'utf-8'),
            content: stat.content
        };
    }

    /**
     * Build the admin info for one dynamic variable, resolving its current size.
     *
     * @param name - Variable name.
     * @param entry - The registered dynamic entry.
     * @returns Its serializable info.
     */
    private async buildDynamicInfo(name: string, entry: DynamicEntry): Promise<IPromptVariableInfo> {
        const { sensitivity, source } = this.dynamicSensitivity(name, entry.definition);
        return {
            name,
            pattern: `{%${name}%}`,
            description: entry.definition.description,
            category: entry.definition.category,
            kind: 'dynamic',
            sensitivity,
            sensitivitySource: source,
            editable: false,
            sizeBytes: await this.safeSize(name)
        };
    }

    /** @inheritdoc */
    async createStatic(input: IStaticPromptVariableInput): Promise<IStaticPromptVariable> {
        const name = assertValidName(input.name);
        const description = assertNonEmptyString(input.description, 'description');
        const category = assertNonEmptyString(input.category, 'category');
        const content = typeof input.content === 'string' ? input.content : '';
        const sensitivity = normalizeSensitivity(input.sensitivity) ?? 'secret';

        if (this.dynamic.has(name)) {
            throw new DuplicateVariableNameError(
                `"${name}" is a built-in (dynamic) variable; choose a different name`
            );
        }
        if (this.statics.has(name)) {
            throw new DuplicateVariableNameError();
        }

        const now = new Date().toISOString();
        const created: IStaticPromptVariable = { name, description, category, sensitivity, content, createdAt: now, updatedAt: now };

        const collection = this.database.getCollection<IStaticPromptVariable>(COLLECTION);
        try {
            await collection.insertOne({ ...created });
        } catch (error: unknown) {
            if ((error as { code?: number } | null)?.code === 11000) {
                throw new DuplicateVariableNameError();
            }
            throw error;
        }

        this.statics.set(name, created);
        this.logger.info({ variable: name, sensitivity }, `Static prompt variable created: ${name}`);
        return created;
    }

    /** @inheritdoc */
    async updateStatic(name: string, patch: IStaticPromptVariableUpdate): Promise<IStaticPromptVariable> {
        const existing = this.statics.get(name);
        if (!existing) {
            throw new PromptVariableNotFoundError();
        }

        const setFields: Partial<IStaticPromptVariable> = { updatedAt: new Date().toISOString() };
        if (patch.description !== undefined) {
            setFields.description = assertNonEmptyString(patch.description, 'description');
        }
        if (patch.category !== undefined) {
            setFields.category = assertNonEmptyString(patch.category, 'category');
        }
        if (patch.content !== undefined) {
            setFields.content = typeof patch.content === 'string' ? patch.content : '';
        }
        if (patch.sensitivity !== undefined) {
            const normalized = normalizeSensitivity(patch.sensitivity);
            if (!normalized) {
                throw new PromptVariableValidationError('Invalid sensitivity');
            }
            setFields.sensitivity = normalized;
        }

        // A static variable is admin-edited (low concurrency), so a field-level
        // `$set` followed by an in-memory merge is sufficient — no need for an
        // atomic read-modify-write. The not-found case is already guarded above
        // by the in-memory lookup.
        const collection = this.database.getCollection<IStaticPromptVariable>(COLLECTION);
        await collection.updateOne({ name: String(name) }, { $set: setFields });

        const updated: IStaticPromptVariable = { ...existing, ...setFields };
        this.statics.set(name, updated);
        return updated;
    }

    /** @inheritdoc */
    async deleteStatic(name: string): Promise<boolean> {
        const collection = this.database.getCollection<IStaticPromptVariable>(COLLECTION);
        const result = await collection.deleteOne({ name: String(name) });
        const removed = (result?.deletedCount ?? 0) > 0;
        if (removed) {
            this.statics.delete(name);
            this.logger.info({ variable: name }, `Static prompt variable deleted: ${name}`);
        }
        return removed;
    }

    /** @inheritdoc */
    async classify(name: string, sensitivity: AiToolSensitivity): Promise<IPromptVariableInfo> {
        const normalized = normalizeSensitivity(sensitivity);
        if (!normalized) {
            throw new PromptVariableValidationError('Invalid sensitivity');
        }

        const stat = this.statics.get(name);
        if (stat) {
            const updated = await this.updateStatic(name, { sensitivity: normalized });
            return this.buildStaticInfo(updated);
        }

        const entry = this.dynamic.get(name);
        if (entry) {
            this.classifications[name] = normalized;
            await this.database.set(CLASSIFICATIONS_KEY, this.classifications);
            this.logger.info({ variable: name, sensitivity: normalized }, `Dynamic variable reclassified: ${name}`);
            // Construct this one variable's info directly — `listInfo()` would
            // resolve the size of every registered variable just to return one.
            return this.buildDynamicInfo(name, entry);
        }

        throw new PromptVariableNotFoundError();
    }

    /** @inheritdoc */
    getSecretVariableNames(): string[] {
        const names: string[] = [];
        for (const [name, entry] of this.dynamic) {
            if (this.dynamicSensitivity(name, entry.definition).sensitivity === 'secret') {
                names.push(name);
            }
        }
        for (const [name, stat] of this.statics) {
            if (stat.sensitivity === 'secret') {
                names.push(name);
            }
        }
        return names;
    }

    /** @inheritdoc */
    secretVariablesIn(text: string): string[] {
        const secret = new Set(this.getSecretVariableNames());
        const referenced = new Set([...text.matchAll(VARIABLE_PATTERN)].map(match => match[1]));
        return [...referenced].filter(name => secret.has(name));
    }

    /**
     * Resolve a dynamic variable's effective sensitivity and where it came from:
     * an admin `override`, the variable's code-`declared` default, or the
     * registry `default`.
     *
     * @param name - Variable name.
     * @param definition - The registered definition.
     * @returns The effective sensitivity and its source.
     */
    private dynamicSensitivity(
        name: string,
        definition: IPromptVariableDefinition
    ): { sensitivity: AiToolSensitivity; source: 'override' | 'declared' | 'default' } {
        const override = this.classifications[name];
        if (override) {
            return { sensitivity: override, source: 'override' };
        }
        if (definition.sensitivity) {
            return { sensitivity: definition.sensitivity, source: 'declared' };
        }
        return { sensitivity: DEFAULT_DYNAMIC_SENSITIVITY, source: 'default' };
    }

    /**
     * Resolve a variable and measure its UTF-8 byte size, tolerating a resolver
     * failure (reported as size 0) so one broken resolver never breaks the panel.
     *
     * @param name - Variable name.
     * @returns Byte size, or 0 when resolution fails.
     */
    private async safeSize(name: string): Promise<number> {
        try {
            return Buffer.byteLength(await this.resolve(name), 'utf-8');
        } catch {
            return 0;
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Strip the driver-assigned `_id` Mongo includes on reads — it is not part of
 * the published {@link IStaticPromptVariable} shape.
 *
 * @param doc - The raw Mongo document.
 * @returns The document without `_id`.
 */
function stripMongoId<T extends Record<string, unknown>>(doc: T): IStaticPromptVariable {
    const cleaned = { ...doc };
    delete (cleaned as Record<string, unknown>)._id;
    return cleaned as unknown as IStaticPromptVariable;
}

/**
 * Assert a value is a non-empty string and return it trimmed.
 *
 * @param value - The candidate value.
 * @param field - Field name for the error message.
 * @returns The trimmed string.
 */
function assertNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new PromptVariableValidationError(`${field} is required`);
    }
    return value.trim();
}

/**
 * Assert a candidate variable name is a valid lowercase-kebab identifier.
 *
 * @param value - The candidate name.
 * @returns The validated name.
 */
function assertValidName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!VARIABLE_NAME_PATTERN.test(name)) {
        throw new PromptVariableValidationError(
            'name must be 1–64 chars, lowercase letters/digits/hyphens/underscores, starting alphanumeric'
        );
    }
    return name;
}

/**
 * Normalize a sensitivity value to the known set, or `null` when unrecognised.
 *
 * @param value - The candidate sensitivity.
 * @returns The validated sensitivity, or `null`.
 */
function normalizeSensitivity(value: unknown): AiToolSensitivity | null {
    return value === 'public' || value === 'internal' || value === 'secret' ? value : null;
}
