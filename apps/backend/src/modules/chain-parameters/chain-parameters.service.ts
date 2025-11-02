import type { IChainParametersService, IChainParameters } from '@tronrelic/types';
import { ChainParametersModel } from '../../database/models/chain-parameters-model.js';
import { logger } from '../../lib/logger.js';

/**
 * Chain Parameters Service
 * Provides cached TRON network parameters for energy/TRX conversions
 * Implements ITrEnergyAdapter interface for use by market fetchers
 *
 * Why this exists:
 * Market fetchers need to convert between TRX and energy amounts based on current
 * network conditions. This service maintains fresh chain parameters from the database
 * and provides conversion methods that reflect real-time staking ratios.
 *
 * Singleton pattern ensures all consumers share the same cache instance.
 */
export class ChainParametersService implements IChainParametersService {
    private static instance: ChainParametersService | null = null;

    private cachedParams: IChainParameters | null = null;
    private cacheExpiry: number = 0;
    private readonly CACHE_TTL_MS = 60_000; // 1 minute

    /**
     * Private constructor to enforce singleton pattern.
     * Use getInstance() to access the service.
     */
    private constructor() {}

    /**
     * Get the singleton instance of ChainParametersService.
     *
     * Creates the instance on first call and reuses it for all subsequent calls.
     * This ensures all consumers share the same cache, preventing duplicate
     * database queries and improving performance.
     *
     * @returns Singleton instance of ChainParametersService
     */
    public static getInstance(): ChainParametersService {
        if (!ChainParametersService.instance) {
            ChainParametersService.instance = new ChainParametersService();
        }
        return ChainParametersService.instance;
    }

    /**
     * Get latest chain parameters from cache or database
     * Cache refreshes every minute to balance performance vs freshness
     * Database is updated every 10 minutes by ChainParametersFetcher
     *
     * @returns Latest chain parameters from mainnet
     */
    async getParameters(): Promise<IChainParameters> {
        if (this.cacheExpiry < Date.now()) {
            try {
                this.cachedParams = await ChainParametersModel.findOne({ network: 'mainnet' })
                    .sort({ fetchedAt: -1 })
                    .lean();

                this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

                if (!this.cachedParams) {
                    logger.warn('No chain parameters found in database, using fallback');
                    return this.getFallbackParameters();
                }
            } catch (error) {
                logger.error({ error }, 'Failed to fetch chain parameters from database');
                return this.getFallbackParameters();
            }
        }

        return this.cachedParams!;
    }

    /**
     * Convert TRX to energy using current network parameters
     * Uses energyPerTrx ratio calculated from network state
     *
     * @param trx - Amount in TRX
     * @returns Energy amount (floored to integer)
     */
    getEnergyFromTRX(trx: number): number {
        if (!this.cachedParams) {
            logger.warn('Chain parameters not loaded, returning 0');
            return 0;
        }
        return Math.floor(trx * this.cachedParams.parameters.energyPerTrx);
    }

    /**
     * Convert energy to TRX using current network parameters
     * Uses energyPerTrx ratio calculated from network state
     *
     * @param energy - Energy amount
     * @returns Amount in TRX
     */
    getTRXFromEnergy(energy: number): number {
        if (!this.cachedParams) {
            logger.warn('Chain parameters not loaded, returning 0');
            return 0;
        }
        return energy / this.cachedParams.parameters.energyPerTrx;
    }

    /**
     * Calculate APY for energy rental
     * Compares rental cost to staking value over time
     *
     * @param energy - Energy amount rented
     * @param sun - Rental price in SUN per energy unit
     * @param days - Rental duration in days
     * @returns APY as percentage (e.g., 15.5 for 15.5%)
     */
    getAPY(energy: number, sun: number, days: number): number {
        if (!this.cachedParams || days === 0) {
            return 0;
        }

        const trx = this.getTRXFromEnergy(energy);
        const cost = (energy * sun) / 1_000_000; // SUN to TRX
        const dailyReturn = cost / days / trx;
        return dailyReturn * 365 * 100; // APY as percentage
    }

    /**
     * Get current energy fee (SUN per energy unit)
     * This is the cost to burn energy on TRON network
     *
     * @returns Energy fee in SUN (typically 100)
     */
    getEnergyFee(): number {
        return this.cachedParams?.parameters.energyFee ?? 100;
    }

    /**
     * Fallback parameters when database is empty (first boot)
     * Uses approximate network averages based on historical data
     *
     * @returns Fallback chain parameters with conservative estimates
     */
    private getFallbackParameters(): IChainParameters {
        return {
            network: 'mainnet',
            parameters: {
                totalEnergyLimit: 180_000_000_000,
                totalEnergyCurrentLimit: 180_000_000_000,
                totalFrozenForEnergy: 32_000_000_000_000_000, // 32M TRX in SUN
                energyPerTrx: 5625, // Approximate ratio: 180B / 32M TRX
                energyFee: 100,
                totalBandwidthLimit: 43_200_000_000, // 43.2B bandwidth per day
                totalFrozenForBandwidth: 43_200_000_000_000_000, // 43.2M TRX in SUN
                bandwidthPerTrx: 1000 // Approximate ratio: 43.2B / 43.2M TRX
            },
            fetchedAt: new Date(),
            createdAt: new Date()
        };
    }
}
