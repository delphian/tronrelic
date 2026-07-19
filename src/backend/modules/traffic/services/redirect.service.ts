/**
 * Admin-managed URL redirect service.
 *
 * Stores operator-curated legacy-URL redirect rules (old path → new path)
 * in MongoDB and serves them to the Next.js edge middleware, which issues the
 * actual 301/302 at request time. The rules are DATA, never deployed code:
 * an operator adds a rule from the `/system/traffic` admin surface and the
 * middleware picks it up on its next cache refresh — no rebuild, no deploy.
 *
 * ## Why This Service Exists
 *
 * A URL restructure leaves the old paths indexed by Google but dead (404),
 * evaporating the link equity and crawl familiarity those URLs held. The fix
 * is a 301 from each legacy path to its live equivalent. Hardcoding those in
 * the middleware bundle means a deploy per redirect — unacceptable when the
 * whole point is that operators add them as Search Console surfaces new 404s.
 * This service moves the redirect list into admin-editable storage.
 *
 * ## Design Decisions
 *
 * - **Singleton pattern** matching `GscService` for consistent DI.
 * - **One document per rule** (not a settings singleton) — rules are an
 *   unbounded, independently-editable list, like the GSC query cache.
 * - **Unique index on `pattern`** — a source path resolves to one rule.
 * - **Same-site only** — `pattern` and `destination` are both root-relative
 *   paths; off-site redirects are out of scope and rejected by validation.
 * - **Single-rule loop-guarded** — a rule whose destination re-matches its own
 *   pattern is rejected at write time. This guards only *self*-loops; a cycle
 *   spanning multiple rules (`/a → /b` plus `/b → /a`) is not detected here.
 *   The blast radius is bounded: writes are admin-only and the middleware
 *   issues at most one redirect per request, so a cross-rule cycle surfaces as
 *   a browser-capped `ERR_TOO_MANY_REDIRECTS`, never a server-side loop.
 * - **Most-specific-first ordering** — active rules are served longest-pattern
 *   first so `/tools/x` wins over `/tools` under the middleware's first-match.
 */

import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@/types';

/**
 * Collection name following the `module_{module-id}_{collection}` convention.
 */
const COLLECTION_NAME = 'module_traffic_redirects';

/**
 * Path prefixes a redirect may never target or shadow. Redirecting these would
 * break the application itself (API calls, Next internals) rather than a stale
 * marketing URL, so they are refused at validation time.
 */
const RESERVED_PREFIXES: ReadonlyArray<string> = ['/api', '/_next'];

/**
 * Thrown when caller-supplied rule fields are malformed, reserved, or would
 * create a redirect loop. The controller maps it to HTTP 400 so the operator
 * sees exactly which invariant they violated.
 */
export class RedirectValidationError extends Error {
    /**
     * @param message - Operator-readable description of the violated invariant.
     */
    constructor(message: string) {
        super(message);
        this.name = 'RedirectValidationError';
    }
}

/**
 * Thrown when an update/delete targets a rule id that no longer exists. The
 * controller maps it to HTTP 404.
 */
export class RedirectNotFoundError extends Error {
    /**
     * @param message - Description of the missing resource.
     */
    constructor(message: string = 'Redirect rule not found') {
        super(message);
        this.name = 'RedirectNotFoundError';
    }
}

/**
 * A redirect rule as persisted in MongoDB. One document per source path.
 */
export interface IRedirectRuleDocument {
    /** Mongo id; the admin API exposes its hex string as the rule id. */
    _id: ObjectId;
    /** Source path to match, root-relative (e.g. `/tron-forum`). */
    pattern: string;
    /** True matches `pattern` and any `pattern/...` sub-path; false is exact. */
    isPrefix: boolean;
    /** Destination path, root-relative (e.g. `/forum`). */
    destination: string;
    /** True issues a 301 (permanent); false a 302 (temporary). */
    permanent: boolean;
    /** Disabled rules are retained but never served to the middleware. */
    enabled: boolean;
    /** Optional operator annotation recording why the redirect exists. */
    notes?: string;
    /** Creation timestamp. */
    createdAt: Date;
    /** Last-update timestamp. */
    updatedAt: Date;
}

