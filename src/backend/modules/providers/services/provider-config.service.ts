/**
 * @fileoverview Database-backed configuration store for external data providers.
 *
 * Why a service (not env): a provider's API key and pacing must be editable by an
 * operator at runtime from the admin UI, survive restarts, and never appear in
 * source or process env. This singleton owns the read/write of each vendor's
 * config blob in the KV store, plus the secret-masking projection the admin API
 * returns so a key is never sent back to the browser in the clear.
 *
 * The generic `getConfig` / `getMaskedConfig` / `saveConfig` trio works from a
 * vendor's descriptor: any field the descriptor marks `secret` is masked on the
 * way out and dropped when cleared on the way in. The typed `getXxxConfig`
 * readers are conveniences for the vendor clients, which want a full typed
 * object per request. TronGrid keeps its own write path because its rotating
 * key pool is not a single secret field.
 *
 * It is the single source of truth both the vendor clients (which read raw keys
 * per request) and the admin controller (which reads the masked view) depend on,
 * so each key has exactly one home.
 *
 * The TronGrid blob is staged ahead of its switchover: it is written and read
 * here and by the connectivity test only — the live TronGrid client still takes
 * its keys from `TRONGRID_API_KEY*` in env.
 */

import type { IDatabaseService, ISystemLogService } from '@/types';
import {
    providerConfigKey,
    TRONSCAN_DESCRIPTOR,
    DEFAULT_TRONSCAN_CONFIG,
    COINGECKO_DESCRIPTOR,
    DEFAULT_COINGECKO_CONFIG,
    GECKOTERMINAL_DESCRIPTOR,
    DEFAULT_GECKOTERMINAL_CONFIG,
    TRONGRID_CONFIG_KEY,
    DEFAULT_TRONGRID_CONFIG,
    MAX_TRONGRID_API_KEYS,
    type IProviderDescriptor,
    type ITronScanProviderConfig,
    type ICoinGeckoProviderConfig,
    type IGeckoTerminalProviderConfig,
    type ITronGridProviderConfig,
    type ITronGridProviderConfigMasked
} from '../database/index.js';

/** Number of trailing key characters left visible when masking. */
const MASK_VISIBLE_CHARS = 4;

/**
 * Raised when an operator's edit is rejected on its own terms — a blank key, a
 * duplicate, one key too many, a position that does not exist.
 *
 * A distinct type so the controller can answer 400 (the operator can fix it) for
 * these while still answering 500 for a genuine storage failure, instead of
 * flattening both into one opaque error.
 */
