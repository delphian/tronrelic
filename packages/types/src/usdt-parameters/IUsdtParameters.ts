/**
 * The USDT (Tether) TRC20 contract address on TRON mainnet — the single
 * source of truth for the dominant stablecoin's identity across the platform.
 * Consumers key USDT flow, energy-cost probes, and value-ledger aggregation on
 * this address; centralizing it here (rather than re-declaring a private const
 * per module) removes the drift risk of the same literal living in several
 * places. It is an immutable on-chain identifier, so it belongs in the shared
 * contract package alongside the USDT parameter types.
 */
export const USDT_CONTRACT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/**
 * USDT TRC20 token transaction parameters
 * Contains energy costs for different types of USDT transfers on TRON
 */
export interface IUsdtParameters {
    /** Network identifier */
    network: 'mainnet' | 'testnet';

    /** USDT contract address on TRON */
    contractAddress: string;

    /** Energy cost parameters */
    parameters: {
        /**
         * Energy cost for a standard USDT transfer to a wallet that already contains USDT
         * This is the most common case for regular transfers
         */
        standardTransferEnergy: number;

        /**
         * Energy cost for a USDT transfer to a wallet whose USDT balance is currently zero
         *
         * Costs more than a standard transfer because the recipient's balance is written
         * into an empty storage slot. It applies to any zero-balance wallet, including one
         * that held USDT before and emptied it. Measured by simulating a transfer to a
         * freshly generated address, never derived from the standard figure: the gap
         * between the two is not a fixed ratio.
         */
        firstTimeTransferEnergy: number;
    };

    /** When these parameters were fetched from the blockchain */
    fetchedAt: Date;

    /** When this record was created in our database */
    createdAt: Date;
}
