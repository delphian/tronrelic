/**
 * @fileoverview Storage constants and config shapes for the providers module.
 *
 * Why here: external data providers (TronScan, TronGrid, CoinGecko,
 * GeckoTerminal) carry operator-set configuration — API keys, a base URL,
 * pacing — that must live in the database and be editable at runtime from the
 * admin UI, never in env. Centralizing the keys, the raw shapes, the masked
 * shapes, the defaults, and the field descriptors the generic admin card renders
 * from keeps the service, controller, frontend, and every vendor on the same
 * contract.
 */

/**
 * A capability a vendor can implement. The registry attaches one implementation
 * per capability to a vendor, and a consumer asks the registry for vendors by
 * capability rather than by name, so adding a vendor never changes a consumer.
 *
 * `price-history` — daily USD closing prices for TRX or TRC20 tokens.
 * `blocks` — block and transaction retrieval (declared for TronGrid ahead of the
 * `IBlockProvider` migration; nothing attaches to it yet).
 */
export type ProviderCapability = 'price-history' | 'blocks';

/**
 * Kinds of field the generic admin card can render and the generic save handler
 * can validate. Each kind carries its own validation rule in the controller, so
 * a vendor declares fields and gets a form and input guards for free.
 */
export type ProviderFieldKind = 'secret' | 'text' | 'url' | 'boolean' | 'select' | 'integer';

/**
 * One editable field on a vendor's configuration. Drives both the rendered form
 * and the server-side validation, so the two cannot disagree on what a field is.
 */
export interface IProviderFieldDescriptor {
    /** Property name on the stored config blob. */
    key: string;
    /** Form label. */
    label: string;
    /** How the field is rendered and validated. */
    kind: ProviderFieldKind;
    /** Short help text shown under the control. */
    hint?: string;
    /** Placeholder for text-like controls. */
    placeholder?: string;
    /** Options for a `select` field. */
    options?: ReadonlyArray<{ value: string; label: string }>;
    /** Inclusive lower bound for an `integer` field. */
    min?: number;
    /** Inclusive upper bound for an `integer` field. */
    max?: number;
}

/**
 * Everything the admin surface needs to know about a vendor without knowing the
 * vendor: identity, what it is for, where a key comes from, which capabilities
 * it declares, and the fields its card edits. Serializable, so the list endpoint
 * returns it as-is.
 */
export interface IProviderDescriptor {
    /** Stable vendor id; also the suffix of its KV key (`provider:<id>`). */
    id: string;
    /** Display name. */
    label: string;
    /** One or two sentences on what the vendor supplies to the platform. */
    description: string;
    /** Where an operator obtains credentials, when the vendor takes any. */
    docsUrl?: string;
    /** Capabilities the vendor declares. Implementations attach at runtime. */
    capabilities: ProviderCapability[];
    /** Editable fields, in display order. */
    fields: IProviderFieldDescriptor[];
    /**
     * True when the vendor has a bespoke admin card and bespoke routes instead of
     * the generic ones (TronGrid, whose rotating key pool does not fit a single
     * secret field). The list endpoint still includes it so the surface is
     * complete.
     */
    custom?: boolean;
}

/**
 * Build the KV-store key a vendor's config blob is persisted under via
 * `IDatabaseService.set`. One JSON document per vendor, read at request time so
 * edits take effect without a restart.
 *
 * @param vendorId - The vendor id.
 * @returns The KV key.
 */
export function providerConfigKey(vendorId: string): string {
    return `provider:${vendorId}`;
}

/** KV-store key under which the TronScan provider config blob is persisted. */
export const TRONSCAN_CONFIG_KEY = providerConfigKey('tronscan');

