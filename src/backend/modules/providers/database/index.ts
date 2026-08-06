/**
 * @fileoverview Storage constants and config shapes for the providers module.
 *
 * Why here: external data providers (TronScan today, TronGrid next) carry
 * operator-set configuration — API keys, a base URL, pacing — that must live in
 * the database and be editable at runtime from the admin UI, never in env.
 * Centralizing the keys, the raw shapes, the masked shapes, and the defaults in
 * one file keeps the service, controller, and any future provider on the same
 * contract.
 */

/**
 * KV-store key under which the TronScan provider config blob is persisted via
 * `IDatabaseService.set`. One JSON document, read at request time so edits take
 * effect without a restart.
 */
export const TRONSCAN_CONFIG_KEY = 'provider:tronscan';

/** Sentinel a client may send in `apiKey` to explicitly clear a stored key. */
export const CLEAR_SENTINEL = '__clear__';

/** Price source the TronScan `/api/trx/volume` endpoint will report from. */
export type TronScanPriceSource = 'coinmarketcap' | 'coingecko';

/**
 * Raw TronScan provider config as stored. The `apiKey` is sensitive and never
 * leaves the backend unmasked.
 */
export interface ITronScanProviderConfig {
    /** Optional API key. TronScan works keyless at lower limits; a key lifts them. */
    apiKey?: string;
    /** API base, overridable only for testing/migration. */
    baseUrl: string;
    /** Which upstream source TronScan should report TRX prices from. */
    priceSource: TronScanPriceSource;
    /** Master switch: when false the price provider pauses TRX ingestion. */
    enabled: boolean;
}

/**
 * Admin-safe projection of {@link ITronScanProviderConfig}: the key is masked to
 * its last four characters and a boolean states whether one is set, so the UI can
 * show "configured" without ever receiving the secret.
 */
export interface ITronScanProviderConfigMasked {
    /** Masked key (`****abcd`) or empty when none is set. */
    apiKey: string;
    /** True when a non-empty key is stored — drives the UI "configured" state. */
    apiKeyConfigured: boolean;
    baseUrl: string;
    priceSource: TronScanPriceSource;
    enabled: boolean;
}

/**
 * Defaults applied when no config has been saved. Keyless and enabled, pointing
 * at the public TronScan API with CoinMarketCap as the reported source (the
 * endpoint's own default).
 */
export const DEFAULT_TRONSCAN_CONFIG: ITronScanProviderConfig = {
    baseUrl: 'https://apilist.tronscanapi.com',
    priceSource: 'coinmarketcap',
    enabled: true
};

/**
 * KV-store key under which the TronGrid provider config blob is persisted.
 *
 * Staged, not live: the running TronGrid client still reads `TRONGRID_API_KEY*`
 * and a hardcoded host from env and source. This blob exists so an operator can
 * enter the same settings in the database ahead of the switchover, after which
 * the client will read here and the env vars retire.
 */
export const TRONGRID_CONFIG_KEY = 'provider:trongrid';

/**
 * Ceiling on stored TronGrid API keys. TronGrid bills per key and the rotator
 * gains nothing from an unbounded pool, so the cap exists to stop a runaway
 * client (or a stuck "Add" button) from growing the blob without limit. Ten is
 * comfortably above the three env slots the platform ships with today.
 */
export const MAX_TRONGRID_API_KEYS = 10;

/**
 * Accepted ranges for the numeric TronGrid pacing fields, shared by the admin
 * controller (which rejects out-of-range writes) and the admin form (which
 * renders them as input bounds) so both agree on what is valid.
 */
export const TRONGRID_LIMITS = {
    /** Delay between outbound requests. 0 disables pacing entirely. */
    requestThrottleMs: { min: 0, max: 10_000 },
    /** Depth of the serial request queue before callers are rejected. */
    maxQueueSize: { min: 1, max: 10_000 },
    /** Per-request HTTP timeout. */
    requestTimeoutMs: { min: 1_000, max: 120_000 }
} as const;

/**
 * Raw TronGrid provider config as stored. `apiKeys` is sensitive and never
 * leaves the backend unmasked.
 *
 * The shape covers everything the current TronGrid client resolves from env or
 * hardcodes, so the eventual switchover is a change of source rather than a
 * change of contract: the host, the rotating key pool, the request pacing, the
 * queue ceiling, and the per-request timeout.
 */
export interface ITronGridProviderConfig {
    /**
     * Master switch for the future DB-backed client. Defaults to `false` because
     * nothing reads this config yet — an operator turns it on as part of the
     * switchover, not before.
     */
    enabled: boolean;
    /** API host used for both REST calls and the TronWeb full node, no trailing slash. */
    baseUrl: string;
    /**
     * Ordered API keys, rotated round-robin across requests. Empty means keyless:
     * TronGrid then applies its shared per-IP rate limit.
     */
    apiKeys: string[];
    /** Minimum delay between outbound requests, in milliseconds. */
    requestThrottleMs: number;
    /** Maximum queued requests before the client rejects new callers. */
    maxQueueSize: number;
    /** Per-request HTTP timeout, in milliseconds. */
    requestTimeoutMs: number;
}

/**
 * Admin-safe projection of {@link ITronGridProviderConfig}: each key is reduced
 * to `****` plus its last four characters and the count is stated separately, so
 * the UI can list and remove keys by position without ever receiving a secret.
 */
export interface ITronGridProviderConfigMasked {
    enabled: boolean;
    baseUrl: string;
    /** Masked keys in rotation order; index doubles as the removal handle. */
    apiKeys: string[];
    /** How many keys are stored — drives the "keyless" vs "N keys" UI state. */
    apiKeyCount: number;
    requestThrottleMs: number;
    maxQueueSize: number;
    requestTimeoutMs: number;
}

/**
 * Defaults applied when no TronGrid config has been saved. Deliberately not a
 * copy of the running deployment: no keys are carried over from env, and
 * `enabled` starts false so an unconfigured card can never be mistaken for a
 * live one. The numbers mirror the constants the current client hardcodes, so an
 * operator who saves the card unchanged reproduces today's behaviour.
 */
export const DEFAULT_TRONGRID_CONFIG: ITronGridProviderConfig = {
    enabled: false,
    baseUrl: 'https://api.trongrid.io',
    apiKeys: [],
    requestThrottleMs: 200,
    maxQueueSize: 100,
    requestTimeoutMs: 15_000
};
