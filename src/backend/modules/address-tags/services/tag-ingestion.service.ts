/**
 * @fileoverview Runs machine tag sources and owns their operational state:
 * cursors, per-source run records, enable switches, and the Chainalysis key.
 *
 * The service is the seam between a source's `fetch()`/`screen()` and
 * `AddressTagService.syncSource`: it loads the stored cursor, hands the
 * source's output to the reconcile, and persists the outcome. A source that
 * throws must not leave a half-applied state, so the cursor advances only
 * after a successful reconcile — a failed run retries the same window on the
 * next tick — and every attempt records `lastError`/`lastAttemptAt` so a
 * silently failing feed never looks identical to a clean one.
 *
 * Everything lives in the module's key-value area (prefixed `address-tags.`)
 * rather than `.env`, deliberately: an environment variable is fixed for the
 * life of the container, and `droplet-update.sh` never rewrites `.env` after
 * provisioning — the `DOCKER_API_URL` trap. Key-value config lets an operator
 * paste a Chainalysis key or flip a source switch and have the next run pick
 * it up. The cost is that "absent means off" becomes a per-run decision, which
 * is why the status surface reports availability live.
 *
 * This is a module-internal utility (no `IXxxService` registry contract), so
 * it is a plain constructor-injected class rather than a singleton.
 */

import type { IAddressTagService, IAddressTagSyncResult, IDatabaseService, ISystemLogService } from '@/types';
import { isVerifiableTagSource, type ILookupTagSource, type ITagSource } from '../sources/ITagSource.js';
import { CHAINALYSIS_SOURCE_ID } from '../sources/chainalysis.source.js';

/**
 * Key-value namespace prefix. Modules share one `_kv` collection (unlike
 * plugins, which are auto-prefixed), so the module id is prepended by hand —
 * the KV analog of the `module_{id}_*` collection convention.
 */
const KV_PREFIX = 'address-tags.';

/** Persisted record of a source's most recent run attempts. */
export interface ITagSourceRunState {
    /** ISO timestamp of the last run attempt, successful or not. */
    lastAttemptAt?: string;
    /** ISO timestamp of the last run that reconciled successfully. */
    lastSuccessAt?: string;
    /** Message from the most recent failure, or null after a clean run. */
    lastError?: string | null;
    /** Counts from the most recent successful reconcile. */
    lastResult?: IAddressTagSyncResult | null;
}

/** One source's row on the admin status panel. */
export interface ITagSourceStatus {
    /** Source id (`ofac-sdn`, `usdt-blacklist`, `chainalysis`). */
    id: string;
    /** How the source reports. */
    mode: 'snapshot' | 'delta' | 'lookup';
    /** Direct publication or curation-quarantined (phase 6). */
    publish: 'direct' | 'quarantined';
    /** Default cron for scheduled sources. */
    cron?: string;
    /** Whether scheduled runs are switched on for this source. */
    enabled: boolean;
    /** Whether the source has what it needs to run (a key, for Chainalysis). */
    configured: boolean;
    /** True while a run is in flight in this process. */
    running: boolean;
    /** The stored resume position, for delta sources. */
    cursor: string | null;
    /** The persisted run record. */
    state: ITagSourceRunState;
    /** The persisted verify-pass record, for sources that support one. */
    verifyState?: ITagSourceRunState;
}

/** What the settings surface reports — never the key itself. */
export interface IAddressTagsSettings {
    chainalysis: {
        /** Whether an API key is stored. */
        configured: boolean;
        /** Last four characters of the stored key, for recognition only. */
        keySuffix: string | null;
        /** The operator switch, independent of whether a key is present. */
        enabled: boolean;
    };
    /** Scheduled sources' enable switches, keyed by source id. */
    sources: Record<string, { enabled: boolean }>;
}

/** Partial update the settings surface accepts. */
export interface IAddressTagsSettingsUpdate {
    chainalysis?: {
        /** A new key to store; null or empty clears it; undefined leaves it. */
        apiKey?: string | null;
        /** New operator-switch value. */
        enabled?: boolean;
    };
    /** Per-source switch updates, keyed by source id. */
    sources?: Record<string, { enabled?: boolean }>;
}

