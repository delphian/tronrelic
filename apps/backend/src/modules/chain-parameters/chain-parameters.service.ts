import type { IChainParametersService, IChainParameters, IDatabaseService } from '@tronrelic/types';
import { ChainParametersModel, type IChainParametersDocument } from '../../database/models/chain-parameters-model.js';
import { logger } from '../../lib/logger.js';

/**
 * Chain Parameters Service
 *
 * Provides cached TRON network parameters for energy/TRX conversions.
 * Implements IChainParametersService interface for use by market fetchers.
 *
 * Why this exists:
 * Market fetchers need to convert between TRX and energy amounts based on current
 * network conditions. This service maintains fresh chain parameters from the database
 * and provides conversion methods that reflect real-time staking ratios.
 *
 * Database access pattern:
 * Uses IDatabaseService for all MongoDB operations, enabling testability
 * through mock implementations. The ChainParametersModel is registered for
 * Mongoose schema validation and query building.
 *
 * Singleton pattern ensures all consumers share the same cache instance.
 */
export class ChainParametersService implements IChainParametersService {
    private static instance: ChainParametersService | null = null;
    private static database: IDatabaseService | null = null;

    private readonly COLLECTION_NAME = 'chainParameters';
    private cachedParams: IChainParameters | null = null;
    private cacheExpiry: number = 0;
    private readonly CACHE_TTL_MS = 60_000; // 1 minute

    /**
     * Private constructor to enforce singleton pattern.
     * Use setDependencies() then getInstance() to access the service.
     */
    private constructor() {}

    /**
     * Set dependencies for the service singleton.
     *
     * Must be called before getInstance() to inject the database service.
     * Typically called during application bootstrap in index.ts.
     *
     * @param database - Database service for MongoDB operations
     */
    public static setDependencies(database: IDatabaseService): void {
        ChainParametersService.database = database;

        // Create instance if needed and register model
        if (!ChainParametersService.instance) {
            ChainParametersService.instance = new ChainParametersService();
        }

        // Register Mongoose model for schema validation and query building
        database.registerModel('chainParameters', ChainParametersModel);
    }

    /**
     * Get the singleton instance of ChainParametersService.
     *
     * Creates the instance on first call and reuses it for all subsequent calls.
     * This ensures all consumers share the same cache, preventing duplicate
     * database queries and improving performance.
     *
     * @returns Singleton instance of ChainParametersService
     * @throws Error if setDependencies() has not been called
     */
    public static getInstance(): ChainParametersService {
        if (!ChainParametersService.instance) {
            ChainParametersService.instance = new ChainParametersService();
        }
        return ChainParametersService.instance;
    }

    /**
     * Initialize the service by warming the cache from database.
     *
     * Call this at startup to ensure synchronous methods like getEnergyFromTRX()
     * have data available immediately. Without this, those methods return 0 until
     * something calls getParameters() (e.g., /api/config endpoint).
     *
     * @returns true if cache was warmed successfully, false if no data in DB yet
     */
    async init(): Promise<boolean> {
        try {
            await this.getParameters();
            logger.info({ energyPerTrx: this.cachedParams?.parameters.energyPerTrx }, 'Chain parameters cache initialized');
            return true;
        } catch {
            logger.warn('Chain parameters not yet available in database');
            return false;
        }
    }

    /**
     * Get latest chain parameters from cache or database.
     *
     * Cache refreshes every minute to balance performance vs freshness.
     * Database is updated every 10 minutes by ChainParametersFetcher.
     *
     * @returns Latest chain parameters from mainnet
     * @throws Error if database service not initialized or no parameters found
     */
    async getParameters(): Promise<IChainParameters> {
        if (this.cacheExpiry < Date.now()) {
            if (!ChainParametersService.database) {
                throw new Error('ChainParametersService.setDependencies() must be called before using the service');
            }

            try {
                // Use registered model for sort support (IDatabaseService.findOne doesn't support sort)
                const model = ChainParametersService.database.getModel<IChainParametersDocument>(this.COLLECTION_NAME);
                this.cachedParams = await model.findOne({ network: 'mainnet' })
                    .sort({ fetchedAt: -1 })
                    .lean();
            } catch (error) {
                logger.error({ error }, 'Failed to fetch chain parameters from database');
                throw error;
            }

            if (!this.cachedParams) {
                const error = new Error('No chain parameters found in database. Chain parameters MUST be fetched from TronGrid before performing calculations.');
                logger.error(error.message);
                throw error;
            }

            // Only set cache expiry after successful fetch with valid data
            this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
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
     * Energy regenerates once per 24 hours, so minimum duration is 1 day.
     * Sub-daily rentals are clamped to 1 day for APY calculation.
     *
     * @param energy - Energy amount rented
     * @param sun - Rental price in SUN per energy unit
     * @param days - Rental duration in days
     * @returns APY as percentage (e.g., 15.5 for 15.5%)
     */
    getAPY(energy: number, sun: number, days: number): number {
        if (!this.cachedParams || days <= 0) {
            return 0;
        }

        const trx = this.getTRXFromEnergy(energy);
        const cost = (energy * sun) / 1_000_000; // SUN to TRX

        // Clamp duration to minimum 1 day (energy regeneration constraint)
        const effectiveDays = Math.max(1, days);

        return (cost / trx) * (365 / effectiveDays) * 100; // APY as percentage
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
}
