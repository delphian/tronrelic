/**
 * @fileoverview The energy fields of the `account_resource` object in TronGrid's `/wallet/getaccount`.
 */

/**
 * The energy side of an account's resource state, from the `account_resource`
 * object in TronGrid's `/wallet/getaccount` response.
 *
 * A caller working out how much energy an account controls needs this as well
 * as `frozenV2`, because staked SUN the account has delegated out still
 * appears in `frozenV2`, and SUN delegated to it by others appears only here.
 * Only the energy fields callers read today are declared. java-tron omits a
 * field whose value is zero, so an absent amount means none.
 */
export interface ITronGridAccountResource {
    /**
     * Staked SUN this account has delegated to other accounts as energy under
     * Stake 2.0. Subtract it from the `ENERGY` entry of `frozenV2` to get the
     * stake whose energy the account keeps for itself.
     */
    delegated_frozenV2_balance_for_energy?: number;
    /**
     * Staked SUN other accounts have delegated to this account as energy under
     * Stake 2.0. This is how a caller sees energy an account rents or borrows,
     * since that stake belongs to the delegator and never appears in this
     * account's `frozenV2`.
     */
    acquired_delegated_frozenV2_balance_for_energy?: number;
    /**
     * The window over which the account's used energy recovers. When
     * `energy_window_optimized` is true the value is in thousandths of a
     * three-second block slot, so the default of 28,800,000 is 28,800 slots,
     * or 24 hours. A caller estimating when spent energy is available again
     * needs it, because the window is recorded per account and is not always
     * the 24-hour default.
     */
    energy_window_size?: number;
    /**
     * Whether `energy_window_size` uses the finer unit described on that field.
     * A caller converting the window to time checks this first, because the
     * two units differ by a factor of 1,000.
     */
    energy_window_optimized?: boolean;
}
