/**
 * @file system-prompts.service.ts
 *
 * Owns the core-managed, provider-neutral system prompts injected into every AI
 * query: one always-on `master` prompt (may be blank) plus any number of
 * audience-scoped `additional` prompts. The composed result is handed to the
 * active provider through `IAiQueryOptions.injectedSystemPrompt`, where it sits
 * after the provider's security clause and before the provider's own
 * `config.systemPrompt` — the two coexist rather than one replacing the other.
 *
 * Storage mirrors the prompt-variable registry's dual-backing: the master is a
 * singleton in the core `_kv` store, the additional prompts are one document per
 * prompt in `module_ai-tools_system-prompts`. Audience matching is OR across two
 * filters — the querying user is in `userIds` (any-of), OR is a member of every
 * group in `groups` (all-of). Variable expansion reuses the core
 * `'prompt-variables'` registry so a prompt can interpolate `{%name%}` tokens,
 * and core expands its own composed prompt so any provider transport injects it
 * verbatim.
 */

import { randomUUID } from 'node:crypto';
import type { IDatabaseService, IToolEndUserPrincipal } from '@/types';
import type { PromptVariableRegistry } from './prompt-variable-registry.js';

/** Collection owned by this module (manual `module_<id>_` prefix), one doc per additional prompt. */
const COLLECTION = 'module_ai-tools_system-prompts';

/** Core `_kv` key (manually namespaced) holding the singleton master prompt. */
const MASTER_KEY = 'ai-tools:system-prompt-master';

/** Persisted shape under {@link MASTER_KEY}. */
interface IMasterValue {
    content: string;
}

/**
 * One audience-scoped additional system prompt. `userIds` is any-of (the user
 * matches if listed); `groups` is all-of (the user matches only if a member of
 * every listed group); the two filters combine with OR.
 */
export interface ISystemPromptDoc {
    /** Stable id (uuid). */
    id: string;
    /** Admin-facing label. */
    name: string;
    /** Prompt body; may contain `{%name%}` variable tokens. */
    content: string;
    /** Better Auth user ids this prompt targets (any-of). Empty = not targeted by user. */
    userIds: string[];
    /** Group ids this prompt targets (all-of). Empty = not targeted by group. */
    groups: string[];
    /** Whether the prompt participates in injection. */
    enabled: boolean;
    /** Ascending concatenation order among matching prompts. */
    order: number;
    /** ISO create timestamp. */
    createdAt: string;
    /** ISO last-update timestamp. */
    updatedAt: string;
}

/** Input shape for creating an additional prompt. */
export interface ISystemPromptCreate {
    name: string;
    content: string;
    userIds?: unknown;
    groups?: unknown;
    enabled?: unknown;
    order?: unknown;
}

/** Input shape for updating an additional prompt; omitted fields are preserved. */
export interface ISystemPromptUpdate {
    name?: unknown;
    content?: unknown;
    userIds?: unknown;
    groups?: unknown;
    enabled?: unknown;
    order?: unknown;
}

/**
 * Base class for caller-actionable validation errors. Route handlers map these
 * directly to HTTP status codes; everything else bubbles to a 500.
 */
export class SystemPromptValidationError extends Error {
    constructor(message: string, public readonly statusCode: number = 400) {
        super(message);
        this.name = 'SystemPromptValidationError';
    }
}

/** Thrown when an id-bearing operation cannot find the target prompt. */
export class SystemPromptNotFoundError extends SystemPromptValidationError {
    constructor() {
        super('System prompt not found', 404);
        this.name = 'SystemPromptNotFoundError';
    }
}

/**
 * Service owning the master prompt singleton and the additional-prompt
 * collection, plus the per-query composition that feeds
 * `IAiQueryOptions.injectedSystemPrompt`.
 *
 * Internal to the ai-tools module — consumed only by the in-process query
 * controller and scheduled-prompts runner, so it is not published on the service
 * registry.
 */
export class SystemPromptsService {
    /**
     * @param database - Core database for the master KV value and the prompts collection.
     * @param promptVariables - Registry used to expand `{%name%}` tokens in the composed prompt.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly promptVariables: PromptVariableRegistry
    ) {}

    /**
     * Ensure the unique id index and the order sort index exist. Idempotent;
     * called during module `init()`.
     *
     * @returns Resolves once the indexes are present.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { id: 1 }, { unique: true });
        await this.database.createIndex(COLLECTION, { order: 1 });
    }

    /**
     * Read the master prompt body.
     *
     * @returns The master content, or `''` when never set.
     */
    async getMaster(): Promise<string> {
        const value = await this.database.get<IMasterValue>(MASTER_KEY);
        return typeof value?.content === 'string' ? value.content : '';
    }

