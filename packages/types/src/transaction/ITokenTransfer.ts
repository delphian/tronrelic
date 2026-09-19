/**
 * A TRC20 token transfer requested by a `TriggerSmartContract` call, decoded
 * from its call data. It records what the call asked for, not proof that the
 * tokens moved.
 *
 * For a token transfer the transaction's own `to` is the token contract and
 * its TRX amount is the call value (normally zero), so the real recipient and
 * the token amount exist only inside the ABI-encoded call data. Block sync
 * decodes them once into this shape so observers do not each carry their own
 * decoder.
 *
 * Only the two standard movement methods are decoded: `transfer(address,uint256)`
 * and `transferFrom(address,address,uint256)`. Any other call leaves the
 * payload's `tokenTransfer` absent.
 */
export interface ITokenTransfer {
    /** Base58 address of the TRC20 token contract that was called. */
    contractAddress: string;

    /** Which standard transfer method was called. */
    method: 'transfer' | 'transferFrom';

    /**
     * Base58 address the tokens left. For `transfer` this is the transaction
     * signer; for `transferFrom` it is the address named in the call, which
     * may differ from the signer (an approved spender moving someone's tokens).
     */
    from: string;

    /** Base58 address the tokens were sent to. */
    to: string;

    /**
     * Amount in the token's smallest units, as a decimal string.
     *
     * A string because the ABI value is a uint256 and routinely exceeds what a
     * JavaScript number holds exactly. Divide by `10 ** decimals` for display,
     * using the token's own decimals.
     */
    rawAmount: string;
}
