import type { IUsdtParametersService, IUsdtParameters, IDatabaseService } from '@tronrelic/types';
import { UsdtParametersModel, type IUsdtParametersDocument } from '../../database/models/usdt-parameters-model.js';
import { logger } from '../../lib/logger.js';

/**
 * USDT Parameters Service
 *
 * Provides cached USDT transaction energy costs for calculators and market fetchers.
 * Implements IUsdtParametersService interface.
 *
 * Why this exists:
 * Market fetchers and USDT transfer calculators need to know how much energy a USDT
 * transfer actually costs. Rather than hardcoding 65,000 energy everywhere, this service
 * provides the real-time value fetched from the blockchain every 10 minutes.
 *
 * This is the single source of truth for USDT energy costs, replacing all hardcoded constants.
 *
 * Database access pattern:
 * Uses IDatabaseService for all MongoDB operations, enabling testability
 * through mock implementations. The UsdtParametersModel is registered for
 * Mongoose schema validation and query building.
 *
 * Singleton pattern ensures all consumers share the same cache instance.
 */
export class UsdtParametersService implements IUsdtParametersService {
    private static instance: UsdtParametersService | null = null;
    private static database: IDatabaseService | null = null;

    private readonly COLLECTION_NAME = 'usdtParameters';
    private cachedParams: IUsdtParameters | null = null;
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
        UsdtParametersService.database = database;

        // Create instance if needed and register model
        if (!UsdtParametersService.instance) {
            UsdtParametersService.instance = new UsdtParametersService();
        }

        // Register Mongoose model for schema validation and query building
        database.registerModel('usdtParameters', UsdtParametersModel);
    }

    /**
     * Get the singleton instance of UsdtParametersService.
     *
     * Creates the instance on first call and reuses it for all subsequent calls.
     * This ensures all consumers share the same cache, preventing duplicate
     * database queries and improving performance.
     *
     * @returns Singleton instance of UsdtParametersService
     * @throws Error if setDependencies() has not been called
     */
    public static getInstance(): UsdtParametersService {
        if (!UsdtParametersService.instance) {
            UsdtParametersService.instance = new UsdtParametersService();
        }
        return UsdtParametersService.instance;
    }

    /**
     * Initialize the service by warming the cache from database.
     *
     * Call this at startup to ensure async methods like getStandardTransferEnergy()
     * have data available immediately. Without this, callers may encounter errors
     * if the database hasn't been populated yet.
     *
     * @returns true if cache was warmed successfully, false if no data in DB yet
     */
    async init(): Promise<boolean> {
        try {
            await this.getParameters();
            logger.info({ standardTransferEnergy: this.cachedParams?.parameters.standardTransferEnergy }, 'USDT parameters cache initialized');
            return true;
        } catch {
            logger.warn('USDT parameters not yet available in database');
            return false;
        }
    }

    /**
     * Get latest USDT parameters from cache or database.
     *
     * Cache refreshes every minute to balance performance vs freshness.
     * Database is updated every 10 minutes by UsdtParametersFetcher.
     *
     * @returns Latest USDT parameters from mainnet
     * @throws Error if database service not initialized or no parameters found
     */
    async getParameters(): Promise<IUsdtParameters> {
        if (this.cacheExpiry < Date.now()) {
            if (!UsdtParametersService.database) {
                throw new Error('UsdtParametersService.setDependencies() must be called before using the service');
            }

            try {
                // Use registered model for sort support (IDatabaseService.findOne doesn't support sort)
                const model = UsdtParametersService.database.getModel<IUsdtParametersDocument>(this.COLLECTION_NAME);
                this.cachedParams = await model.findOne({ network: 'mainnet' })
                    .sort({ fetchedAt: -1 })
                    .lean();
            } catch (error) {
                logger.error({ error }, 'Failed to fetch USDT parameters from database');
                throw error;
            }

            if (!this.cachedParams) {
                const error = new Error('No USDT parameters found in database. USDT parameters MUST be fetched from TronGrid before performing calculations.');
                logger.error(error.message);
                throw error;
            }

            // Only set cache expiry after successful fetch with valid data
            this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
        }

        return this.cachedParams!;
    }

    /**
     * Get energy cost for a standard USDT transfer (to existing wallet)
     * Most common case for regular USDT transfers
     *
     * @returns Energy units required for standard transfer
     */
    async getStandardTransferEnergy(): Promise<number> {
        const params = await this.getParameters();
        return params.parameters.standardTransferEnergy;
    }

    /**
     * Get energy cost for first-time USDT transfer (to empty wallet)
     * Higher cost due to contract state initialization
     *
     * @returns Energy units required for first-time transfer
     */
    async getFirstTimeTransferEnergy(): Promise<number> {
        const params = await this.getParameters();
        return params.parameters.firstTimeTransferEnergy;
    }

    /**
     * Get last update timestamp.
     *
     * Returns when the USDT parameters were last fetched from the network.
     * Use this to detect stale data or verify scheduled job health.
     *
     * @returns Last update timestamp or null if no data exists
     */
    async getLastUpdateTime(): Promise<Date | null> {
        if (!UsdtParametersService.database) {
            logger.warn('UsdtParametersService.setDependencies() not called, returning null');
            return null;
        }

        try {
            const model = UsdtParametersService.database.getModel<IUsdtParametersDocument>(this.COLLECTION_NAME);
            const latest = await model.findOne({ network: 'mainnet' })
                .sort({ fetchedAt: -1 })
                .select('fetchedAt')
                .lean();

            return latest ? latest.fetchedAt : null;
        } catch (error) {
            logger.error({ error }, 'Failed to fetch USDT parameters last update time');
            return null;
        }
    }
}
