/**
 * TRON blockchain chain parameters
 * Contains network-level configuration values and derived ratios
 */
export interface IChainParameters {
    /** Network identifier */
    network: 'mainnet' | 'testnet';

    /** Chain parameter values */
    parameters: {
        /** Total energy available per day across the network */
        totalEnergyLimit: number;

        /** Current energy limit (may differ from total during adjustments) */
        totalEnergyCurrentLimit: number;

        /** Total TRX frozen/staked for energy across network (in SUN) */
        totalFrozenForEnergy: number;

        /** Derived ratio: energy units per TRX when staking */
        energyPerTrx: number;

        /** Cost to burn energy (SUN per energy unit) */
        energyFee: number;

        /** Total bandwidth available per day across the network */
        totalBandwidthLimit: number;

        /** Total TRX frozen/staked for bandwidth across network (in SUN) */
        totalFrozenForBandwidth: number;

        /** Derived ratio: bandwidth units per TRX when staking */
        bandwidthPerTrx: number;
    };

    /** When these parameters were fetched from the blockchain */
    fetchedAt: Date;

    /** When this record was created in our database */
    createdAt: Date;
}
