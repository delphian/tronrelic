/**
 * @file saved-prompts.service.ts
 *
 * Owns saved prompt templates for the core AI Tools module: a durable,
 * provider-independent library of named prompt bodies, each optionally carrying
 * autonomous triggers — cron schedules and hook bindings — in a unified
 * `triggers[]` array. Prompts live in the `module_ai-tools_prompts` collection,
 * one document per prompt keyed by `id`, so concurrent admin edits and the
 * runner's per-trigger bookkeeping write never clobber each other — every write
 * is a field-level atomic Mongo operation, with trigger bookkeeping addressed
 * by trigger id via array-filtered updates.
 *
 * The service owns validation (cron syntax, declared-hook binding, name
 * uniqueness, type checks) and exposes typed errors so HTTP handlers map them
 * to status codes without re-implementing the rules. The pre-triggers flat
 * `cron`/`scheduleEnabled` schema is folded into `triggers[]` by migration
 * `module:ai-tools:001_saved_prompt_triggers`.
 */

import { randomUUID } from 'node:crypto';
import cronParser from 'cron-parser';
import type {
    IDatabaseService,
    ISavedPrompt,
    ISavedPromptTrigger,
    ISavedPromptCronTrigger
} from '@/types';

const { parseExpression } = cronParser;

/** Collection name owned by this module (manual `module_<id>_` prefix). */
const COLLECTION = 'module_ai-tools_prompts';

/**
 * Consecutive failed runs of one trigger after which that trigger auto-pauses.
 * A systematically broken prompt (invalid variable, unset model) would
 * otherwise refail on every firing forever, spamming logs and burning nothing
 * but operator attention. The admin re-enables after fixing the cause. Scoped
 * per trigger, so a broken hook binding never pauses a healthy cron sibling.
 */
export const SCHEDULE_FAILURE_DISABLE_THRESHOLD = 5;

/**
 * Base class for caller-actionable validation errors. Route handlers map these
 * directly to HTTP status codes; everything else bubbles to a 500.
 */
export class SavedPromptValidationError extends Error {
    constructor(message: string, public readonly statusCode: number = 400) {
        super(message);
        this.name = 'SavedPromptValidationError';
    }
}

/** Thrown when a create/update would collide with an existing prompt name. */
export class DuplicatePromptNameError extends SavedPromptValidationError {
    constructor() {
        super('A prompt with that name already exists', 409);
        this.name = 'DuplicatePromptNameError';
    }
}

/** Thrown when an id-bearing operation cannot find the target prompt. */
export class SavedPromptNotFoundError extends SavedPromptValidationError {
    constructor() {
        super('Prompt not found', 404);
        this.name = 'SavedPromptNotFoundError';
    }
}

/**
 * Editor-supplied shape of one trigger element. The service normalizes it:
 * a missing `id` gets a fresh UUID (a supplied id preserves that element's run
 * bookkeeping across saves), `enabled` defaults to true, and kind-specific
 * fields are validated (`cron` syntax, `hookId` against the declared set).
 */
export interface ISavedPromptTriggerInput {
    /** Existing trigger id to preserve bookkeeping, or absent for a new element. */
    id?: string;
    /** Discriminator: a cron schedule or a hook binding. */
    kind: 'cron' | 'hook';
    /** Whether the trigger fires; defaults to true. */
    enabled?: boolean;
    /** Cron expression — required when `kind` is `'cron'`. */
    cron?: string;
    /** Declared hook descriptor id — required when `kind` is `'hook'`. */
    hookId?: string;
    /** Optional content-type filter for hook triggers (fires only on a match). */
    typeIdFilter?: string;
}

