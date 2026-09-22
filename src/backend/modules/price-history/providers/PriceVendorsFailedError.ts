/**
 * @fileoverview The error the routing provider throws when no vendor priced an
 * asset and at least one vendor failed outright.
 */

/**
 * One vendor that threw during a routed fetch, other than by being disabled.
 */
export interface IPriceVendorFailure {
    /** Vendor id, so a log entry says which configuration card to check. */
    vendor: string;
    /** The vendor's error message, such as `HTTP 401: Unauthorized`. */
    message: string;
}

/**
 * Raised when a routed fetch produced no prices and one or more vendors threw.
 *
 * Exists for two reasons. A failing vendor's error message comes from the
 * shared HTTP client and never says which vendor sent it, so an operator
 * reading `HTTP 401: Unauthorized` in the logs could not tell which vendor's
 * key to fix. This error puts the vendor id in front of each message. It also
 * keeps a failure from being read as "no price exists": the service treats
 * this error as a failed tick and holds the asset on the shorter failure
 * backoff with its day bounds untouched, where an empty answer would park the
 * asset under the unpriced backoff. The service tells a vendor failure apart
 * from a storage failure by this type, so the router must raise it for every
 * fetch that failed because of the vendors.
 */
export class PriceVendorsFailedError extends Error {
    /** Every vendor that threw, in the order they were tried. */
    public readonly failures: IPriceVendorFailure[];

    /**
     * @param failures - The vendors that threw and what each one said. The
     *   message lists them as `vendor: message`, joined by `; `.
     */
    constructor(failures: IPriceVendorFailure[]) {
        super(failures.map((failure) => `${failure.vendor}: ${failure.message}`).join('; '));
        this.name = 'PriceVendorsFailedError';
        this.failures = failures;
    }
}
