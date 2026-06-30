/**
 * @fileoverview Database-backed configuration store for external data providers.
 *
 * Why a service (not env): a provider's API key and pacing must be editable by an
 * operator at runtime from the admin UI, survive restarts, and never appear in
 * source or process env. This singleton owns the read/write of the TronScan
 * config blob in the KV store, plus the secret-masking projection the admin API
 * returns so a key is never sent back to the browser in the clear.
 *
 * It is the single source of truth both the {@link TronScanClient} (which reads
 * the raw key per request) and the admin controller (which reads the masked view)
 * depend on, so the key has exactly one home.
 */

import type { IDatabaseService, ISystemLogService } from '@/types';
import {
    TRONSCAN_CONFIG_KEY,
    DEFAULT_TRONSCAN_CONFIG,
    type ITronScanProviderConfig,
    type ITronScanProviderConfigMasked
} from '../database/index.js';

/** Number of trailing key characters left visible when masking. */
const MASK_VISIBLE_CHARS = 4;

/**
 * Singleton provider-config service. Dependencies are injected once at bootstrap
 * via {@link setDependencies} before any {@link getInstance} call.
 */
export class ProviderConfigService {
    private static instance: ProviderConfigService | null = null;

    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;

    /**
     * @param database - Core KV store the config blob persists to.
     * @param logger - Child logger for diagnostics.
     */
    private constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.database = database;
        this.logger = logger;
    }

    /**
     * Wire dependencies on first call; idempotent so repeated bootstrap paths are
     * harmless.
     *
     * @param database - Core database service.
     * @param logger - Child logger.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!ProviderConfigService.instance) {
            ProviderConfigService.instance = new ProviderConfigService(database, logger);
        }
    }

    /**
     * @returns The shared instance.
     * @throws If {@link setDependencies} has not run.
     */
    public static getInstance(): ProviderConfigService {
        if (!ProviderConfigService.instance) {
            throw new Error('ProviderConfigService.setDependencies() must be called before getInstance()');
        }
        return ProviderConfigService.instance;
    }

    /** Reset for tests. */
    public static resetInstance(): void {
        ProviderConfigService.instance = null;
    }

    /**
     * Read the full TronScan config, merged over defaults so callers always get a
     * complete object even before anything has been saved. Returns the raw key —
     * for backend use (the client) only, never the admin API.
     *
     * @returns The effective TronScan config.
     */
    public async getTronScanConfig(): Promise<ITronScanProviderConfig> {
        const stored = await this.database.get<Partial<ITronScanProviderConfig>>(TRONSCAN_CONFIG_KEY);
        return { ...DEFAULT_TRONSCAN_CONFIG, ...(stored ?? {}) };
    }

    /**
     * The admin-safe view: the key reduced to `****` plus its last four chars and a
     * boolean flag, so the UI can render "configured" without the secret crossing
     * the wire.
     *
     * @returns The masked TronScan config.
     */
    public async getMaskedTronScanConfig(): Promise<ITronScanProviderConfigMasked> {
        const config = await this.getTronScanConfig();
        const key = config.apiKey ?? '';
        return {
            apiKey: ProviderConfigService.maskKey(key),
            apiKeyConfigured: key.length > 0,
            baseUrl: config.baseUrl,
            priceSource: config.priceSource,
            enabled: config.enabled
        };
    }

    /**
     * Merge a partial update over the stored config and persist it. The caller
     * (controller) is responsible for stripping a re-echoed mask and resolving the
     * clear-sentinel before passing `apiKey` here, so this method trusts the
     * `apiKey` it receives: a string sets it, `''` clears it, `undefined` leaves it.
     *
     * @param updates - Fields to change; omitted fields are preserved.
     * @returns The new masked config (never the raw key).
     */
    public async saveTronScanConfig(
        updates: Partial<ITronScanProviderConfig>
    ): Promise<ITronScanProviderConfigMasked> {
        const current = await this.getTronScanConfig();
        const merged: ITronScanProviderConfig = {
            ...current,
            ...updates
        };
        // An empty-string apiKey means "clear"; drop the field so we don't persist
        // a meaningless empty secret.
        if (!merged.apiKey) {
            delete merged.apiKey;
        }
        await this.database.set(TRONSCAN_CONFIG_KEY, merged);
        this.logger.info(
            { enabled: merged.enabled, priceSource: merged.priceSource, apiKeyConfigured: !!merged.apiKey },
            'TronScan provider config saved'
        );
        return this.getMaskedTronScanConfig();
    }

    /**
     * Mask a secret to its last {@link MASK_VISIBLE_CHARS} characters, matching the
     * platform's established `****abcd` convention, so an operator can recognise
     * which key is set without it being recoverable.
     *
     * @param key - The raw key, possibly empty.
     * @returns The masked key, or '' when none is set.
     */
    private static maskKey(key: string): string {
        if (!key) {
            return '';
        }
        if (key.length <= MASK_VISIBLE_CHARS) {
            return '****';
        }
        return `****${key.slice(-MASK_VISIBLE_CHARS)}`;
    }
}