/** Collaborators injected at module init. */
export interface ITagIngestionDependencies {
    /** The tag service whose `syncSource` applies every reconcile. */
    tags: IAddressTagService;
    /** Key-value storage for cursors, run state, and configuration. */
    database: IDatabaseService;
    /** Module-scoped logger. */
    logger: ISystemLogService;
}

/**
 * Orchestrates registered tag sources: scheduled runs, admin-triggered runs,
 * per-address screening, the weekly verify pass, and the settings surface.
 */
export class TagIngestionService {
    private readonly sources = new Map<string, ITagSource>();
    private readonly running = new Set<string>();
    private readonly tags: IAddressTagService;
    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;

    /**
     * @param deps - Constructor-injected collaborators.
     */
    constructor(deps: ITagIngestionDependencies) {
        this.tags = deps.tags;
        this.database = deps.database;
        this.logger = deps.logger;
    }

    /**
     * Register one source under its id. Called by the module during `init()`;
     * a duplicate id is a wiring bug and fails fast.
     *
     * @param source - The source to make runnable.
     */
    public registerSource(source: ITagSource): void {
        if (this.sources.has(source.id)) {
            throw new Error(`Tag source '${source.id}' is already registered`);
        }
        this.sources.set(source.id, source);
    }

    /**
     * Whether scheduled runs are switched on for a source. Lookup sources are
     * never scheduled, so their switch gates ambient use of the capability
     * (screening) rather than a cron. Chainalysis defaults off — it needs a
     * key and an explicit operator decision — while feed sources default on.
     *
     * @param id - Source id to check.
     * @returns The effective switch value.
     */
    public async isSourceEnabled(id: string): Promise<boolean> {
        const stored = await this.database.get<boolean>(this.enabledKey(id));
        if (typeof stored === 'boolean') {
            return stored;
        }
        return id !== CHAINALYSIS_SOURCE_ID;
    }

    /**
     * Run one scheduled source now: fetch from the stored cursor, reconcile
     * through `syncSource`, then persist the new cursor and the outcome.
     * Serialized per source so an admin's "run now" cannot overlap a
     * scheduled tick mid-reconcile. The enable switch is *not* consulted here
     * — it gates the scheduled path in the module's job handlers, while a
     * direct call is an operator action ("for testing and recovery") that
     * must work on a disabled source too.
     *
     * @param id - The registered source to run.
     * @returns The reconcile counts.
     */
    public async runSource(id: string): Promise<IAddressTagSyncResult> {
        const source = this.requireSource(id);
        if (source.mode === 'lookup') {
            throw new Error(`Source '${id}' is a per-address lookup; use screen(address) instead`);
        }
        if (this.running.has(id)) {
            throw new Error(`Source '${id}' is already running`);
        }
        this.running.add(id);
        const attemptedAt = new Date().toISOString();
        try {
            const cursor = await this.database.get<string>(this.cursorKey(id));
            const fetched = await source.fetch(cursor ?? undefined);
            const result = await this.tags.syncSource(
                id,
                fetched.assertions,
                source.mode === 'snapshot' ? 'snapshot' : 'delta',
                fetched.withdrawn
            );
            // The cursor advances only after the reconcile lands; a throw
            // above leaves the old cursor so the next tick retries the window.
            if (fetched.cursor !== undefined) {
                await this.database.set(this.cursorKey(id), fetched.cursor);
            }
            await this.mergeState(this.stateKey(id), {
                lastAttemptAt: attemptedAt,
                lastSuccessAt: new Date().toISOString(),
                lastError: null,
                lastResult: result
            });
            return result;
        } catch (error) {
            await this.mergeState(this.stateKey(id), {
                lastAttemptAt: attemptedAt,
                lastError: error instanceof Error ? error.message : String(error)
            });
            this.logger.error({ source: id, error }, 'Tag source run failed');
            throw error;
        } finally {
            this.running.delete(id);
        }
    }