/** Input shape for create operations. */
export interface ISavedPromptCreate {
    name: string;
    prompt: string;
    /**
     * Autonomous firing rules. `undefined`/`null` and `[]` all leave the field
     * absent (a manual-only prompt); a non-empty array is normalized (ids
     * assigned, cron anchored to now) and stored.
     */
    triggers?: ISavedPromptTriggerInput[] | null;
    /** Optional provider plugin id this prompt targets (with `model`). */
    providerId?: string;
    /** Optional model id the prompt runs on, within `providerId`'s catalog. */
    model?: string;
    /**
     * Per-prompt tool allowlist, the least-privilege selector an autonomous run
     * passes to the provider. Three-state: `undefined` (omitted) and `null` both
     * run against every enabled tool (field left absent); `[]` runs with no
     * tools; a non-empty list restricts to exactly those names. An array is
     * validated and stored verbatim; any other defined non-array value is
     * rejected with `SavedPromptValidationError`, never silently treated as
     * "all tools".
     */
    toolAllowlist?: string[] | null;
    /**
     * Better Auth user id of the owner — the admin saving the prompt. Captured
     * once at create and never rewritten by an update: it is whose behalf an
     * autonomous run executes on, re-resolved to a live principal at fire time.
     */
    ownerUserId?: string;
    /** Denormalized owner label (email/name) for the admin list view, display-only. */
    ownerLabel?: string;
}

/**
 * Input shape for update operations. All fields optional — omitted fields
 * preserve their existing values. `triggers: null` (or `[]`) clears every
 * trigger; an array replaces the set, with the service preserving run
 * bookkeeping for elements whose `id` matches an existing trigger.
 * `providerId`/`model` set to `null` or `''` clear the model pin (the prompt
 * reverts to running on the active provider's default model).
 */
export interface ISavedPromptUpdate {
    name?: string;
    prompt?: string;
    /**
     * Tri-state: `undefined` preserves the existing triggers; `null` or `[]`
     * clears them (`$unset`); an array replaces the whole set. Replacement is a
     * merge by trigger id — a matching element keeps its `lastRunAt` /
     * `lastRunError` / `failureCount`, a cron element whose expression changed
     * is re-anchored to now with a fresh failure streak, and a re-enabled
     * element (false → true) also resets its streak so the very next failure
     * cannot immediately re-pause it.
     */
    triggers?: ISavedPromptTriggerInput[] | null;
    providerId?: string | null;
    model?: string | null;
    /**
     * Per-prompt tool allowlist. Tri-state on update, mirroring the model pin:
     * `undefined` omits the field (existing value preserved); `null` clears it
     * back to "all enabled tools" (`$unset`, field absent); an array `$set`s it
     * verbatim — `[]` meaning "no tools", a name list meaning that subset. The
     * absent-vs-`[]` distinction is the sharp edge: `null` must not collapse to
     * `[]`, and `[]` must round-trip as `[]` rather than being dropped.
     */
    toolAllowlist?: string[] | null;
}

/** Optional construction knobs for {@link SavedPromptsService}. */
export interface ISavedPromptsServiceOptions {
    /**
     * The set of declared hook descriptor ids a hook trigger may bind to. The
     * module supplies the ids of the central `HOOKS` registry so a prompt can
     * never bind to a seam that does not exist; omitted (tests) means any
     * non-empty `hookId` is accepted.
     */
    knownHookIds?: ReadonlySet<string>;
}

/**
 * Service owning all CRUD and trigger bookkeeping for saved prompts.
 *
 * Every write is an atomic single-document Mongo operation — concurrent admin
 * saves on different prompts, or an admin save concurrent with a runner
 * `recordRunResult`, can never silently clobber each other. Trigger-scoped
 * bookkeeping uses array-filtered updates keyed by trigger id.
 */
export class SavedPromptsService {
    constructor(
        private readonly database: IDatabaseService,
        private readonly options: ISavedPromptsServiceOptions = {}
    ) {}

