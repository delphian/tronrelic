/**
 * Symbol and decimals of a TRC20 token, read from the token contract itself.
 *
 * A token amount on chain is an integer in the token's smallest unit, so any
 * figure shown to a person or compared with a human threshold needs the
 * token's decimals. Guessing them (USDT's 6 is the usual default) silently
 * scales every figure by powers of ten for a token that uses something else.
 */
export interface ITrc20TokenInfo {
    /** Base58 address of the token contract. */
    contractAddress: string;

    /** Symbol the contract reports from `symbol()`, or null when it has none. */
    symbol: string | null;

    /** Name the contract reports from `name()`, or null when it has none. */
    name: string | null;

    /** Decimal places the contract reports from `decimals()`. */
    decimals: number;
}