    /**
     * Screen one address through a lookup source and apply the answer as a
     * delta reconcile — a hit asserts, a clean answer withdraws any prior
     * flag. Admin-requested only; there is no ambient screening path.
     *
     * Unlike `runSource`, this path honours the enable switch: a lookup
     * source is never scheduled, so the switch's whole meaning is gating this
     * capability, and Chainalysis defaults off precisely because using it is
     * an explicit operator decision.
     *
     * @param address - Base58 address to screen.
     * @returns The reconcile counts for this one address.
     */
    public async screenAddress(address: string): Promise<IAddressTagSyncResult> {
        const source = this.requireSource(CHAINALYSIS_SOURCE_ID) as ILookupTagSource;
        if (!(await this.isSourceEnabled(source.id))) {
            throw new Error('Chainalysis screening is disabled; enable it on the Settings tab first');
        }
        const attemptedAt = new Date().toISOString();
        try {
            const outcome = await source.screen(address);
            const result = await this.tags.syncSource(source.id, outcome.assertions, 'delta', outcome.withdrawn);
            await this.mergeState(this.stateKey(source.id), {
                lastAttemptAt: attemptedAt,
                lastSuccessAt: new Date().toISOString(),
                lastError: null,
                lastResult: result
            });
            return result;
        } catch (error) {
            await this.mergeState(this.stateKey(source.id), {
                lastAttemptAt: attemptedAt,
                lastError: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Re-verify a source's live holdings against its authority — the weekly
     * drift repair for event-delta sources. Loads the addresses currently
     * held live under the source's verified tag (only live ones: an already
     * withdrawn assertion needs no repair), asks the source to re-check them,
     * and applies the answer as a delta reconcile.
     *
     * Takes the same per-source run lock as `runSource`, because both paths
     * reconcile the same source id: letting a verify pass interleave with a
     * poll would have each withdrawing on holdings the other just changed.
     * A collision throws, and the colliding job simply waits for its next
     * scheduled tick.
     *
     * @param id - The verifiable source to run the pass for.
     * @returns The reconcile counts.
     */
    public async verifyHeld(id: string): Promise<IAddressTagSyncResult> {
        const source = this.requireSource(id);
        if (!isVerifiableTagSource(source)) {
            throw new Error(`Source '${id}' does not support a verify pass`);
        }
        if (this.running.has(id)) {
            throw new Error(`Source '${id}' is already running`);
        }
        this.running.add(id);
        const attemptedAt = new Date().toISOString();
        try {
            const held = await this.tags.getAddressesByTags([source.verifiedTag]);
            const addresses = [...new Set(held.map((tag) => tag.address))];
            const outcome = await source.verify(addresses);
            const result = await this.tags.syncSource(id, outcome.assertions, 'delta', outcome.withdrawn);
            await this.mergeState(this.verifyKey(id), {
                lastAttemptAt: attemptedAt,
                lastSuccessAt: new Date().toISOString(),
                lastError: null,
                lastResult: result
            });
            return result;
        } catch (error) {
            await this.mergeState(this.verifyKey(id), {
                lastAttemptAt: attemptedAt,
                lastError: error instanceof Error ? error.message : String(error)
            });
            this.logger.error({ source: id, error }, 'Tag source verify pass failed');
            throw error;
        } finally {
            this.running.delete(id);
        }
    }

    /**
     * The status panel's data: every registered source with its stored cursor,
     * run record, switch, and readiness. This is what makes a silently failing
     * feed visible — for sanctions data, a screen that reports nothing wrong
     * while the data goes stale is the worst failure mode available.
     *
     * @returns One status row per registered source.
     */
    public async getStatuses(): Promise<ITagSourceStatus[]> {
        const statuses: ITagSourceStatus[] = [];
        for (const source of this.sources.values()) {
            const status: ITagSourceStatus = {
                id: source.id,
                mode: source.mode,
                publish: source.publish,
                cron: source.cron,
                enabled: await this.isSourceEnabled(source.id),
                configured: source.id === CHAINALYSIS_SOURCE_ID
                    ? Boolean(await this.database.get<string>(this.apiKeyKey()))
                    : true,
                running: this.running.has(source.id),
                cursor: (await this.database.get<string>(this.cursorKey(source.id))) ?? null,
                state: (await this.database.get<ITagSourceRunState>(this.stateKey(source.id))) ?? {}
            };
            if (isVerifiableTagSource(source)) {
                status.verifyState = (await this.database.get<ITagSourceRunState>(this.verifyKey(source.id))) ?? {};
            }
            statuses.push(status);
        }
        return statuses;
    }

    /**
     * The settings surface's read side. Deliberately asymmetric with the
     * write side: the stored Chainalysis key is reported as configured plus
     * its last four characters, never the value — an endpoint that echoed
     * stored config back for a form to populate would turn every admin
     * session, browser cache, and proxy log into a place the key lives.
     *
     * @returns The current settings, key redacted.
     */
    public async getSettings(): Promise<IAddressTagsSettings> {
        const key = await this.database.get<string>(this.apiKeyKey());
        const sources: Record<string, { enabled: boolean }> = {};
        for (const source of this.sources.values()) {
            if (source.mode !== 'lookup') {
                sources[source.id] = { enabled: await this.isSourceEnabled(source.id) };
            }
        }
        return {
            chainalysis: {
                configured: Boolean(key),
                keySuffix: key ? key.slice(-4) : null,
                enabled: await this.isSourceEnabled(CHAINALYSIS_SOURCE_ID)
            },
            sources
        };
    }

    /**
     * The settings surface's write side. The key is write-only over HTTP:
     * a non-empty string stores it, null or empty clears it, and absence
     * leaves it untouched. Unknown source ids are ignored rather than stored,
     * so a stale client cannot mint switches for sources that no longer exist.
     *
     * @param update - The partial update to apply.
     * @returns The settings after the update, key redacted as always.
     */
    public async updateSettings(update: IAddressTagsSettingsUpdate): Promise<IAddressTagsSettings> {
        if (update.chainalysis && 'apiKey' in update.chainalysis) {
            const raw = update.chainalysis.apiKey;
            const trimmed = typeof raw === 'string' ? raw.trim() : '';
            if (trimmed.length > 0) {
                await this.database.set(this.apiKeyKey(), trimmed);
                this.logger.info('Chainalysis API key updated');
            } else {
                await this.database.delete(this.apiKeyKey());
                this.logger.info('Chainalysis API key cleared');
            }
        }
        if (typeof update.chainalysis?.enabled === 'boolean') {
            await this.database.set(this.enabledKey(CHAINALYSIS_SOURCE_ID), update.chainalysis.enabled);
        }
        for (const [id, config] of Object.entries(update.sources ?? {})) {
            if (this.sources.has(id) && id !== CHAINALYSIS_SOURCE_ID && typeof config.enabled === 'boolean') {
                await this.database.set(this.enabledKey(id), config.enabled);
            }
        }
        return this.getSettings();
    }

    /**
     * Read the configured Chainalysis key for the source's own use. This is
     * the injection target for the source's key-reader callback and never
     * crosses the HTTP layer.
     *
     * @returns The stored key, or null when none is configured.
     */
    public async readChainalysisKey(): Promise<string | null> {
        return (await this.database.get<string>(this.apiKeyKey())) ?? null;
    }

    /**
     * Look up a registered source or fail with a message the admin surface
     * can show verbatim.
     *
     * @param id - Source id to resolve.
     * @returns The registered source.
     */
    private requireSource(id: string): ITagSource {
        const source = this.sources.get(id);
        if (!source) {
            throw new Error(`Unknown tag source '${id}'`);
        }
        return source;
    }

    /**
     * Merge a partial run record over the stored one, so a failed attempt
     * updates `lastError`/`lastAttemptAt` without erasing the last success
     * and its counts — the panel needs both to say "worked Tuesday, failing
     * since".
     *
     * @param key - The state key to merge into.
     * @param patch - Fields from this attempt.
     */
    private async mergeState(key: string, patch: Partial<ITagSourceRunState>): Promise<void> {
        const existing = (await this.database.get<ITagSourceRunState>(key)) ?? {};
        await this.database.set(key, { ...existing, ...patch });
    }

    /** @returns The KV key holding a source's resume cursor. */
    private cursorKey(id: string): string {
        return `${KV_PREFIX}sources.${id}.cursor`;
    }

    /** @returns The KV key holding a source's run record. */
    private stateKey(id: string): string {
        return `${KV_PREFIX}sources.${id}.state`;
    }

    /** @returns The KV key holding a source's verify-pass record. */
    private verifyKey(id: string): string {
        return `${KV_PREFIX}sources.${id}.verify`;
    }

    /** @returns The KV key holding a source's scheduled-run switch. */
    private enabledKey(id: string): string {
        return id === CHAINALYSIS_SOURCE_ID
            ? `${KV_PREFIX}chainalysis.enabled`
            : `${KV_PREFIX}sources.${id}.enabled`;
    }

    /** @returns The KV key holding the write-only Chainalysis API key. */
    private apiKeyKey(): string {
        return `${KV_PREFIX}chainalysis.apiKey`;
    }
}