/**
 * The minimal rule shape the edge middleware consumes. Only enabled rules are
 * ever emitted, and only the four fields the middleware needs to match + issue
 * a redirect — no ids, timestamps, or operator notes cross that boundary.
 */
export interface IRedirectRule {
    /** Source path to match. */
    pattern: string;
    /** Prefix vs exact match. */
    isPrefix: boolean;
    /** Destination path. */
    destination: string;
    /** 301 when true, 302 when false. */
    permanent: boolean;
}

/**
 * The admin-facing rule shape. Extends the middleware shape with the id,
 * enabled flag, notes, and ISO timestamps the management UI renders.
 */
export interface IRedirectRuleAdmin extends IRedirectRule {
    /** Hex string of the Mongo `_id`; the handle admin edits/deletes address. */
    id: string;
    /** Whether the rule is currently served to the middleware. */
    enabled: boolean;
    /** Optional operator annotation. */
    notes?: string;
    /** ISO-8601 creation timestamp. */
    createdAt: string;
    /** ISO-8601 last-update timestamp. */
    updatedAt: string;
}

/**
 * Caller-supplied fields when creating a rule. Booleans default to the common
 * case (prefix match, permanent, enabled) so an operator entering a simple
 * legacy→new mapping supplies only `pattern` and `destination`.
 */
export interface IRedirectRuleInput {
    /** Source path to match. */
    pattern: string;
    /** Destination path. */
    destination: string;
    /** Prefix vs exact match; defaults to true (prefix). */
    isPrefix?: boolean;
    /** 301 vs 302; defaults to true (permanent). */
    permanent?: boolean;
    /** Whether the rule is active; defaults to true. */
    enabled?: boolean;
    /** Optional operator annotation. */
    notes?: string;
}

/**
 * Editable subset when patching an existing rule. Every field optional; only
 * those present are applied.
 */
export type IRedirectRulePatch = Partial<IRedirectRuleInput>;

/**
 * Manages the admin-curated redirect collection and serves the active rules to
 * the edge middleware.
 */
export class RedirectService {
    /** The single process-wide instance. */
    private static instance: RedirectService;

    /** Typed handle to the redirect collection, grabbed once in the constructor. */
    private readonly collection: Collection<IRedirectRuleDocument>;

    /**
     * @param database - Injected database service; the redirect collection is
     *   resolved from it so the service stays mockable in tests.
     * @param logger - Scoped logger for write/validation diagnostics.
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {
        this.collection = database.getCollection<IRedirectRuleDocument>(COLLECTION_NAME);
    }

    /**
     * Wire the singleton's dependencies. Idempotent — the first call constructs
     * the instance, later calls are no-ops so re-entrant bootstrap is safe.
     *
     * @param database - Database service for the redirect collection.
     * @param logger - Scoped logger.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!RedirectService.instance) {
            RedirectService.instance = new RedirectService(database, logger);
        }
    }

    /**
     * Retrieve the configured singleton.
     *
     * @returns The shared instance.
     * @throws If accessed before `setDependencies()` has run.
     */
    public static getInstance(): RedirectService {
        if (!RedirectService.instance) {
            throw new Error('RedirectService.setDependencies() must be called before getInstance()');
        }
        return RedirectService.instance;
    }

    /**
     * Clear the singleton so tests can re-wire it with fresh mocks.
     */
    public static resetInstance(): void {
        RedirectService.instance = undefined as unknown as RedirectService;
    }

    /**
     * Ensure the unique `pattern` index exists. Called once from module
     * `init()`; the uniqueness constraint is what makes a duplicate-pattern
     * create fail loudly (E11000) instead of silently shadowing.
     */
    async createIndexes(): Promise<void> {
        await this.collection.createIndex({ pattern: 1 }, { unique: true });
        this.logger.info('Redirect collection indexes ensured');
    }

