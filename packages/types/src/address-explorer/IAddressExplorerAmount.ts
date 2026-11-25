/**
 * @fileoverview A token amount as the address page receives it.
 *
 * Token amounts can exceed what a JavaScript number holds exactly, so both
 * forms arrive as decimal text, already converted by the backend.
 */

/**
 * One amount of TRX or a token, in base units and in whole tokens.
 */
export interface IAddressExplorerAmount {
    /** The amount in base units (SUN for TRX), as exact decimal text. */
    raw: string;
    /**
     * The amount in whole tokens as exact decimal text, such as `"12.5"`.
     * Null when the token's decimals are unknown, in which case only `raw`
     * can be shown.
     */
    value: string | null;
}