    /**
     * Ensure the unique indexes on `id` and `name` plus the `updatedAt` sort
     * index exist. Idempotent; called during module `init()`.
     *
     * @returns Resolves once the indexes are present.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { id: 1 }, { unique: true });
        // Case-insensitive unique index on name. Strength 2 makes equality
        // comparisons case-insensitive (and accent-insensitive in Latin
        // locales), matching the application-level `assertNameUnique` regex so
        // the DB enforces the same rule. Without the collation a plain unique
        // index would let "Prompt A" and "prompt a" coexist at the DB level even
        // though the app says they cannot.
        await this.database.createIndex(
            COLLECTION,
            { name: 1 },
            { unique: true, collation: { locale: 'en', strength: 2 } } as Parameters<
                typeof this.database.createIndex
            >[2]
        );
        await this.database.createIndex(COLLECTION, { updatedAt: -1 });
    }

    /**
     * List all prompts, newest-updated first.
     *
     * @returns Every saved prompt.
     */
    async list(): Promise<ISavedPrompt[]> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        const docs = await collection.find({}).sort({ updatedAt: -1 }).toArray();
        return docs.map(stripMongoId);
    }

    /**
     * Look up a single prompt by id.
     *
     * @param id - The prompt id.
     * @returns The prompt, or `null` if not found.
     */
    async get(id: string): Promise<ISavedPrompt | null> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        // Coerce to a primitive string so the query can never carry a Mongo
        // operator object even if a future caller bypasses the controller's
        // type guard — equality-by-id on an admin route, never injectable.
        const doc = await collection.findOne({ id: String(id) });
        return doc ? stripMongoId(doc) : null;
    }

    /**
     * Subset of prompts carrying at least one enabled cron trigger. The
     * scheduler uses this to avoid pulling and filtering the full list every
     * tick.
     *
     * @returns Prompts with an enabled `kind: 'cron'` trigger element.
     */
    async listScheduled(): Promise<ISavedPrompt[]> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        const docs = await collection
            .find({
                triggers: { $elemMatch: { kind: 'cron', enabled: true } }
            } as Record<string, unknown>)
            .toArray();
        return docs.map(stripMongoId);
    }

    /**
     * Subset of prompts carrying at least one enabled hook trigger bound to the
     * given hook id. The module's hook subscription uses this to find every
     * prompt to enqueue when the hook fires.
     *
     * @param hookId - The declared hook descriptor id that fired.
     * @returns Prompts with an enabled `kind: 'hook'` trigger on that hook.
     */
    async listHookBound(hookId: string): Promise<ISavedPrompt[]> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        const docs = await collection
            .find({
                triggers: { $elemMatch: { kind: 'hook', enabled: true, hookId: String(hookId) } }
            } as Record<string, unknown>)
            .toArray();
        return docs.map(stripMongoId);
    }

    /**
     * Create a new prompt. Validates name+prompt non-empty, each trigger
     * element, and name uniqueness.
     *
     * @param input - The prompt fields to create.
     * @returns The created prompt.
     */
    async create(input: ISavedPromptCreate): Promise<ISavedPrompt> {
        const trimmedName = assertNonEmptyString(input.name, 'name');
        const trimmedPrompt = assertNonEmptyString(input.prompt, 'prompt');
        validateToolAllowlist(input.toolAllowlist);

        await assertNameUnique(this.database, trimmedName, null);

        const now = new Date().toISOString();
        const triggers = this.normalizeTriggers(input.triggers, [], now);
        const created: ISavedPrompt = {
            id: randomUUID(),
            name: trimmedName,
            prompt: trimmedPrompt,
            createdAt: now,
            updatedAt: now
        };

        // Attach only a non-empty trigger set: `undefined`, `null`, and `[]`
        // all mean "manual-only prompt" on a fresh document.
        if (triggers && triggers.length > 0) {
            created.triggers = triggers;
        }

        // A model pin is optional and provider-scoped: both fields travel
        // together so an autonomous run can route to the right provider even
        // when it is not the active one. Attach only when both are real strings.
        const providerId = typeof input.providerId === 'string' ? input.providerId.trim() : '';
        const model = typeof input.model === 'string' ? input.model.trim() : '';
        if (providerId) {
            created.providerId = providerId;
        }
        if (model) {
            created.model = model;
        }

        // Tool allowlist: attach only when the caller supplied a real array, so
        // `[]` (no tools) and `[names]` (a subset) persist verbatim while
        // `undefined`/`null` (all tools) leave the field absent. An empty array
        // is a defined value, so the driver's `ignoreUndefined` default never
        // strips it — the sharp edge is handled by the conditional, not the write.
        if (Array.isArray(input.toolAllowlist)) {
            created.toolAllowlist = input.toolAllowlist;
        }

        // Ownership is captured at create and immutable thereafter (no field on
        // ISavedPromptUpdate): it records whose behalf an autonomous run acts on,
        // re-resolved to a live principal at fire time. A service-token save
        // carries no user, so an unowned prompt simply runs with no principal —
        // exactly as an unattended system query does.
        const ownerUserId = typeof input.ownerUserId === 'string' ? input.ownerUserId.trim() : '';
        const ownerLabel = typeof input.ownerLabel === 'string' ? input.ownerLabel.trim() : '';
        if (ownerUserId) {
            created.ownerUserId = ownerUserId;
        }
        if (ownerLabel) {
            created.ownerLabel = ownerLabel;
        }

        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        // The unique-name index is the real guard; assertNameUnique above is a
        // fast path. Two concurrent creates of the same name both pass the
        // pre-check, and the loser is rejected here with a Mongo duplicate-key
        // error (11000). Map that to the same 409 the pre-check raises so the
        // race surfaces as a clean conflict, never a 500.
        try {
            await collection.insertOne(created as ISavedPrompt);
        } catch (error: unknown) {
            if ((error as { code?: number } | null)?.code === 11000) {
                throw new DuplicatePromptNameError();
            }
            throw error;
        }
        // Shape through the same projection every read path uses, so the
        // create response carries the deprecated flat schedule fields too.
        return stripMongoId({ ...created } as unknown as Record<string, unknown>);
    }

    /**
     * Update an existing prompt by id. Omitted fields preserve their existing
     * values; `triggers: null` (or `[]`) clears every trigger.
     *
     * @param id - The prompt id.
     * @param input - The fields to change.
     * @returns The updated prompt.
     */
    async update(id: string, input: ISavedPromptUpdate): Promise<ISavedPrompt> {
        const existing = await this.get(id);
        if (!existing) {
            throw new SavedPromptNotFoundError();
        }

        const trimmedName = input.name !== undefined
            ? assertNonEmptyString(input.name, 'name')
            : undefined;
        const trimmedPrompt = input.prompt !== undefined
            ? assertNonEmptyString(input.prompt, 'prompt')
            : undefined;
        validateToolAllowlist(input.toolAllowlist);

        if (trimmedName !== undefined) {
            await assertNameUnique(this.database, trimmedName, id);
        }

        const setFields: Partial<ISavedPrompt> = {
            updatedAt: new Date().toISOString()
        };
        const unsetFields: Record<string, ''> = {};
        if (trimmedName !== undefined) {
            setFields.name = trimmedName;
        }
        if (trimmedPrompt !== undefined) {
            setFields.prompt = trimmedPrompt;
        }

        // Triggers: `undefined` preserves; `null`/`[]` clears via `$unset`; an
        // array replaces the whole set after a server-side merge that preserves
        // run bookkeeping for id-matched elements and re-anchors edited crons.
        // The editor always sends the whole array, so the merge is what keeps a
        // no-op re-save from wiping `lastRunAt`/`failureCount` or shifting a
        // cron's cadence.
        if (input.triggers !== undefined) {
            const normalized = this.normalizeTriggers(input.triggers, existing.triggers ?? [], setFields.updatedAt as string);
            if (!normalized || normalized.length === 0) {
                unsetFields.triggers = '';
            } else {
                setFields.triggers = normalized;
            }
        }

        // Model pin: a non-empty string sets the field; null or '' clears it via
        // `$unset` (the prompt reverts to the active provider's default model).
        // Absence and cleared carry no distinct meaning, so unset is cleaner
        // than persisting an empty value. providerId and model are independent
        // fields but the editor always sends both together.
        if (input.providerId !== undefined) {
            const trimmed = typeof input.providerId === 'string' ? input.providerId.trim() : '';
            if (trimmed) {
                setFields.providerId = trimmed;
            } else {
                unsetFields.providerId = '';
            }
        }
        if (input.model !== undefined) {
            const trimmed = typeof input.model === 'string' ? input.model.trim() : '';
            if (trimmed) {
                setFields.model = trimmed;
            } else {
                unsetFields.model = '';
            }
        }

        // Tool allowlist: like the model pin, `undefined` omits the field. But
        // unlike the model pin, `[]` is a MEANINGFUL value ("no tools"), not a
        // clear — so only `null` clears (via `$unset`, reverting to all tools),
        // while any array (including `[]`) is `$set` verbatim. This is the edge
        // the sharp comment on ISavedPromptUpdate.toolAllowlist warns about.
        if (input.toolAllowlist !== undefined) {
            if (input.toolAllowlist === null) {
                unsetFields.toolAllowlist = '';
            } else {
                setFields.toolAllowlist = input.toolAllowlist;
            }
        }

        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);

        // Single atomic operation: update + return the post-image in one
        // round-trip. Removes both the previous extra read AND a tiny race
        // window where a concurrent write could have landed between the
        // updateOne and the re-fetch. `$unset` is only included when there is
        // something to clear, since Mongo rejects an empty `$unset`.
        const updateDoc: Record<string, unknown> = { $set: setFields };
        if (Object.keys(unsetFields).length > 0) {
            updateDoc.$unset = unsetFields;
        }

        let updated: ISavedPrompt | null;
        try {
            updated = await collection.findOneAndUpdate(
                // Coerce to a primitive string so the filter can never carry a
                // Mongo operator object — equality-by-id on an admin route,
                // never injectable.
                { id: String(id) },
                updateDoc,
                { returnDocument: 'after' }
            ) as ISavedPrompt | null;
        } catch (error: unknown) {
            // A concurrent rename to the same name loses the race against the
            // unique-name index here (11000); surface it as the same 409 the
            // assertNameUnique pre-check raises, mirroring create().
            if ((error as { code?: number } | null)?.code === 11000) {
                throw new DuplicatePromptNameError();
            }
            throw error;
        }

        if (!updated) {
            // Disappeared mid-update — caller raced a delete.
            throw new SavedPromptNotFoundError();
        }
        return stripMongoId(updated as unknown as Record<string, unknown>);
    }

    /**
     * Delete a prompt by id.
     *
     * @param id - The prompt id.
     * @returns `true` if a document was removed, `false` if no such id existed.
     */
    async delete(id: string): Promise<boolean> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        const result = await collection.deleteOne({ id });
        return (result?.deletedCount ?? 0) > 0;
    }

    /**
     * Record one trigger's run outcome without touching any other field.
     *
     * Uses an array-filtered `$set` addressed by trigger id, so concurrent
     * admin edits to name/prompt/sibling triggers survive unaltered. Silently
     * skips writes when the prompt or trigger was deleted mid-run — the caller
     * must tolerate that race rather than resurrecting the document.
     *
     * @param id - Prompt id.
     * @param triggerId - The trigger element that fired.
     * @param lastRunAt - ISO timestamp the run was claimed at.
     * @param lastRunError - The failure reason, or null on success.
     */
    async recordRunResult(id: string, triggerId: string, lastRunAt: string, lastRunError: string | null): Promise<void> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        await collection.updateOne(
            { id: String(id) },
            {
                $set: {
                    'triggers.$[t].lastRunAt': lastRunAt,
                    'triggers.$[t].lastRunError': lastRunError
                }
            },
            { arrayFilters: [{ 't.id': String(triggerId) }] }
        );
    }

    /**
     * Record one trigger's failed run, incrementing its consecutive-failure
     * streak. When the streak reaches {@link SCHEDULE_FAILURE_DISABLE_THRESHOLD}
     * the trigger is auto-paused (`enabled: false`) and its error banner is
     * annotated so the admin sees why it stopped firing.
     *
     * Field-level array-filtered `$set`/`$inc` so concurrent admin edits
     * survive, same as `recordRunResult`. Silently tolerates a prompt or
     * trigger deleted mid-run.
     *
     * @param id - Prompt id.
     * @param triggerId - The trigger element that fired.
     * @param lastRunAt - ISO timestamp the run was claimed at.
     * @param errorMessage - The failure reason from this run.
     * @returns Whether this failure tripped the auto-pause.
     */
    async recordRunFailure(id: string, triggerId: string, lastRunAt: string, errorMessage: string): Promise<{ disabled: boolean }> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        const updated = await collection.findOneAndUpdate(
            { id: String(id) },
            {
                $set: {
                    'triggers.$[t].lastRunAt': lastRunAt,
                    'triggers.$[t].lastRunError': errorMessage
                },
                $inc: { 'triggers.$[t].failureCount': 1 }
            },
            { arrayFilters: [{ 't.id': String(triggerId) }], returnDocument: 'after' }
        ) as ISavedPrompt | null;

        const trigger = updated?.triggers?.find(t => t.id === triggerId);
        let disabled = false;
        if (
            trigger
            && (trigger.failureCount ?? 0) >= SCHEDULE_FAILURE_DISABLE_THRESHOLD
            && trigger.enabled !== false
        ) {
            await collection.updateOne(
                { id: String(id) },
                {
                    $set: {
                        'triggers.$[t].enabled': false,
                        'triggers.$[t].lastRunError':
                            `${errorMessage} — trigger paused after ` +
                            `${SCHEDULE_FAILURE_DISABLE_THRESHOLD} consecutive failures; ` +
                            'fix the cause and re-enable the trigger'
                    }
                },
                { arrayFilters: [{ 't.id': String(triggerId) }] }
            );
            disabled = true;
        }

        return { disabled };
    }

    /**
     * Reset one trigger's consecutive-failure streak after a successful run, so
     * intermittent failures never accumulate toward the auto-pause.
     *
     * @param id - Prompt id.
     * @param triggerId - The trigger element that fired.
     */
    async resetRunFailures(id: string, triggerId: string): Promise<void> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        await collection.updateOne(
            { id: String(id) },
            { $set: { 'triggers.$[t].failureCount': 0 } },
            { arrayFilters: [{ 't.id': String(triggerId) }] }
        );
    }

    /**
     * Validate and normalize an editor-supplied trigger array against the
     * prompt's existing triggers.
     *
     * The merge preserves run bookkeeping for elements whose id matches an
     * existing trigger, re-anchors a cron whose expression changed (so the
     * runner computes the next occurrence from now instead of firing an old
     * prompt retroactively), and resets the failure streak on re-enable so an
     * auto-paused trigger gets a fresh streak after the admin fixes the cause.
     *
     * @param input - The raw trigger array from create/update input.
     * @param existing - The prompt's current triggers (empty on create).
     * @param now - The write timestamp (createdAt / updatedAt) new anchors take,
     *        so a fresh cron's `anchorAt` equals the document stamp exactly.
     * @returns The normalized triggers, or `null` when input is `null`/`undefined`.
     */
    private normalizeTriggers(
        input: ISavedPromptTriggerInput[] | null | undefined,
        existing: ISavedPromptTrigger[],
        now: string
    ): ISavedPromptTrigger[] | null {
        if (input === undefined || input === null) {
            return null;
        }
        if (!Array.isArray(input)) {
            throw new SavedPromptValidationError('triggers must be an array');
        }
        const byId = new Map(existing.map(t => [t.id, t]));
        const seenIds = new Set<string>();

        const normalized = input.map((raw, index) => {
            if (!raw || typeof raw !== 'object') {
                throw new SavedPromptValidationError(`triggers[${index}] must be an object`);
            }
            if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
                throw new SavedPromptValidationError(`triggers[${index}].enabled must be a boolean`);
            }
            const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : randomUUID();
            if (seenIds.has(id)) {
                throw new SavedPromptValidationError(`triggers[${index}].id duplicates a sibling trigger id`);
            }
            seenIds.add(id);
            const prior = byId.get(id);
            const enabled = raw.enabled !== false;
            // Carry the prior element's bookkeeping forward; a re-enable
            // (false → true) starts a fresh failure streak, otherwise the very
            // next failure would immediately re-pause an auto-paused trigger.
            const reEnabled = prior && prior.enabled === false && enabled;
            const bookkeeping = prior && prior.kind === raw.kind
                ? {
                    lastRunAt: prior.lastRunAt,
                    lastRunError: reEnabled ? null : prior.lastRunError,
                    failureCount: reEnabled ? 0 : prior.failureCount
                }
                : {};

            if (raw.kind === 'cron') {
                const cron = validateCronExpression(raw.cron, index);
                const priorCron = prior && prior.kind === 'cron' ? (prior as ISavedPromptCronTrigger) : null;
                // Re-anchor only when the cron VALUE actually changes (added or
                // rewritten). The runner then computes the next occurrence from
                // now — matching the editor's "Next run" preview — instead of
                // treating an old prompt as overdue; an unchanged expression
                // keeps its anchor so a no-op re-save never shifts the cadence.
                const cronChanged = !priorCron || priorCron.cron !== cron;
                const cronTrigger: ISavedPromptTrigger = {
                    id,
                    kind: 'cron',
                    enabled,
                    cron,
                    anchorAt: cronChanged ? now : priorCron?.anchorAt,
                    ...bookkeeping,
                    ...(cronChanged ? { lastRunError: null, failureCount: 0 } : {})
                };
                return pruneUndefined(cronTrigger);
            }

            if (raw.kind === 'hook') {
                const hookId = typeof raw.hookId === 'string' ? raw.hookId.trim() : '';
                if (!hookId) {
                    throw new SavedPromptValidationError(`triggers[${index}].hookId is required for a hook trigger`);
                }
                // Bindable hooks are limited to declared descriptors, so a
                // prompt can never bind to a seam that does not exist — a typo
                // fails the save instead of silently never firing.
                if (this.options.knownHookIds && !this.options.knownHookIds.has(hookId)) {
                    throw new SavedPromptValidationError(`triggers[${index}].hookId "${hookId}" is not a declared hook`);
                }
                // Fail closed on a malformed filter: silently coercing a
                // defined non-string to '' would broaden a scoped hook prompt
                // into one firing on every event, mirroring the toolAllowlist
                // never-silently-widen rule.
                if (raw.typeIdFilter !== undefined && typeof raw.typeIdFilter !== 'string') {
                    throw new SavedPromptValidationError(`triggers[${index}].typeIdFilter must be a string`);
                }
                const typeIdFilter = typeof raw.typeIdFilter === 'string' ? raw.typeIdFilter.trim() : '';
                // Reset the failure streak and error banner when the binding
                // actually changes (hookId or typeIdFilter added/rewritten),
                // mirroring the cron re-anchor reset — the old streak accrued
                // under a different binding and must not immediately re-pause
                // the newly configured trigger. Coerce prior's filter to ''
                // (absent and empty both mean "no filter") so a no-op re-save
                // of a filterless trigger never counts as a change.
                const priorHook = prior && prior.kind === 'hook' ? prior : null;
                const priorTypeIdFilter = priorHook?.typeIdFilter ?? '';
                const hookChanged = !priorHook
                    || priorHook.hookId !== hookId
                    || priorTypeIdFilter !== typeIdFilter;
                const hookTrigger: ISavedPromptTrigger = {
                    id,
                    kind: 'hook',
                    enabled,
                    hookId,
                    ...(typeIdFilter ? { typeIdFilter } : {}),
                    ...bookkeeping,
                    ...(hookChanged ? { lastRunError: null, failureCount: 0 } : {})
                };
                return pruneUndefined(hookTrigger);
            }

            throw new SavedPromptValidationError(`triggers[${index}].kind must be 'cron' or 'hook'`);
        });

        return normalized;
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Shape a raw Mongo document into the published `ISavedPrompt`: strip the
 * driver-assigned `_id`, then derive the deprecated flat schedule projection
 * (`cron` / `scheduleEnabled` / `lastRunAt` / `lastRunError`) from the first
 * cron trigger. The projection is read-time only — never stored — and exists
 * so the pre-`triggers[]` editor UI keeps working until the chunk-3b editor
 * lands; it is removed with that editor.
 *
 * @param doc - The raw Mongo document.
 * @returns The API-shaped prompt.
 */
