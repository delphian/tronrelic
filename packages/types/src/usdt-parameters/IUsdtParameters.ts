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
         * Energy cost for the first USDT transfer to an empty wallet
         * Higher cost due to initializing the token contract state for the recipient
         * Note: This may not be measurable via constant contract calls and may need
         * to be calculated as standardTransferEnergy * 2 as a conservative estimate
         */
        firstTimeTransferEnergy: number;
    };

    /** When these parameters were fetched from the blockchain */
    fetchedAt: Date;

    /** When this record was created in our database */
    createdAt: Date;
}
