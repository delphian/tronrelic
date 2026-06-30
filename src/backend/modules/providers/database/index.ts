/**
 * @fileoverview Storage constants and config shapes for the providers module.
 *
 * Why here: external data providers (starting with TronScan) carry operator-set
 * configuration — an optional API key, a base URL, a price source — that must
 * live in the database and be editable at runtime from the admin UI, never in
 * env. Centralizing the key, the raw shape, the masked shape, and the defaults in
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