function stripMongoId<T extends Record<string, unknown>>(doc: T): ISavedPrompt {
    const cleaned = { ...doc } as Record<string, unknown>;
    delete cleaned._id;
    const prompt = cleaned as unknown as ISavedPrompt;
    const firstCron = prompt.triggers?.find(
        (t): t is ISavedPromptCronTrigger => t.kind === 'cron'
    );
    if (firstCron) {
        prompt.cron = firstCron.cron;
        prompt.scheduleEnabled = firstCron.enabled !== false;
        if (firstCron.lastRunAt !== undefined) {
            prompt.lastRunAt = firstCron.lastRunAt;
        }
        if (firstCron.lastRunError !== undefined) {
            prompt.lastRunError = firstCron.lastRunError;
        }
    }
    return prompt;
}

/**
 * Drop keys whose value is `undefined` so trigger elements persist compact —
 * the Mongo driver would strip them from a top-level `$set` anyway, but these
 * live inside an array value where `undefined` would otherwise serialize as
 * `null` and blur the absent-vs-null distinction the bookkeeping fields carry.
 *
 * @param trigger - The candidate trigger element.
 * @returns The same element without `undefined`-valued keys.
 */
function pruneUndefined(trigger: ISavedPromptTrigger): ISavedPromptTrigger {
    const cleaned = { ...trigger } as Record<string, unknown>;
    for (const key of Object.keys(cleaned)) {
        if (cleaned[key] === undefined) {
            delete cleaned[key];
        }
    }
    return cleaned as unknown as ISavedPromptTrigger;
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
        throw new SavedPromptValidationError(`${field} is required`);
    }
    return value.trim();
}

