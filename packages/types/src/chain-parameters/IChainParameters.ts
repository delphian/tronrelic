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

        /**
         * SUN paid to the Super Representative that produces each block
         * (`getWitnessPayPerBlock`). Absent on snapshots stored before the
         * field existed, and when TronGrid omits it, so a reader must treat
         * absence as "not known" rather than as zero.
         */
        blockRewardSun?: number;

        /**
         * SUN shared across the top 127 Super Representatives by votes for each
         * block (`getWitness127PayPerBlock`), which they pass to their voters
         * after commission. Absent under the same conditions as `blockRewardSun`.
         */
        voteRewardSun?: number;
    };

    /** When these parameters were fetched from the blockchain */
    fetchedAt: Date;

    /** When this record was created in our database */
    createdAt: Date;
}