/** Sentinel a client may send in a secret field to explicitly clear a stored key. */
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
 * Defaults applied when no config has been saved. Keyless and enabled, pointing
 * at the public TronScan API with CoinMarketCap as the reported source (the
 * endpoint's own default).
 */
export const DEFAULT_TRONSCAN_CONFIG: ITronScanProviderConfig = {
    baseUrl: 'https://apilist.tronscanapi.com',
    priceSource: 'coinmarketcap',
    enabled: true
};

/** Admin descriptor for the TronScan vendor; the generic card renders from it. */
export const TRONSCAN_DESCRIPTOR: IProviderDescriptor = {
    id: 'tronscan',
    label: 'TronScan',
    description: 'Daily TRX price history from the TronScan explorer API. Serves TRX only; it has no per-token history.',
    docsUrl: 'https://docs.tronscan.org/api-endpoints/api-keys',
    capabilities: ['price-history'],
    fields: [
        { key: 'enabled', label: 'Enabled', kind: 'boolean', hint: 'When off, this vendor is skipped by price ingestion.' },
        {
            key: 'apiKey',
            label: 'API key (optional)',
            kind: 'secret',
            hint: 'TronScan works keyless at lower rate limits; a key raises them. Leave blank to stay keyless.',
            placeholder: 'Paste a TronScan API key'
        },
        {
            key: 'priceSource',
            label: 'Price source',
            kind: 'select',
            hint: 'Which upstream TronScan reports TRX prices from.',
            options: [
                { value: 'coinmarketcap', label: 'CoinMarketCap' },
                { value: 'coingecko', label: 'CoinGecko' }
            ]
        },
        { key: 'baseUrl', label: 'Base URL', kind: 'url', placeholder: DEFAULT_TRONSCAN_CONFIG.baseUrl }
    ]
};

/** KV-store key under which the CoinGecko provider config blob is persisted. */
export const COINGECKO_CONFIG_KEY = providerConfigKey('coingecko');

/**
 * Which CoinGecko key an operator holds. The two tiers send the key in different
 * headers and the Pro tier is served from a different host, so the client needs
 * to know which it has.
 */
export type CoinGeckoKeyTier = 'demo' | 'pro';

/** Base URL CoinGecko serves Pro keys from; the public host refuses them. */
export const COINGECKO_PRO_BASE_URL = 'https://pro-api.coingecko.com/api/v3';

/**
 * Raw CoinGecko provider config as stored. The `apiKey` is sensitive and never
 * leaves the backend unmasked.
 */
export interface ICoinGeckoProviderConfig {
    /** Master switch: when false the vendor is skipped by price ingestion. */
    enabled: boolean;
    /** Optional key. Keyless callers get the public rate limit and a 365-day history wall. */
    apiKey?: string;
    /** Which header the key travels in. Ignored when no key is set. */
    keyTier: CoinGeckoKeyTier;
    /** API base, no trailing slash. Pro keys must point at {@link COINGECKO_PRO_BASE_URL}. */
    baseUrl: string;
}

/**
 * Defaults applied when no CoinGecko config has been saved: keyless, enabled,
 * on the public host. Keyless is a real, working mode for this vendor, so it
 * starts enabled like TronScan does.
 */
export const DEFAULT_COINGECKO_CONFIG: ICoinGeckoProviderConfig = {
    enabled: true,
    keyTier: 'demo',
    baseUrl: 'https://api.coingecko.com/api/v3'
};

/** Admin descriptor for the CoinGecko vendor. */
export const COINGECKO_DESCRIPTOR: IProviderDescriptor = {
    id: 'coingecko',
    label: 'CoinGecko',
    description: 'Daily USD price history for TRX and for TRC20 tokens CoinGecko lists, looked up by contract address. Keyless access reaches back 365 days; a paid key removes that limit.',
    docsUrl: 'https://www.coingecko.com/en/api/pricing',
    capabilities: ['price-history'],
    fields: [
        { key: 'enabled', label: 'Enabled', kind: 'boolean', hint: 'When off, this vendor is skipped by price ingestion.' },
        {
            key: 'apiKey',
            label: 'API key (optional)',
            kind: 'secret',
            hint: 'Leave blank for keyless public access. A Demo key raises the rate limit; a paid key also unlocks history older than 365 days.',
            placeholder: 'Paste a CoinGecko API key'
        },
        {
            key: 'keyTier',
            label: 'Key tier',
            kind: 'select',
            hint: 'Demo keys use the public host. Pro keys are only accepted on the Pro host, so set the base URL to match.',
            options: [
                { value: 'demo', label: 'Demo (free)' },
                { value: 'pro', label: 'Pro (paid)' }
            ]
        },
        {
            key: 'baseUrl',
            label: 'Base URL',
            kind: 'url',
            hint: `Public: ${DEFAULT_COINGECKO_CONFIG.baseUrl}. Pro: ${COINGECKO_PRO_BASE_URL}.`,
            placeholder: DEFAULT_COINGECKO_CONFIG.baseUrl
        }
    ]
};

/** KV-store key under which the GeckoTerminal provider config blob is persisted. */
export const GECKOTERMINAL_CONFIG_KEY = providerConfigKey('geckoterminal');

/**
 * Raw GeckoTerminal provider config as stored. The vendor is keyless, so nothing
 * here is secret.
 */
export interface IGeckoTerminalProviderConfig {
    /** Master switch: when false the vendor is skipped by price ingestion. */
    enabled: boolean;
    /** API base, no trailing slash. */
    baseUrl: string;
    /**
     * Smallest pool, by USD reserve, the vendor will read a token's price from.
     * A thin pool moves on tiny trades and its candles are noise rather than a
     * market price, so an asset whose deepest pool is below this floor is left
     * unpriced instead of priced badly.
     */
    minPoolReserveUsd: number;
}

/**
 * Accepted range for the pool reserve floor, shared by the controller (which
 * rejects out-of-range writes) and the descriptor (which renders the bounds).
 */
export const GECKOTERMINAL_LIMITS = {
    minPoolReserveUsd: { min: 0, max: 100_000_000 }
} as const;

/** Defaults applied when no GeckoTerminal config has been saved. */
export const DEFAULT_GECKOTERMINAL_CONFIG: IGeckoTerminalProviderConfig = {
    enabled: true,
    baseUrl: 'https://api.geckoterminal.com/api/v2',
    minPoolReserveUsd: 10_000
};

/** Admin descriptor for the GeckoTerminal vendor. */
export const GECKOTERMINAL_DESCRIPTOR: IProviderDescriptor = {
    id: 'geckoterminal',
    label: 'GeckoTerminal',
    description: 'Daily USD prices for TRC20 tokens read from their deepest SunSwap liquidity pool. Keyless. Covers tokens no aggregator lists, but a pool only has a candle on days it traded.',
    docsUrl: 'https://www.geckoterminal.com/dex-api',
    capabilities: ['price-history'],
    fields: [
        { key: 'enabled', label: 'Enabled', kind: 'boolean', hint: 'When off, this vendor is skipped by price ingestion.' },
        {
            key: 'minPoolReserveUsd',
            label: 'Minimum pool reserve (USD)',
            kind: 'integer',
            hint: 'Tokens whose deepest pool holds less than this are left unpriced rather than priced from a pool too thin to trust.',
            min: GECKOTERMINAL_LIMITS.minPoolReserveUsd.min,
            max: GECKOTERMINAL_LIMITS.minPoolReserveUsd.max
        },
        { key: 'baseUrl', label: 'Base URL', kind: 'url', placeholder: DEFAULT_GECKOTERMINAL_CONFIG.baseUrl }
    ]
};

/**
 * KV-store key under which the TronGrid provider config blob is persisted.
 *
 * Staged, not live: the running TronGrid client still reads `TRONGRID_API_KEY*`
 * and a hardcoded host from env and source. This blob exists so an operator can
 * enter the same settings in the database ahead of the switchover, after which
 * the client will read here and the env vars retire.
 */
export const TRONGRID_CONFIG_KEY = providerConfigKey('trongrid');

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
    /**
     * Whether blockchain sync fetches transaction receipts for each block.
     *
     * Unlike every other field in this blob, this one is read at runtime today.
     * Sync passes `null` where a receipt would go, so `energy`, `bandwidth`, and
     * `internalTransactions` are absent on every transaction, and the block-level
     * `totalEnergyCost`, `totalEnergyUsed`, and `totalBandwidthUsed` totals that
     * sum them are therefore always zero. Turning this on adds one
     * `/wallet/gettransactioninfobyblocknum` call per block — one call for the
     * whole block, not one per transaction — and fills all of those in.
     *
     * Defaults to `false` so an untouched deployment keeps exactly the call
     * volume and the stored document shape it has today. It is deliberately
     * independent of {@link ITronGridProviderConfig.enabled}: that flag gates the
     * unrelated switchover to a DB-backed client and is still read by nothing, so
     * requiring it here would mean asking an operator to turn on a switch
     * documented as inert.
     */
    fetchBlockReceipts: boolean;
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
    /** Whether sync fetches per-block receipts. Live today; see the raw shape. */
    fetchBlockReceipts: boolean;
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
    // Off by default because turning it on changes live sync behaviour: an extra
    // upstream call per block, and transaction documents that suddenly carry
    // energy and bandwidth where they previously carried nothing.
    fetchBlockReceipts: false,
    baseUrl: 'https://api.trongrid.io',
    apiKeys: [],
    requestThrottleMs: 200,
    maxQueueSize: 100,
    requestTimeoutMs: 15_000
};

