/**
 * @file saved-prompts.service.ts
 *
 * Owns saved prompt templates for the core AI Tools module: a durable,
 * provider-independent library of named prompt bodies, each optionally carrying
 * a cron schedule. Prompts live in the `module_ai-tools_prompts` collection,
 * one document per prompt keyed by `id`, so concurrent admin edits and the
 * scheduler's `lastRunAt` write never clobber each other — every write is a
 * field-level atomic Mongo operation.
 *
 * The service owns validation (cron syntax, name uniqueness, type checks) and
 * exposes typed errors so HTTP handlers map them to status codes without
 * re-implementing the rules. Ported from the `trp-ai-assistant` plugin so the
 * feature outlives any single AI provider transport; the legacy KV-array
 * migration the plugin carried is intentionally dropped — core starts fresh.
 */

import { randomUUID } from 'node:crypto';
import cronParser from 'cron-parser';
import type { IDatabaseService, ISavedPrompt } from '@/types';

const { parseExpression } = cronParser;

/** Collection name owned by this module (manual `module_<id>_` prefix). */
const COLLECTION = 'module_ai-tools_prompts';

/**
 * Consecutive scheduled-run failures after which the schedule auto-pauses.
 * A systematically broken prompt (invalid variable, unset model) would
 * otherwise refail every tick forever, spamming logs and burning nothing
 * but operator attention. The admin re-enables after fixing the cause.
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

/** Input shape for create operations. */
export interface ISavedPromptCreate {
    name: string;
    prompt: string;
    cron?: string | null;
    scheduleEnabled?: boolean;
    /** Optional provider plugin id this prompt targets (with `model`). */
    providerId?: string;
    /** Optional model id the prompt runs on, within `providerId`'s catalog. */
    model?: string;
    /**
     * Better Auth user id of the owner — the admin saving the prompt. Captured
     * once at create and never rewritten by an update: it is whose behalf a
     * scheduled run executes on, re-resolved to a live principal at fire time.
     */
    ownerUserId?: string;
    /** Denormalized owner label (email/name) for the admin list view, display-only. */
    ownerLabel?: string;
}

/**
 * Input shape for update operations. All fields optional — omitted fields
 * preserve their existing values. `cron: null` or `''` clears the schedule;
 * `providerId`/`model` set to `null` or `''` clear the model pin (the prompt
 * reverts to running on the active provider's default model).
 */
export interface ISavedPromptUpdate {
    name?: string;
    prompt?: string;
    cron?: string | null;
    scheduleEnabled?: boolean;
    providerId?: string | null;
    model?: string | null;
}

/**
 * Service owning all CRUD and scheduler-bookkeeping for saved prompts.
 *
 * Every write is an atomic single-document Mongo operation — concurrent admin
 * saves on different prompts, or an admin save concurrent with a scheduler
 * `recordRunResult`, can never silently clobber each other.
 */