    /**
     * Replace the master prompt body. A blank string is valid — it disables the
     * master's contribution without deleting the concept.
     *
     * @param content - The new master body.
     * @returns Resolves once stored.
     */
    async setMaster(content: string): Promise<void> {
        if (typeof content !== 'string') {
            throw new SystemPromptValidationError('content must be a string');
        }
        await this.database.set<IMasterValue>(MASTER_KEY, { content });
    }

    /**
     * List every additional prompt, ascending by `order` then `createdAt`.
     *
     * @returns All additional prompts.
     */
    async list(): Promise<ISystemPromptDoc[]> {
        const collection = this.database.getCollection<ISystemPromptDoc>(COLLECTION);
        const docs = await collection.find({}).sort({ order: 1, createdAt: 1 }).toArray();
        return docs.map(stripMongoId);
    }

    /**
     * Create an additional prompt. Requires a name, a non-empty body, and at
     * least one audience filter (a both-empty prompt would match no one — the
     * master already covers everyone).
     *
     * @param input - The prompt fields to create.
     * @returns The created prompt.
     */
    async createAdditional(input: ISystemPromptCreate): Promise<ISystemPromptDoc> {
        const name = assertNonEmptyString(input.name, 'name');
        const content = assertNonEmptyString(input.content, 'content');
        const userIds = normalizeIdArray(input.userIds, 'userIds');
        const groups = normalizeIdArray(input.groups, 'groups');
        assertAudience(userIds, groups);
        const enabled = normalizeEnabled(input.enabled);
        const order = normalizeOrder(input.order);

        const now = new Date().toISOString();
        const created: ISystemPromptDoc = {
            id: randomUUID(),
            name,
            content,
            userIds,
            groups,
            enabled,
            order,
            createdAt: now,
            updatedAt: now
        };

        const collection = this.database.getCollection<ISystemPromptDoc>(COLLECTION);
        await collection.insertOne({ ...created });
        return created;
    }

    /**
     * Update an additional prompt by id. Omitted fields keep their existing
     * values; the both-empty audience rule is re-checked against the merged
     * result so an update cannot strand a prompt with no audience.
     *
     * @param id - The prompt id.
     * @param patch - The fields to change.
     * @returns The updated prompt.
     */
    async updateAdditional(id: string, patch: ISystemPromptUpdate): Promise<ISystemPromptDoc> {
        const existing = await this.get(id);
        if (!existing) {
            throw new SystemPromptNotFoundError();
        }

        const setFields: Partial<ISystemPromptDoc> = { updatedAt: new Date().toISOString() };
        if (patch.name !== undefined) {
            setFields.name = assertNonEmptyString(patch.name, 'name');
        }
        if (patch.content !== undefined) {
            setFields.content = assertNonEmptyString(patch.content, 'content');
        }
        if (patch.userIds !== undefined) {
            setFields.userIds = normalizeIdArray(patch.userIds, 'userIds');
        }
        if (patch.groups !== undefined) {
            setFields.groups = normalizeIdArray(patch.groups, 'groups');
        }
        if (patch.enabled !== undefined) {
            setFields.enabled = normalizeEnabled(patch.enabled);
        }
        if (patch.order !== undefined) {
            setFields.order = normalizeOrder(patch.order);
        }

        // Re-validate the audience against the post-update shape: a patch that
        // clears the only populated filter must be rejected, not silently saved.
        assertAudience(
            setFields.userIds ?? existing.userIds,
            setFields.groups ?? existing.groups
        );

        const collection = this.database.getCollection<ISystemPromptDoc>(COLLECTION);
        const updated = await collection.findOneAndUpdate(
            { id: String(id) },
            { $set: setFields },
            { returnDocument: 'after' }
        ) as ISystemPromptDoc | null;

        if (!updated) {
            // Disappeared mid-update — caller raced a delete.
            throw new SystemPromptNotFoundError();
        }
        return stripMongoId(updated as unknown as Record<string, unknown>);
    }

    /**
     * Delete an additional prompt by id.
     *
     * @param id - The prompt id.
     * @returns `true` if a document was removed, `false` if no such id existed.
     */
    async deleteAdditional(id: string): Promise<boolean> {
        const collection = this.database.getCollection<ISystemPromptDoc>(COLLECTION);
        const result = await collection.deleteOne({ id: String(id) });
        return (result?.deletedCount ?? 0) > 0;
    }