/**
 * Validate the optional `toolAllowlist` selector. The three legal shapes are
 * `undefined` (omit / all tools), `null` (clear back to all tools), and an array
 * of non-empty strings (`[]` for no tools, a name list for a subset). Anything
 * else — a non-array defined value, an array holding a non-string, a blank /
 * whitespace-only entry, or an entry with leading/trailing whitespace — is
 * rejected so a malformed selector never reaches the governor as a silent
 * "all tools". A blank or padded entry is never a valid tool name
 * (`^[a-zA-Z0-9_-]{1,64}$`) and would fail the whole allowlist at run time,
 * auto-pausing a trigger — so it fails closed here at save instead.
 *
 * @param value - The candidate allowlist from create/update input.
 */
function validateToolAllowlist(value: unknown): void {
    if (value === undefined || value === null) {
        return;
    }
    if (!Array.isArray(value)) {
        throw new SavedPromptValidationError('toolAllowlist must be an array of tool-name strings');
    }
    for (const entry of value) {
        if (typeof entry !== 'string' || !entry.trim()) {
            throw new SavedPromptValidationError('toolAllowlist entries must be non-empty strings');
        }
        if (entry !== entry.trim()) {
            throw new SavedPromptValidationError('toolAllowlist entries must not have leading or trailing whitespace');
        }
    }
}