    /**
     * The active rules the edge middleware consumes, most-specific first.
     *
     * Ordering by descending pattern length lets the middleware keep its simple
     * first-match loop while still preferring `/tools/x` over `/tools`. Disabled
     * rules are excluded so toggling `enabled` is the operator's kill switch.
     *
     * @returns Enabled rules as the minimal four-field middleware shape.
     */
    async getActiveRules(): Promise<IRedirectRule[]> {
        const docs = await this.collection.find({ enabled: true }).toArray();
        const rules = docs
            .sort((a, b) => b.pattern.length - a.pattern.length)
            .map(doc => ({
                pattern: doc.pattern,
                isPrefix: doc.isPrefix,
                destination: doc.destination,
                permanent: doc.permanent
            }));
        return rules;
    }

    /**
     * All rules, newest first, for the admin management table.
     *
     * @returns Every rule in the admin shape (enabled and disabled).
     */
    async listRules(): Promise<IRedirectRuleAdmin[]> {
        const docs = await this.collection.find({}).sort({ createdAt: -1 }).toArray();
        const rules = docs.map(doc => this.toAdmin(doc));
        return rules;
    }

    /**
     * Create a rule after validating it. Validation throws on bad input; a
     * duplicate `pattern` surfaces as a Mongo E11000 the controller maps to 409.
     *
     * @param input - Caller fields; booleans default to prefix/permanent/enabled.
     * @returns The created rule in admin shape.
     */
    async createRule(input: IRedirectRuleInput): Promise<IRedirectRuleAdmin> {
        const pattern = this.normalizePath(input.pattern);
        const destination = this.normalizePath(input.destination);
        const isPrefix = input.isPrefix ?? true;
        this.assertValidRule(pattern, destination, isPrefix);

        const now = new Date();
        const doc: IRedirectRuleDocument = {
            _id: new ObjectId(),
            pattern,
            destination,
            isPrefix,
            permanent: input.permanent ?? true,
            enabled: input.enabled ?? true,
            notes: this.normalizeNotes(input.notes),
            createdAt: now,
            updatedAt: now
        };

        await this.collection.insertOne(doc);
        this.logger.info({ pattern, destination }, 'Redirect rule created');
        return this.toAdmin(doc);
    }

    /**
     * Patch an existing rule. Only supplied fields change; the merged result is
     * re-validated so a patch cannot produce an invalid or looping rule.
     *
     * @param id - Hex string of the rule's `_id`.
     * @param patch - Fields to change.
     * @returns The updated rule in admin shape.
     * @throws If the id is malformed or no rule matches.
     */
    async updateRule(id: string, patch: IRedirectRulePatch): Promise<IRedirectRuleAdmin> {
        const _id = this.toObjectId(id);
        const existing = await this.collection.findOne({ _id });
        if (!existing) {
            throw new RedirectNotFoundError();
        }

        const pattern = patch.pattern !== undefined ? this.normalizePath(patch.pattern) : existing.pattern;
        const destination = patch.destination !== undefined ? this.normalizePath(patch.destination) : existing.destination;
        const isPrefix = patch.isPrefix ?? existing.isPrefix;
        this.assertValidRule(pattern, destination, isPrefix);

        const update: Partial<IRedirectRuleDocument> = {
            pattern,
            destination,
            isPrefix,
            permanent: patch.permanent ?? existing.permanent,
            enabled: patch.enabled ?? existing.enabled,
            notes: patch.notes !== undefined ? this.normalizeNotes(patch.notes) : existing.notes,
            updatedAt: new Date()
        };

        await this.collection.updateOne({ _id }, { $set: update });
        this.logger.info({ id, pattern, destination }, 'Redirect rule updated');
        const merged: IRedirectRuleDocument = { ...existing, ...update };
        return this.toAdmin(merged);
    }

    /**
     * Delete a rule.
     *
     * @param id - Hex string of the rule's `_id`.
     * @throws If the id is malformed or no rule matched.
     */
    async deleteRule(id: string): Promise<void> {
        const _id = this.toObjectId(id);
        const result = await this.collection.deleteOne({ _id });
        if (result.deletedCount === 0) {
            throw new RedirectNotFoundError();
        }
        this.logger.info({ id }, 'Redirect rule deleted');
    }

