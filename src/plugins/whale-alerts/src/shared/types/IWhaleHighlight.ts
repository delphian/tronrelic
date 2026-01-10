/**
 * Whale highlight record for dashboard display.
 */
export interface IWhaleHighlight {
    /** Transaction ID */
    txId: string;

    /** Transaction timestamp */
    timestamp: Date;

    /** Amount in TRX */
    amountTRX: number;

    /** Sender address */
    fromAddress: string;

    /** Receiver address */
    toAddress: string;

    /** Optional memo */
    memo?: string;
}
