import type { MarketFee, MarketOrder } from '@tronrelic/shared';
import {
    ENERGY_BUCKETS,
    DURATION_BUCKETS,
    type EnergyBucket,
    type DurationKey,
    type PricePoint,
    type PriceMatrix,
    type MarketPricingDetail
} from '@tronrelic/shared';
import { calculateUsdtTransferCostsForAllDurations, getMinUsdtTransferCost } from './usdt-transfer-calculator.js';

const SECONDS_PER_DAY = 86400;
const STANDARD_ENERGY_UNIT = 32_000;

/**
 * Normalizes a price to TRX per 32k energy per day for comparison.
 *
 * @param priceInTrx - Total price in TRX
 * @param energyAmount - Energy amount in units
 * @param durationSeconds - Duration in seconds
 * @returns Normalized price per standard unit
 */
function normalizePricePerUnit(priceInTrx: number, energyAmount: number, durationSeconds: number): number {
    if (energyAmount <= 0 || durationSeconds <= 0) {
        return 0;
    }

    // Convert to price per 32k energy per day
    const daysCount = durationSeconds / SECONDS_PER_DAY;
    const energyUnits = energyAmount / STANDARD_ENERGY_UNIT;

    return priceInTrx / (energyUnits * daysCount);
}

/**
 * Finds the closest duration bucket key for a given duration in seconds.
 *
 * @param durationSeconds - Duration to match
 * @returns Closest duration key
 */
function findClosestDuration(durationSeconds: number): DurationKey {
    const entries = Object.entries(DURATION_BUCKETS) as [DurationKey, number][];
    let closest: DurationKey = '1h';
    let minDiff = Infinity;

    for (const [key, value] of entries) {
        const diff = Math.abs(value - durationSeconds);
        if (diff < minDiff) {
            minDiff = diff;
            closest = key;
        }
    }

    return closest;
}

/**
 * Finds the closest energy bucket for a given energy amount.
 *
 * @param energy - Energy amount to match
 * @returns Closest energy bucket
 */
function findClosestEnergyBucket(energy: number): EnergyBucket {
    let closest: EnergyBucket = ENERGY_BUCKETS[0];
    let minDiff = Infinity;

    for (const bucket of ENERGY_BUCKETS) {
        const diff = Math.abs(bucket - energy);
        if (diff < minDiff) {
            minDiff = diff;
            closest = bucket;
        }
    }

    return closest;
}

/**
 * Formats an energy amount into a human-readable string.
 *
 * @param energy - Energy amount in units
 * @returns Formatted string (e.g., "64k", "1M")
 */
function formatEnergy(energy: number): string {
    if (energy >= 1_000_000) {
        return `${energy / 1_000_000}M`;
    }
    if (energy >= 1_000) {
        return `${energy / 1_000}k`;
    }
    return String(energy);
}

/**
 * Computes a pricing matrix from site fee schedules.
 *
 * @param fees - Array of market fees
 * @returns Price matrix or undefined if no fees
 */
function computeSiteFeeMatrix(fees: MarketFee[] | undefined): PriceMatrix | undefined {
    if (!fees || fees.length === 0) {
        return undefined;
    }

    const points: PricePoint[] = [];

    for (const fee of fees) {
        if (typeof fee.sun !== 'number' || typeof fee.minutes !== 'number') {
            continue;
        }

        const durationSeconds = fee.minutes * 60;
        const duration = findClosestDuration(durationSeconds);

        // fee.sun is the price PER UNIT of energy (e.g., 57 SUN per 1 energy unit)
        // Calculate price for each energy bucket
        for (const energy of ENERGY_BUCKETS) {
            // Total cost = price per unit × number of units
            const totalSun = fee.sun * energy;
            const priceInTrx = totalSun / 1_000_000; // Convert SUN to TRX
            const pricePerUnit = normalizePricePerUnit(priceInTrx, energy, durationSeconds);

            points.push({
                energy,
                duration,
                priceInTrx,
                pricePerUnit
            });
        }
    }

    if (points.length === 0) {
        return undefined;
    }

    const prices = points.map(p => p.pricePerUnit);
    const energies = points.map(p => p.energy);
    const durations = points.map(p => p.duration);

    return {
        points,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        energyRange: {
            min: Math.min(...energies) as EnergyBucket,
            max: Math.max(...energies) as EnergyBucket
        },
        durationRange: {
            min: durations.reduce((min, d) =>
                DURATION_BUCKETS[d] < DURATION_BUCKETS[min] ? d : min
            ),
            max: durations.reduce((max, d) =>
                DURATION_BUCKETS[d] > DURATION_BUCKETS[max] ? d : max
            )
        }
    };
}