/**
 * Admin descriptor for the TronGrid vendor. Marked `custom` because its rotating
 * key pool is edited through dedicated add/remove routes and a bespoke card; the
 * fields listed here are informational for the vendor list, and the bespoke
 * controller handlers remain the validation authority.
 */
export const TRONGRID_DESCRIPTOR: IProviderDescriptor = {
    id: 'trongrid',
    label: 'TronGrid',
    description: 'Block, transaction, and account data for blockchain sync and account history. Connection settings are staged for the client switchover; the receipt switch is live.',
    docsUrl: 'https://www.trongrid.io/',
    capabilities: ['blocks'],
    custom: true,
    fields: [
        { key: 'enabled', label: 'Enabled', kind: 'boolean' },
        { key: 'fetchBlockReceipts', label: 'Fetch block receipts', kind: 'boolean' },
        { key: 'baseUrl', label: 'Base URL', kind: 'url' },
        { key: 'requestThrottleMs', label: 'Request throttle (ms)', kind: 'integer', ...TRONGRID_LIMITS.requestThrottleMs },
        { key: 'maxQueueSize', label: 'Max queue size', kind: 'integer', ...TRONGRID_LIMITS.maxQueueSize },
        { key: 'requestTimeoutMs', label: 'Request timeout (ms)', kind: 'integer', ...TRONGRID_LIMITS.requestTimeoutMs }
    ]
};
