/**
 * @file screen-config.service.ts
 *
 * Persists and serves the admin-tunable untrusted-content screen policy. The
 * screen's behaviour is configuration, not hard-coded constants, so an operator
 * governs it from the admin surface without a deploy — the master switch, the
 * posture mode, the failure mode, and the offender threshold all live here. The
 * governor reads this config on every screen decision and the policy engine
 * reads the offender threshold on every gate, so a single normalized object is
 * the source of truth for both.
 *
 * Persisted through the core `_kv` store under one namespaced key, the same
 * mechanism `ToolPolicyEngine` uses for per-tool overrides — module-global
 * config, not per-tool, so it is one row rather than a collection. Every read
 * returns a defensive copy and every write is normalized against the schema, so
 * a malformed stored value (hand-edited, or written by an older shape) can never
 * widen the screen's behaviour beyond a valid configuration.
 *
 * Not an `IXxxService` public-API singleton — a plain per-module instance like
 * its sibling services (`ToolPolicyEngine`, `ToolAuditStore`), constructed once
 * in `AiToolsModule.init()` and shared by constructor injection.
 */

import type { IDatabaseService, ISystemLogService, IUntrustedScreenConfig } from '@/types';
import { DEFAULT_UNTRUSTED_SCREEN_CONFIG } from '@/types';

/** Core `_kv` key (manually namespaced) for the untrusted-content screen config. */
const SCREEN_CONFIG_KEY = 'ai-tools:screen-config';

/**
 * Core-owned, `_kv`-backed store for the untrusted-content screen policy.
 */
export class ScreenConfigService {
    /** In-memory copy, loaded once at init and replaced on every update. */
    private config: IUntrustedScreenConfig = { ...DEFAULT_UNTRUSTED_SCREEN_CONFIG };

    /**
     * @param logger - Module-scoped logger for config-change audit lines.
     * @param database - Core database for persisting the config through `_kv`.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {}

    /**
     * Load the persisted config once during module init, normalizing whatever is
     * stored so an absent or malformed value resolves to the safe defaults rather
     * than leaving the screen unconfigured.
     *
     * @returns Resolves when the in-memory config reflects the persisted value.
     */
    async load(): Promise<void> {
        const stored = await this.database.get<Partial<IUntrustedScreenConfig>>(SCREEN_CONFIG_KEY);
        this.config = this.normalize(stored);
        return;
    }

    /**
     * Read the current config. Returns a defensive copy so a caller cannot mutate
     * the shared policy in place — the governor and policy engine both hold this
     * service and read it on the hot path.
     *
     * @returns A copy of the effective screen config.
     */
    get(): IUntrustedScreenConfig {
        return { ...this.config };
    }

    /**
     * Apply an admin patch and persist it. The patch is merged over the current
     * config and re-normalized, so a partial or out-of-range field falls back to
     * the existing valid value rather than corrupting the policy. Backs the admin
     * screen-config editor.
     *
     * @param patch - The subset of fields the admin changed.
     * @returns The full effective config after the update.
     */
    async update(patch: Partial<IUntrustedScreenConfig>): Promise<IUntrustedScreenConfig> {
        this.config = this.normalize({ ...this.config, ...patch });
        await this.database.set(SCREEN_CONFIG_KEY, this.config);
        this.logger.info({ config: this.config }, 'AI tool untrusted-content screen config updated');
        return this.get();
    }

    /**
     * Coerce an arbitrary stored or patched value into a valid config. Each field
     * that fails its type/range check falls back to the default for that field —
     * an unknown `postureMode` or `onFailure` enum, a non-boolean `enabled`, or a
     * negative/non-finite threshold can never take effect, so the screen always
     * runs against a coherent policy.
     *
     * @param raw - The candidate value (stored row or merged patch).
     * @returns A fully-populated, validated config.
     */
    private normalize(raw: Partial<IUntrustedScreenConfig> | null | undefined): IUntrustedScreenConfig {
        const d = DEFAULT_UNTRUSTED_SCREEN_CONFIG;
        const r = raw ?? {};
        const enabled = typeof r.enabled === 'boolean' ? r.enabled : d.enabled;
        const postureMode = r.postureMode === 'always' || r.postureMode === 'trifecta' ? r.postureMode : d.postureMode;
        const onFailure = r.onFailure === 'open' || r.onFailure === 'closed' ? r.onFailure : d.onFailure;
        const offenderThreshold = typeof r.offenderThreshold === 'number' && Number.isFinite(r.offenderThreshold) && r.offenderThreshold >= 0
            ? Math.floor(r.offenderThreshold)
            : d.offenderThreshold;
        return { enabled, postureMode, onFailure, offenderThreshold };
    }
}