export class SavedPromptsService {
    constructor(private readonly database: IDatabaseService) {}

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
     * Subset of prompts that have a valid, currently-enabled cron schedule. The
     * scheduler uses this to avoid pulling and filtering the full list every
     * tick.
     *
     * @returns Prompts with a non-empty cron and `scheduleEnabled !== false`.
     */
    async listScheduled(): Promise<ISavedPrompt[]> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        const docs = await collection
            .find({
                cron: { $exists: true, $nin: [null, ''] },
                $or: [{ scheduleEnabled: { $exists: false } }, { scheduleEnabled: true }]
            } as Record<string, unknown>)
            .toArray();
        return docs.map(stripMongoId);
    }

    /**
     * Create a new prompt. Validates name+prompt non-empty, cron syntax,
     * scheduleEnabled type, and name uniqueness.
     *
     * @param input - The prompt fields to create.
     * @returns The created prompt.
     */
    async create(input: ISavedPromptCreate): Promise<ISavedPrompt> {
        const trimmedName = assertNonEmptyString(input.name, 'name');
        const trimmedPrompt = assertNonEmptyString(input.prompt, 'prompt');
        const normalizedCron = validateCron(input.cron);
        validateScheduleEnabled(input.scheduleEnabled);

        await assertNameUnique(this.database, trimmedName, null);

        const now = new Date().toISOString();
        const created: ISavedPrompt = {
            id: randomUUID(),
            name: trimmedName,
            prompt: trimmedPrompt,
            createdAt: now,
            updatedAt: now
        };

        // Only attach cron when the caller supplied a real expression. `null`
        // (explicit clear) and `undefined` (omitted) both leave the field absent
        // on a fresh document.
        if (typeof normalizedCron === 'string') {
            created.cron = normalizedCron;
            created.scheduleEnabled = input.scheduleEnabled !== false;
            // Anchor the schedule at creation so the runner computes the first
            // occurrence from now, never retroactively from an earlier instant.
            created.scheduleAnchorAt = now;
        }

        // A model pin is optional and provider-scoped: both fields travel
        // together so a scheduled run can route to the right provider even when
        // it is not the active one. Attach only when both are real strings.
        const providerId = typeof input.providerId === 'string' ? input.providerId.trim() : '';
        const model = typeof input.model === 'string' ? input.model.trim() : '';
        if (providerId) {
            created.providerId = providerId;
        }
        if (model) {
            created.model = model;
        }

        // Ownership is captured at create and immutable thereafter (no field on
        // ISavedPromptUpdate): it records whose behalf a scheduled run acts on,
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
        return created;
    }

    /**
     * Update an existing prompt by id. Omitted fields preserve their existing
     * values; `cron: null` or `''` clears the schedule.
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
        const normalizedCron = input.cron !== undefined
            ? validateCron(input.cron)
            : undefined;
        validateScheduleEnabled(input.scheduleEnabled);

        if (trimmedName !== undefined) {
            await assertNameUnique(this.database, trimmedName, id);
        }

        const setFields: Partial<ISavedPrompt> = {
            updatedAt: new Date().toISOString()
        };
        if (trimmedName !== undefined) {
            setFields.name = trimmedName;
        }
        if (trimmedPrompt !== undefined) {
            setFields.prompt = trimmedPrompt;
        }
        if (input.cron !== undefined) {
            // validateCron returns `null` for explicit clears (input was `null`
            // or `''`). We must write `null` rather than `undefined` because the
            // Mongo Node driver defaults `ignoreUndefined: true` —
            // `{ $set: { cron: undefined } }` ships as `{ $set: {} }` and the
            // existing cron silently persists. Writing `null` keeps the field
            // present-but-empty, which `listScheduled`'s `$nin: [null, '']`
            // correctly excludes.
            setFields.cron = normalizedCron ?? null;
            // Clearing or rewriting the schedule wipes any stale run-error banner
            // and failure streak so admins don't see misleading state.
            setFields.lastRunError = null;
            setFields.failureCount = 0;
            // Re-anchor only when the cron VALUE actually changes (added or
            // rewritten to a different expression). The runner then computes the
            // next occurrence from now and matches the editor's "Next run"
            // preview, instead of treating an old prompt as overdue and firing on
            // the next tick. Guarding on a real change keeps a pause/resume or a
            // no-op re-save — the editor always sends the cron field — from
            // needlessly shifting the cadence. lastRunAt is left untouched so it
            // stays the genuine last-run timestamp the editor displays.
            if (typeof normalizedCron === 'string' && normalizedCron !== existing.cron) {
                setFields.scheduleAnchorAt = setFields.updatedAt;
            }
        }
        if (input.scheduleEnabled !== undefined) {
            setFields.scheduleEnabled = input.scheduleEnabled;
            // Re-enabling after an auto-pause starts a fresh failure streak;
            // otherwise the very next failure would immediately re-disable.
            if (input.scheduleEnabled === true) {
                setFields.failureCount = 0;
            }
        }

        // Model pin: a non-empty string sets the field; null or '' clears it via
        // `$unset` (the prompt reverts to the active provider's default model).
        // Unlike cron, absence and cleared carry no distinct meaning, so unset is
        // cleaner than persisting an empty value. providerId and model are
        // independent fields but the editor always sends both together.
        const unsetFields: Record<string, ''> = {};
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

        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);

        // Single atomic operation: update + return the post-image in one
        // round-trip. Removes both the previous extra read AND a tiny race
        // window where a concurrent write could have landed between the
        // updateOne and the re-fetch.
        // Combine the field writes with any model-pin clears into one atomic
        // update document. `$unset` is only included when there is something to
        // clear, since Mongo rejects an empty `$unset`.
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
     * Record a scheduled run's outcome without touching any other field.
     *
     * Uses `$set` so concurrent admin edits to name/prompt/cron survive
     * unaltered. Silently skips writes when the prompt was deleted mid-run — the
     * scheduler must tolerate that race rather than resurrecting the document.
     *
     * @param id - Prompt id.
     * @param lastRunAt - ISO timestamp the run was claimed at.
     * @param lastRunError - The failure reason, or null on success.
     */
    async recordRunResult(id: string, lastRunAt: string, lastRunError: string | null): Promise<void> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        await collection.updateOne(
            { id },
            { $set: { lastRunAt, lastRunError } }
        );
    }

    /**
     * Record a failed scheduled run, incrementing the consecutive-failure
     * streak. When the streak reaches {@link SCHEDULE_FAILURE_DISABLE_THRESHOLD}
     * the schedule is auto-paused (`scheduleEnabled: false`) and the error
     * banner is annotated so the admin sees why the prompt stopped firing.
     *
     * Field-level `$set`/`$inc` so concurrent admin edits survive, same as
     * `recordRunResult`. Silently tolerates a prompt deleted mid-run.
     *
     * @param id - Prompt id.
     * @param lastRunAt - ISO timestamp the run was claimed at.
     * @param errorMessage - The failure reason from this run.
     * @returns Whether this failure tripped the auto-pause.
     */
    async recordRunFailure(id: string, lastRunAt: string, errorMessage: string): Promise<{ disabled: boolean }> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        const updated = await collection.findOneAndUpdate(
            { id },
            {
                $set: { lastRunAt, lastRunError: errorMessage },
                $inc: { failureCount: 1 }
            },
            { returnDocument: 'after' }
        ) as ISavedPrompt | null;

        let disabled = false;
        if (
            updated
            && (updated.failureCount ?? 0) >= SCHEDULE_FAILURE_DISABLE_THRESHOLD
            && updated.scheduleEnabled !== false
        ) {
            await collection.updateOne(
                { id },
                {
                    $set: {
                        scheduleEnabled: false,
                        lastRunError:
                            `${errorMessage} — schedule paused after ` +
                            `${SCHEDULE_FAILURE_DISABLE_THRESHOLD} consecutive failures; ` +
                            'fix the cause and re-enable the schedule'
                    }
                }
            );
            disabled = true;
        }

        return { disabled };
    }

    /**
     * Reset the consecutive-failure streak after a successful scheduled run, so
     * intermittent failures never accumulate toward the auto-pause.
     *
     * @param id - Prompt id.
     */
    async resetRunFailures(id: string): Promise<void> {
        const collection = this.database.getCollection<ISavedPrompt>(COLLECTION);
        await collection.updateOne(
            { id },
            { $set: { failureCount: 0 } }
        );
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Mongo includes the driver-assigned `_id` on every read. The published
 * `ISavedPrompt` shape doesn't include it, so strip it before returning to
 * callers.
 *
 * @param doc - The raw Mongo document.
 * @returns The document without `_id`.
 */
function stripMongoId<T extends Record<string, unknown>>(doc: T): ISavedPrompt {
    const cleaned = { ...doc };
    delete (cleaned as Record<string, unknown>)._id;
    return cleaned as unknown as ISavedPrompt;
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
 * Validate the optional `scheduleEnabled` flag.
 *
 * @param value - The candidate value.
 */
function validateScheduleEnabled(value: unknown): void {
    if (value !== undefined && typeof value !== 'boolean') {
        throw new SavedPromptValidationError('scheduleEnabled must be a boolean');
    }
}

/**
 * Validate a cron expression.
 *
 * Returns the normalized string when set, `null` for explicit clears (input was
 * `null` or empty string), and `undefined` when the caller passed `undefined`
 * (i.e., did not provide a cron in this update).
 *
 * The null-vs-undefined distinction matters at the DB write site: `null`
 * becomes a `$set` to MongoDB null (field cleared on the document); `undefined`
 * would be stripped by the Node driver's `ignoreUndefined: true` default,
 * silently leaving the existing value in place. Callers MUST translate `null`
 * into an actual `$set: { cron: null }` and translate `undefined` into "omit
 * from the update payload".
 *
 * @param input - The raw cron value.
 * @returns Normalized cron, `null` to clear, or `undefined` to omit.
 */
function validateCron(input: string | null | undefined): string | null | undefined {
    if (input === undefined) {
        return undefined;
    }
    if (input === null) {
        return null;
    }
    const trimmed = typeof input === 'string' ? input.trim() : '';
    if (trimmed.length === 0) {
        return null;
    }
    try {
        parseExpression(trimmed, { tz: 'UTC' });
    } catch {
        throw new SavedPromptValidationError('Invalid cron expression');
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
