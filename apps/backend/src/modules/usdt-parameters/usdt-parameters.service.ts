import type { IUsdtParametersService, IUsdtParameters } from '@tronrelic/types';
import { UsdtParametersModel } from '../../database/models/usdt-parameters-model.js';
import { logger } from '../../lib/logger.js';

/**
 * USDT Parameters Service
 * Provides cached USDT transaction energy costs for calculators and market fetchers
 *
 * Why this exists:
 * Market fetchers and USDT transfer calculators need to know how much energy a USDT
 * transfer actually costs. Rather than hardcoding 65,000 energy everywhere, this service
 * provides the real-time value fetched from the blockchain every 10 minutes.
 *
 * This is the single source of truth for USDT energy costs, replacing all hardcoded constants.
 *
 * Singleton pattern ensures all consumers share the same cache instance.
 */
export class UsdtParametersService implements IUsdtParametersService {
    private static instance: UsdtParametersService | null = null;

    private cachedParams: IUsdtParameters | null = null;
    private cacheExpiry: number = 0;
    private readonly CACHE_TTL_MS = 60_000; // 1 minute

    /**
     * Private constructor to enforce singleton pattern.
     * Use getInstance() to access the service.
     */
    private constructor() {}

    /**
     * Get the singleton instance of UsdtParametersService.
     *
     * Creates the instance on first call and reuses it for all subsequent calls.
     * This ensures all consumers share the same cache, preventing duplicate
     * database queries and improving performance.
     *
     * @returns Singleton instance of UsdtParametersService
     */
    public static getInstance(): UsdtParametersService {
        if (!UsdtParametersService.instance) {
            UsdtParametersService.instance = new UsdtParametersService();
        }
        return UsdtParametersService.instance;
    }

    /**
     * Get latest USDT parameters from cache or database
     * Cache refreshes every minute to balance performance vs freshness
     * Database is updated every 10 minutes by UsdtParametersFetcher
     *
     * @returns Latest USDT parameters from mainnet
     */
    async getParameters(): Promise<IUsdtParameters> {
        if (this.cacheExpiry < Date.now()) {
            try {
                this.cachedParams = await UsdtParametersModel.findOne({ network: 'mainnet' })
                    .sort({ fetchedAt: -1 })
                    .lean();

                this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

                if (!this.cachedParams) {
                    logger.warn('No USDT parameters found in database, using fallback');
                    this.cachedParams = this.getFallbackParameters();
                    return this.cachedParams;
                }
            } catch (error) {
                logger.error({ error }, 'Failed to fetch USDT parameters from database');
                this.cachedParams = this.getFallbackParameters();
                this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
                return this.cachedParams;
            }
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
        try {
            const latest = await UsdtParametersModel.findOne({ network: 'mainnet' })
                .sort({ fetchedAt: -1 })
                .select('fetchedAt')
                .lean();

            return latest ? latest.fetchedAt : null;
        } catch (error) {
            logger.error({ error }, 'Failed to fetch USDT parameters last update time');
            return null;
        }
    }

    /**
     * Fallback parameters when database is empty (first boot)
     * Uses historically measured values as conservative estimates
     *
     * @returns Fallback USDT parameters with measured baseline values
     */
    private getFallbackParameters(): IUsdtParameters {
        return {
            network: 'mainnet',
            contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            parameters: {
                standardTransferEnergy: 64_285, // Measured from TronGrid API
                firstTimeTransferEnergy: 128_570 // Conservative estimate: 2x standard
            },
            fetchedAt: new Date(),
            createdAt: new Date()
        };
    }
}
