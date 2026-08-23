import type { IChainParameters } from './IChainParameters.js';

/**
 * Service interface for accessing TRON chain parameters
 * Provides energy/TRX conversion methods based on network state
 */
export interface IChainParametersService {
    /**
     * Initialize the service by warming the cache from database.
     * Call this at startup to ensure synchronous methods have data available.
     * @returns true if cache was warmed successfully, false if no data in DB yet
     */
    init(): Promise<boolean>;

    /**
     * Retrieve current chain parameters from cache or database
     * @returns Latest chain parameters
     */
    getParameters(): Promise<IChainParameters>;

    /**
     * Convert TRX amount to energy
     * @param trx - Amount in TRX
     * @returns Corresponding energy amount
     */
    getEnergyFromTRX(trx: number): number;

    /**
     * Convert TRX amount to bandwidth
     *
     * The bandwidth counterpart of getEnergyFromTRX, and synchronous for the
     * same reason. A caller holding a staked amount usually needs the resource
     * it yields without being able to await: a classifier on the block path is
     * the motivating case, because bandwidthPerTrx drifts with network-wide
     * staking, and a conversion performed later describes a different network
     * than the one the transaction happened on.
     *
     * @param trx - Amount in TRX
     * @returns Corresponding bandwidth amount, or 0 when the ratio is not
     *   available — the same degradation getEnergyFromTRX offers, so a caller
     *   that must distinguish "no bandwidth" from "not known" tests the result
     *   rather than assuming one
     */
    getBandwidthFromTRX(trx: number): number;

    /**
     * Convert energy amount to TRX
     * @param energy - Energy amount
     * @returns Corresponding TRX amount
     */
    getTRXFromEnergy(energy: number): number;

    /**
     * Calculate APY for energy rental
     * @param energy - Energy amount rented
     * @param sun - Rental price in SUN
     * @param days - Rental duration in days
     * @returns APY as percentage
     */
    getAPY?(energy: number, sun: number, days: number): number;

    /**
     * Get current energy fee (SUN per energy unit)
     * @returns Energy fee in SUN
     */
    getEnergyFee(): number;
}
