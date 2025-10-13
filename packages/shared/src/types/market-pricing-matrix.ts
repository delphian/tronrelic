/**
 * Standard energy amount buckets for normalized pricing comparison.
 * Values represent energy units (not TRX).
 */
export const ENERGY_BUCKETS = [32_000, 64_000, 256_000, 1_000_000, 10_000_000] as const;

/**
 * Standard duration buckets for normalized pricing comparison.
 * Keys are human-readable labels, values are duration in seconds.
 */
export const DURATION_BUCKETS = {
    '1h': 3600,
    '3h': 10800,
    '1d': 86400,
    '3d': 259200,
    '7d': 604800,
    '30d': 2592000
} as const;

export type EnergyBucket = typeof ENERGY_BUCKETS[number];
export type DurationKey = keyof typeof DURATION_BUCKETS;

/**
 * A single normalized price point at a specific energy amount and duration.
 */
export interface PricePoint {
    /** Energy amount in units */
    energy: EnergyBucket;
    /** Duration key (e.g., "1h", "1d") */
    duration: DurationKey;
    /** Total cost in TRX for this energy amount and duration */
    priceInTrx: number;
    /** Normalized price per 32k energy per day */
    pricePerUnit: number;
}

/**
 * Collection of price points forming a pricing matrix.
 */
export interface PriceMatrix {
    /** All price points in this matrix */
    points: PricePoint[];
    /** Minimum price per unit across all points */
    minPrice: number;
    /** Maximum price per unit across all points */
    maxPrice: number;
    /** Range of energy amounts covered */
    energyRange: { min: EnergyBucket; max: EnergyBucket };
    /** Range of durations covered */
    durationRange: { min: DurationKey; max: DurationKey };
}

/**
 * USDT transfer cost information for a specific duration.
 */
export interface UsdtTransferCost {
    /** Duration in minutes */
    durationMinutes: number;
    /** Cost in TRX for a standard USDT transfer (65k energy) */
    costTrx: number;
}

/**
 * Complete pricing details for a market, separating site fees from marketplace orders.
 */
export interface MarketPricingDetail {
    /** Fixed pricing tiers offered by the platform */
    siteFees?: PriceMatrix;
    /** Dynamic pricing from P2P marketplace orders */
    marketplaceOrders?: PriceMatrix;
    /** USDT transfer costs for all available durations */
    usdtTransferCosts?: UsdtTransferCost[];
    /** Minimum USDT transfer cost across all durations */
    minUsdtTransferCost?: number;
    /** Summary of overall pricing across both sources */
    summary: {
        /** Lowest price per unit found */
        minPrice: number;
        /** Highest price per unit found */
        maxPrice: number;
        /** Human-readable energy range (e.g., "64k-1M") */
        energyRange: string;
        /** Human-readable duration range (e.g., "1h-1d") */
        durationRange: string;
    };
}
