/**
 * @fileoverview What the address page knows about one token it shows.
 *
 * Rows name a token only by its key (`TRX`, a TRC-10 id, or a TRC-20
 * contract address); each section carries this record once per key. The
 * symbol and name are chosen by whoever deployed the contract, so they prove
 * nothing and must be rendered as plain text.
 */

/**
 * Metadata for one token key.
 */
export interface IAddressExplorerToken {
    /** Which kind of asset the key names. */
    assetType: 'trx' | 'trc10' | 'trc20';
    /** The token's symbol, or null when it could not be read. */
    symbol: string | null;
    /** The token's name, or null when it could not be read. */
    name: string | null;
    /** Decimal places, or null when unknown. */
    decimals: number | null;
    /** Where the metadata came from, or why it is missing. */
    status: 'native' | 'resolved' | 'unresolved' | 'unreadable';
}