    /**
     * Compose the core-injected system prompt for a principal: the master prompt
     * first, then each enabled additional prompt whose audience matches, ordered
     * by `order`, joined with blank lines and `{%name%}`-expanded. Returns `''`
     * when nothing applies, so the provider injects nothing.
     *
     * Audience match (per additional prompt): the principal's id is in `userIds`
     * (any-of), OR the principal is a member of every group in `groups` (all-of).
     * A `null` principal (a purely programmatic call) matches no additional
     * prompt; the master still applies.
     *
     * @param principal - The end user the query runs on behalf of, or null.
     * @returns The composed, variable-expanded prompt, or `''`.
     */
    async compose(principal?: IToolEndUserPrincipal | null): Promise<string> {
        const segments: string[] = [];

        const master = (await this.getMaster()).trim();
        if (master) {
            segments.push(master);
        }

        const additional = await this.list();
        for (const prompt of additional) {
            if (!prompt.enabled) {
                continue;
            }
            if (matchesAudience(prompt, principal)) {
                const body = prompt.content.trim();
                if (body) {
                    segments.push(body);
                }
            }
        }

        if (segments.length === 0) {
            return '';
        }

        const combined = segments.join('\n\n');
        return this.promptVariables.expandAll(combined);
    }

    /**
     * Look up a single additional prompt by id.
     *
     * @param id - The prompt id.
     * @returns The prompt, or `null` if not found.
     */
    private async get(id: string): Promise<ISystemPromptDoc | null> {
        const collection = this.database.getCollection<ISystemPromptDoc>(COLLECTION);
        const doc = await collection.findOne({ id: String(id) });
        return doc ? stripMongoId(doc) : null;
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Decide whether an additional prompt applies to a principal: id any-of OR group
 * all-of. A null principal never matches an additional prompt.
 *
 * @param prompt - The additional prompt.
 * @param principal - The end-user principal, or null.
 * @returns Whether the prompt should be injected for this principal.
 */
function matchesAudience(prompt: ISystemPromptDoc, principal?: IToolEndUserPrincipal | null): boolean {
    if (!principal) {
        return false;
    }
    if (prompt.userIds.length > 0 && prompt.userIds.includes(principal.userId)) {
        return true;
    }
    const memberOf = principal.groups ?? [];
    if (prompt.groups.length > 0 && prompt.groups.every(group => memberOf.includes(group))) {
        return true;
    }
    return false;
}

/**
 * Mongo includes the driver-assigned `_id` on every read. The published
 * {@link ISystemPromptDoc} shape doesn't include it, so strip it before
 * returning to callers.
 *
 * @param doc - The raw Mongo document.
 * @returns The document without `_id`.
 */
function stripMongoId<T extends Record<string, unknown>>(doc: T): ISystemPromptDoc {
    const cleaned = { ...doc };
    delete (cleaned as Record<string, unknown>)._id;
    return cleaned as unknown as ISystemPromptDoc;
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
        throw new SystemPromptValidationError(`${field} is required`);
    }
    return value.trim();
}

/**
 * Normalize an optional id-list input to an array of trimmed, de-duplicated,
 * non-empty strings. Rejects a non-array, non-undefined value.
 *
 * @param value - The candidate value.
 * @param field - Field name for the error message.
 * @returns The cleaned id array (empty when omitted).
 */
function normalizeIdArray(value: unknown, field: string): string[] {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new SystemPromptValidationError(`${field} must be an array of strings`);
    }
    const cleaned: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') {
            throw new SystemPromptValidationError(`${field} must contain only strings`);
        }
        const trimmed = entry.trim();
        if (trimmed && !cleaned.includes(trimmed)) {
            cleaned.push(trimmed);
        }
    }
    return cleaned;
}

/**
 * Assert an additional prompt targets at least one audience. A prompt with both
 * filters empty would match no one — the master already covers everyone.
 *
 * @param userIds - The cleaned user-id filter.
 * @param groups - The cleaned group filter.
 */
function assertAudience(userIds: string[], groups: string[]): void {
    if (userIds.length === 0 && groups.length === 0) {
        throw new SystemPromptValidationError(
            'An additional system prompt must target at least one user id or group'
        );
    }
}

/**
 * Validate the optional `enabled` flag, defaulting to `true`.
 *
 * @param value - The candidate value.
 * @returns The boolean enabled flag.
 */
function normalizeEnabled(value: unknown): boolean {
    if (value === undefined) {
        return true;
    }
    if (typeof value !== 'boolean') {
        throw new SystemPromptValidationError('enabled must be a boolean');
    }
    return value;
}

/**
 * Validate the optional `order` field, defaulting to `0`.
 *
 * @param value - The candidate value.
 * @returns A finite order number.
 */
function normalizeOrder(value: unknown): number {
    if (value === undefined) {
        return 0;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new SystemPromptValidationError('order must be a finite number');
    }
    return value;
}
