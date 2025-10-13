import type { MarketFee } from '@tronrelic/shared';
import { UsdtParametersService } from '../usdt-parameters/usdt-parameters.service.js';

/**
 * Singleton instance of USDT parameters service
 * Provides real-time energy costs fetched from blockchain every 10 minutes
 *
 * Replaces hardcoded constants:
 * - OLD: USDT_TRANSFER_ENERGY_STANDARD = 65_000 (was inaccurate)
 * - NEW: usdtService.getStandardTransferEnergy() (returns ~64,285 from blockchain)
 */
const usdtService = new UsdtParametersService();

/**
 * Calculates the cost in TRX to rent energy for a single USDT transfer.
 *
 * **Critical insight:** Energy regenerates every 24 hours on TRON. When you rent
 * 65k energy for 7 days, you can actually make 7 USDT transfers (one per day) because
 * the energy refills. This function accounts for that by dividing the total rental cost
 * by the number of days.
 *
 * @param feeSun - Price in SUN **per unit of energy** (the rate when renting energyAmount)
 * @param energyAmount - Not used; kept for API compatibility
 * @param useFirstTime - Whether to calculate for first-time transfer (130k energy) vs standard (65k energy)
 * @param durationMinutes - Rental duration in minutes (used to calculate energy regeneration cycles)
 * @returns Cost in TRX for a single USDT transfer
 *
 * @example
 * // Rent 65k energy for 7 days at 538.46 SUN/unit
 * // Total cost: 538.46 * 65,000 = 35,000,000 SUN = 35 TRX
 * // With regeneration: 35 TRX / 7 days = 5 TRX per transfer
 * await calculateUsdtTransferCost(538.46, 65000, false, 10080) // Returns: 5.0
 */
export async function calculateUsdtTransferCost(
    feeSun: number,
    _energyAmount: number,
    useFirstTime = false,
    durationMinutes?: number
): Promise<number> {
    // Fetch actual energy cost from blockchain data (replaces hardcoded 65_000 / 130_000)
    const requiredEnergy = useFirstTime
        ? await usdtService.getFirstTimeTransferEnergy()
        : await usdtService.getStandardTransferEnergy();

    // Calculate total rental cost
    const totalSun = feeSun * requiredEnergy;
    const totalCostTrx = totalSun / 1_000_000;

    // Account for energy regeneration: energy refills every 24 hours
    // If renting for multiple days, you can use the energy multiple times
    if (durationMinutes && durationMinutes > 0) {
        const durationDays = durationMinutes / (24 * 60);

        // For durations >= 1 day, divide by number of days to get cost per transfer
        // For durations < 1 day (e.g., 1 hour), no regeneration benefit (divisor = 1)
        const regenerationCycles = Math.max(1, Math.floor(durationDays));

        return totalCostTrx / regenerationCycles;
    }

    // If no duration provided, return total cost (backward compatibility)
    return totalCostTrx;
}

/**
 * Calculates USDT transfer costs for all fee tiers in a market.
 * Accounts for energy regeneration by passing duration to the calculator.
 *
 * @param fees - Array of market fee schedules
 * @param useFirstTime - Whether to calculate for first-time transfers
 * @returns Array of {duration, cost} pairs for each fee tier
 */
export async function calculateUsdtTransferCostsForAllDurations(
    fees: MarketFee[] | undefined,
    useFirstTime = false
): Promise<Array<{ durationMinutes: number; costTrx: number }>> {
    if (!fees || fees.length === 0) {
        return [];
    }

    const validFees = fees.filter(fee => typeof fee.sun === 'number' && typeof fee.minutes === 'number');

    // Process all fees in parallel for better performance
    const results = await Promise.all(
        validFees.map(async fee => {
            const energyAmount = fee.energyAmount ?? 1_000_000;
            const durationMinutes = fee.minutes as number;

            // Pass duration to calculator for energy regeneration accounting
            const costTrx = await calculateUsdtTransferCost(
                fee.sun as number,
                energyAmount,
                useFirstTime,
                durationMinutes
            );

            return {
                durationMinutes,
                costTrx
            };
        })
    );

    return results;
}

/**
 * Finds the minimum USDT transfer cost across all durations.
 *
 * @param fees - Array of market fee schedules
 * @param useFirstTime - Whether to calculate for first-time transfers
 * @returns Minimum cost in TRX, or undefined if no fees available
 */
export async function getMinUsdtTransferCost(
    fees: MarketFee[] | undefined,
    useFirstTime = false
): Promise<number | undefined> {
    const costs = await calculateUsdtTransferCostsForAllDurations(fees, useFirstTime);

    if (costs.length === 0) {
        return undefined;
    }

    return Math.min(...costs.map(c => c.costTrx));
}