/**
 * Computes a pricing matrix from marketplace orders.
 *
 * @param orders - Array of market orders
 * @returns Price matrix or undefined if no orders
 */
function computeMarketplaceOrderMatrix(orders: MarketOrder[] | undefined): PriceMatrix | undefined {
    if (!orders || orders.length === 0) {
        return undefined;
    }

    const points: PricePoint[] = [];

    for (const order of orders) {
        if (typeof order.energy !== 'number' || typeof order.duration !== 'number' || typeof order.payment !== 'number') {
            continue;
        }

        const energy = findClosestEnergyBucket(order.energy);
        const duration = findClosestDuration(order.duration);
        const priceInTrx = order.payment / 1_000_000;
        const pricePerUnit = normalizePricePerUnit(priceInTrx, order.energy, order.duration);

        points.push({
            energy,
            duration,
            priceInTrx,
            pricePerUnit
        });
    }

    if (points.length === 0) {
        return undefined;
    }

    const prices = points.map(p => p.pricePerUnit);
    const energies = points.map(p => p.energy);
    const durations = points.map(p => p.duration);

    return {
        points,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        energyRange: {
            min: Math.min(...energies) as EnergyBucket,
            max: Math.max(...energies) as EnergyBucket
        },
        durationRange: {
            min: durations.reduce((min, d) =>
                DURATION_BUCKETS[d] < DURATION_BUCKETS[min] ? d : min
            ),
            max: durations.reduce((max, d) =>
                DURATION_BUCKETS[d] > DURATION_BUCKETS[max] ? d : max
            )
        }
    };
}

/**
 * Computes complete pricing details for a market.
 *
 * @param fees - Site fee schedules
 * @param orders - Marketplace orders
 * @returns Complete pricing detail with separate matrices for fees and orders
 */
export async function computePricingDetail(
    fees: MarketFee[] | undefined,
    orders: MarketOrder[] | undefined
): Promise<MarketPricingDetail | undefined> {
    const siteFees = computeSiteFeeMatrix(fees);
    const marketplaceOrders = computeMarketplaceOrderMatrix(orders);

    if (!siteFees && !marketplaceOrders) {
        return undefined;
    }

    // Combine min/max from both sources for summary
    const allMinPrices: number[] = [];
    const allMaxPrices: number[] = [];
    const allEnergies: EnergyBucket[] = [];
    const allDurations: DurationKey[] = [];

    if (siteFees) {
        allMinPrices.push(siteFees.minPrice);
        allMaxPrices.push(siteFees.maxPrice);
        allEnergies.push(siteFees.energyRange.min, siteFees.energyRange.max);
        allDurations.push(siteFees.durationRange.min, siteFees.durationRange.max);
    }

    if (marketplaceOrders) {
        allMinPrices.push(marketplaceOrders.minPrice);
        allMaxPrices.push(marketplaceOrders.maxPrice);
        allEnergies.push(marketplaceOrders.energyRange.min, marketplaceOrders.energyRange.max);
        allDurations.push(marketplaceOrders.durationRange.min, marketplaceOrders.durationRange.max);
    }

    const minEnergy = Math.min(...allEnergies);
    const maxEnergy = Math.max(...allEnergies);
    const minDuration = allDurations.reduce((min, d) =>
        DURATION_BUCKETS[d] < DURATION_BUCKETS[min] ? d : min
    );
    const maxDuration = allDurations.reduce((max, d) =>
        DURATION_BUCKETS[d] > DURATION_BUCKETS[max] ? d : max
    );

    // Calculate USDT transfer costs from site fees (now async)
    const usdtTransferCosts = await calculateUsdtTransferCostsForAllDurations(fees);
    const minUsdtTransferCost = await getMinUsdtTransferCost(fees);

    return {
        siteFees,
        marketplaceOrders,
        usdtTransferCosts: usdtTransferCosts.length > 0 ? usdtTransferCosts : undefined,
        minUsdtTransferCost,
        summary: {
            minPrice: Math.min(...allMinPrices),
            maxPrice: Math.max(...allMaxPrices),
            energyRange: minEnergy === maxEnergy
                ? formatEnergy(minEnergy)
                : `${formatEnergy(minEnergy)}-${formatEnergy(maxEnergy)}`,
            durationRange: minDuration === maxDuration
                ? minDuration
                : `${minDuration}-${maxDuration}`
        }
    };
}