export class ProviderConfigValidationError extends Error {
    /**
     * @param message - Operator-facing reason, surfaced verbatim in the admin UI.
     */
    constructor(message: string) {
        super(message);
        this.name = 'ProviderConfigValidationError';
    }
}

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
     * Read a vendor's full config, merged over its defaults so callers always get
     * a complete object even before anything has been saved. Returns raw secrets —
     * for backend use (the vendor clients) only, never the admin API.
     *
     * @param vendorId - The vendor whose blob to read.
     * @param defaults - The vendor's complete default config, merged underneath.
     * @returns The effective config.
     */
    public async getConfig<T extends object>(vendorId: string, defaults: T): Promise<T> {
        const stored = await this.database.get<Partial<T>>(providerConfigKey(vendorId));
        return { ...defaults, ...(stored ?? {}) };
    }

    /**
     * The admin-safe view of a vendor's config: every field the descriptor marks
     * `secret` is reduced to `****` plus its last four characters and paired with
     * a `<key>Configured` boolean, so the UI can render "configured" without the
     * secret crossing the wire. Only descriptor fields are returned, so a stored
     * value the descriptor does not declare (such as a key pool) never leaks
     * through the generic path.
     *
     * @param descriptor - The vendor's descriptor, which names the fields and marks the secrets.
     * @param defaults - The vendor's complete default config.
     * @returns The masked config keyed by field.
     */
    public async getMaskedConfig(
        descriptor: IProviderDescriptor,
        defaults: object
    ): Promise<Record<string, unknown>> {
        const config = (await this.getConfig(descriptor.id, defaults)) as Record<string, unknown>;
        const masked: Record<string, unknown> = {};
        for (const field of descriptor.fields) {
            const value = config[field.key];
            if (field.kind === 'secret') {
                const secret = typeof value === 'string' ? value : '';
                masked[field.key] = ProviderConfigService.maskKey(secret);
                masked[`${field.key}Configured`] = secret.length > 0;
            } else {
                masked[field.key] = value;
            }
        }
        return masked;
    }

    /**
     * Merge a validated partial update over a vendor's stored config and persist
     * it. The controller is responsible for validating each field against the
     * descriptor, stripping a re-echoed mask, and resolving the clear sentinel
     * before calling this, so a secret is trusted as received: a string sets it,
     * `''` clears it, `undefined` leaves it.
     *
     * @param descriptor - The vendor's descriptor.
     * @param defaults - The vendor's complete default config.
     * @param updates - Fields to change; omitted fields are preserved.
     * @returns The new masked config (never a raw secret).
     */
    public async saveConfig(
        descriptor: IProviderDescriptor,
        defaults: object,
        updates: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        const current = (await this.getConfig(descriptor.id, defaults)) as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...current, ...updates };
        const summary: Record<string, unknown> = {};
        for (const field of descriptor.fields) {
            if (field.kind === 'secret') {
                // An empty secret means "clear"; drop the field so a meaningless
                // empty string is never persisted as if it were a credential.
                if (!merged[field.key]) {
                    delete merged[field.key];
                }
                summary[`${field.key}Configured`] = !!merged[field.key];
            } else {
                summary[field.key] = merged[field.key];
            }
        }
        await this.database.set(providerConfigKey(descriptor.id), merged);
        this.logger.info({ vendor: descriptor.id, ...summary }, 'Provider config saved');
        return this.getMaskedConfig(descriptor, defaults);
    }

    /**
     * Typed TronScan config for its client.
     *
     * @returns The effective TronScan config, raw key included.
     */
    public async getTronScanConfig(): Promise<ITronScanProviderConfig> {
        return this.getConfig(TRONSCAN_DESCRIPTOR.id, DEFAULT_TRONSCAN_CONFIG);
    }

    /**
     * Typed CoinGecko config for its client.
     *
     * @returns The effective CoinGecko config, raw key included.
     */
    public async getCoinGeckoConfig(): Promise<ICoinGeckoProviderConfig> {
        return this.getConfig(COINGECKO_DESCRIPTOR.id, DEFAULT_COINGECKO_CONFIG);
    }

    /**
     * Typed GeckoTerminal config for its client. The reserve floor is pinned to a
     * finite number because a hand-edited blob carrying a string would otherwise
     * make every pool comparison false and silently leave every token unpriced.
     *
     * @returns The effective GeckoTerminal config.
     */
    public async getGeckoTerminalConfig(): Promise<IGeckoTerminalProviderConfig> {
        const config = await this.getConfig(GECKOTERMINAL_DESCRIPTOR.id, DEFAULT_GECKOTERMINAL_CONFIG);
        if (typeof config.minPoolReserveUsd !== 'number' || !Number.isFinite(config.minPoolReserveUsd)) {
            config.minPoolReserveUsd = DEFAULT_GECKOTERMINAL_CONFIG.minPoolReserveUsd;
        }
        return config;
    }

    /**
     * Read the full TronGrid config, merged over defaults so callers always get a
     * complete object even before anything has been saved. Returns the raw keys —
     * backend use only, never the admin API.
     *
     * Nothing consumes this yet: the live TronGrid client still reads env. It
     * exists so the switchover is a change of call site, not of contract.
     *
     * @returns The effective TronGrid config.
     */
    public async getTronGridConfig(): Promise<ITronGridProviderConfig> {
        const stored = await this.database.get<Partial<ITronGridProviderConfig>>(TRONGRID_CONFIG_KEY);
        const merged: ITronGridProviderConfig = { ...DEFAULT_TRONGRID_CONFIG, ...(stored ?? {}) };
        // A blob written by an older shape (or hand-edited) could carry a
        // non-array under `apiKeys`; the rotator would then iterate a string
        // character by character, so normalise before anyone sees it.
        merged.apiKeys = Array.isArray(merged.apiKeys)
            ? merged.apiKeys.filter((key): key is string => typeof key === 'string' && key.length > 0)
            : [];
        // `fetchBlockReceipts` is the one field here that changes live behaviour,
        // so it is pinned to a real boolean rather than trusted from the blob. A
        // hand-edited or legacy document carrying a truthy string would otherwise
        // add an upstream call per block that no operator chose in the UI.
        merged.fetchBlockReceipts = merged.fetchBlockReceipts === true;
        return merged;
    }

    /**
     * The admin-safe view: every key reduced to `****` plus its last four
     * characters, in rotation order, so the UI can list and remove keys by
     * position without a secret crossing the wire.
     *
     * @returns The masked TronGrid config.
     */
    public async getMaskedTronGridConfig(): Promise<ITronGridProviderConfigMasked> {
        const config = await this.getTronGridConfig();
        return {
            enabled: config.enabled,
            fetchBlockReceipts: config.fetchBlockReceipts,
            baseUrl: config.baseUrl,
            apiKeys: config.apiKeys.map((key) => ProviderConfigService.maskKey(key)),
            apiKeyCount: config.apiKeys.length,
            requestThrottleMs: config.requestThrottleMs,
            maxQueueSize: config.maxQueueSize,
            requestTimeoutMs: config.requestTimeoutMs
        };
    }

    /**
     * Merge a partial update of the non-secret TronGrid fields over the stored
     * config and persist it.
     *
     * Keys are deliberately not writable here. A form that round-trips a list of
     * masked keys can overwrite real secrets with `****abcd` the moment two keys
     * share their last four characters, so key edits go through the explicit
     * {@link addTronGridApiKey} / {@link removeTronGridApiKey} pair instead.
     *
     * @param updates - Non-secret fields to change; omitted fields are preserved.
     * @returns The new masked config.
     */
    public async saveTronGridConfig(
        updates: Partial<Omit<ITronGridProviderConfig, 'apiKeys'>>
    ): Promise<ITronGridProviderConfigMasked> {
        const current = await this.getTronGridConfig();
        const merged: ITronGridProviderConfig = { ...current, ...updates };
        await this.database.set(TRONGRID_CONFIG_KEY, merged);
        this.logger.info(
            {
                enabled: merged.enabled,
                fetchBlockReceipts: merged.fetchBlockReceipts,
                baseUrl: merged.baseUrl,
                apiKeyCount: merged.apiKeys.length
            },
            'TronGrid provider config saved'
        );
        return this.getMaskedTronGridConfig();
    }

    /**
     * Append a key to the rotation pool.
     *
     * Duplicates are refused rather than tolerated: a repeated key would take two
     * slots in the round-robin and quietly double that account's share of the
     * request load, which looks like a rotation bug long after the paste that
     * caused it.
     *
     * @param apiKey - The raw key an operator pasted.
     * @returns The new masked config.
     * @throws ProviderConfigValidationError When the key is blank, already stored, or would exceed {@link MAX_TRONGRID_API_KEYS}.
     */
    public async addTronGridApiKey(apiKey: string): Promise<ITronGridProviderConfigMasked> {
        const trimmed = apiKey.trim();
        if (!trimmed) {
            throw new ProviderConfigValidationError('An API key is required.');
        }
        const current = await this.getTronGridConfig();
        if (current.apiKeys.includes(trimmed)) {
            throw new ProviderConfigValidationError('That API key is already stored.');
        }
        if (current.apiKeys.length >= MAX_TRONGRID_API_KEYS) {
            throw new ProviderConfigValidationError(
                `At most ${MAX_TRONGRID_API_KEYS} API keys can be stored. Remove one first.`
            );
        }
        const merged: ITronGridProviderConfig = { ...current, apiKeys: [...current.apiKeys, trimmed] };
        await this.database.set(TRONGRID_CONFIG_KEY, merged);
        this.logger.info({ apiKeyCount: merged.apiKeys.length }, 'TronGrid API key added');
        return this.getMaskedTronGridConfig();
    }

    /**
     * Remove the key at a rotation position. The admin UI addresses keys by index
     * because it only ever sees masked values, so the position is the one handle
     * both sides can agree on.
     *
     * @param index - Zero-based position in the rotation order.
     * @returns The new masked config.
     * @throws ProviderConfigValidationError When no key occupies that position.
     */
    public async removeTronGridApiKey(index: number): Promise<ITronGridProviderConfigMasked> {
        const current = await this.getTronGridConfig();
        if (!Number.isInteger(index) || index < 0 || index >= current.apiKeys.length) {
            throw new ProviderConfigValidationError('No API key at that position.');
        }
        const apiKeys = current.apiKeys.filter((_key, position) => position !== index);
        const merged: ITronGridProviderConfig = { ...current, apiKeys };
        await this.database.set(TRONGRID_CONFIG_KEY, merged);
        this.logger.info({ apiKeyCount: apiKeys.length }, 'TronGrid API key removed');
        return this.getMaskedTronGridConfig();
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
