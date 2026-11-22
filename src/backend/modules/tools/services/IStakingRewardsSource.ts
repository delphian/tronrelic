/**
 * @fileoverview The TronGrid reads the staking rewards service depends on.
 *
 * Declared as a narrow interface so the service takes any implementation:
 * the shared `TronGridClient` in production, and a stub in tests. The reward
 * rates are not read here; they come from core's `chain-parameters` service,
 * which already polls TronGrid's chain parameters.
 */

import type { TronGridWitness } from '../../blockchain/tron-grid.client.js';

/**
 * Chain reads needed to work out every Super Representative's voter reward.
 */
export interface IStakingRewardsSource {
    /**
     * List every representative candidate with its votes.
     *
     * @returns Every candidate, with hex addresses.
     */
    listWitnesses(): Promise<TronGridWitness[]>;

    /**
     * Read the share of rewards one representative keeps.
     *
     * @param address - The representative's address.
     * @returns The percentage kept, from 0 to 100.
     */
    getBrokerage(address: string): Promise<number>;
}