    /**
     * Project a stored document into the admin API shape (id + ISO timestamps).
     *
     * @param doc - The stored rule.
     * @returns The admin-facing rule.
     */
    private toAdmin(doc: IRedirectRuleDocument): IRedirectRuleAdmin {
        const admin: IRedirectRuleAdmin = {
            id: doc._id.toString(),
            pattern: doc.pattern,
            isPrefix: doc.isPrefix,
            destination: doc.destination,
            permanent: doc.permanent,
            enabled: doc.enabled,
            notes: doc.notes,
            createdAt: doc.createdAt.toISOString(),
            updatedAt: doc.updatedAt.toISOString()
        };
        return admin;
    }

    /**
     * Trim a path and strip a single trailing slash (except the root) so
     * `/forum/` and `/forum` are stored identically and match consistently.
     *
     * @param value - Raw caller-supplied path.
     * @returns The normalized path (unchanged shape validated separately).
     */
    private normalizePath(value: string): string {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        const normalized = trimmed.length > 1 && trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
        return normalized;
    }

    /**
     * Collapse an empty/blank note to `undefined` so the field is absent rather
     * than an empty string in storage.
     *
     * @param value - Raw note or undefined.
     * @returns Trimmed note, or undefined when blank.
     */
    private normalizeNotes(value: string | undefined): string | undefined {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        const notes = trimmed.length > 0 ? trimmed : undefined;
        return notes;
    }

    /**
     * Parse a hex id into an ObjectId, converting a malformed id into a clear
     * error the controller returns as a 400 rather than a 500.
     *
     * @param id - Candidate hex string.
     * @returns The parsed ObjectId.
     * @throws If `id` is not a valid ObjectId.
     */
    private toObjectId(id: string): ObjectId {
        if (!ObjectId.isValid(id)) {
            throw new RedirectValidationError('Invalid redirect rule id');
        }
        return new ObjectId(id);
    }

    /**
     * Enforce the same-site, non-reserved, non-looping invariants a rule must
     * satisfy. Throws with an operator-readable message on the first violation.
     *
     * @param pattern - Normalized source path.
     * @param destination - Normalized destination path.
     * @param isPrefix - Whether the rule matches by prefix.
     * @throws If the rule is malformed, reserved, or would loop.
     */
    private assertValidRule(pattern: string, destination: string, isPrefix: boolean): void {
        if (!pattern.startsWith('/') || pattern.length < 2) {
            throw new RedirectValidationError('pattern must be a root-relative path (e.g. /old-page)');
        }
        if (!destination.startsWith('/') || destination.length < 1) {
            throw new RedirectValidationError('destination must be a root-relative path (e.g. /new-page)');
        }
        // A destination whose second character is `/` or `\` is scheme-relative:
        // the edge middleware resolves it with `new URL(destination, request.url)`,
        // which keeps the request scheme but takes the authority from the
        // destination, so `//evil.example` (and the `/\` backslash variant) become
        // `https://evil.example/` — an off-site open redirect that breaks the
        // documented same-site-only contract. Reject both leading forms.
        if (destination.length > 1 && (destination[1] === '/' || destination[1] === '\\')) {
            throw new RedirectValidationError('destination must not begin with // or /\\ (resolves to an external origin)');
        }
        if (/\s/.test(pattern) || /\s/.test(destination)) {
            throw new RedirectValidationError('pattern and destination must not contain whitespace');
        }
        for (const reserved of RESERVED_PREFIXES) {
            if (pattern === reserved || pattern.startsWith(reserved + '/')) {
                throw new RedirectValidationError(`pattern must not target the reserved prefix ${reserved}`);
            }
        }
        if (pattern === destination) {
            throw new RedirectValidationError('pattern and destination must differ (self-redirect loop)');
        }
        // A prefix rule whose destination sits under the same prefix re-matches
        // itself on the redirected request, bouncing forever.
        if (isPrefix && (destination === pattern || destination.startsWith(pattern + '/'))) {
            throw new RedirectValidationError('destination must not fall under a prefix pattern (redirect loop)');
        }
    }
}
