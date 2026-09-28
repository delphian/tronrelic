/**
 * @fileoverview One Stake 2.0 staking entry from TronGrid's `/wallet/getaccount`.
 */

/**
 * The SUN an account has staked under Stake 2.0 for one resource, as one entry
 * of the `frozenV2` list in TronGrid's `/wallet/getaccount` response.
 *
 * A caller that needs an account's own stake, such as a market reading how
 * much energy a seller can delegate, reads it here rather than adding up the
 * freeze and unfreeze transactions it happened to observe. java-tron omits
 * default values from its JSON, so an entry with no `type` is bandwidth and an
 * entry with no `amount` holds nothing. A typical response lists three
 * entries: bandwidth, `ENERGY`, and `TRON_POWER`.
 */
export interface ITronGridFrozenV2Entry {
    /**
     * The resource the SUN is staked for: `ENERGY` or `TRON_POWER`. Absent for
     * bandwidth, because bandwidth is the protobuf default and java-tron leaves
     * it out, so a caller must read a missing type as bandwidth rather than
     * skip the entry.
     */
    type?: string;
    /**
     * The staked SUN for that resource whose resource the account still uses
     * itself. java-tron moves an amount out of this entry when the account
     * delegates it to another account, so a caller that wants the account's
     * total stake must add the matching `delegated_frozenV2_balance_for_*`
     * field. Absent when nothing is staked for the resource.
     */
    amount?: number;
}