/**
 * Validate a cron trigger's expression, returning it trimmed.
 *
 * @param input - The raw cron value from the trigger element.
 * @param index - The trigger's index, for the error message.
 * @returns The normalized cron expression.
 */
function validateCronExpression(input: unknown, index: number): string {
    const trimmed = typeof input === 'string' ? input.trim() : '';
    if (!trimmed) {
        throw new SavedPromptValidationError(`triggers[${index}].cron is required for a cron trigger`);
    }
    try {
        parseExpression(trimmed, { tz: 'UTC' });
    } catch {
        throw new SavedPromptValidationError(`triggers[${index}].cron is not a valid cron expression`);
    }
    return trimmed;
}

/**
 * Assert no other prompt already uses `name` (case-insensitive).
 *
 * @param database - Database service.
 * @param name - The candidate name.
 * @param excludeId - Prompt id to exclude (the one being updated), or null.
 */
async function assertNameUnique(
    database: IDatabaseService,
    name: string,
    excludeId: string | null
): Promise<void> {
    const collection = database.getCollection<ISavedPrompt>(COLLECTION);
    const conflict = await collection.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
        ...(excludeId ? { id: { $ne: excludeId } } : {})
    } as Record<string, unknown>);

    if (conflict) {
        throw new DuplicatePromptNameError();
    }
}

/**
 * Escape a string for safe use inside a RegExp.
 *
 * @param value - The raw string.
 * @returns The escaped string.
 */
function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
