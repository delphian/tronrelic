/**
 * Whale transaction record stored in the plugin database.
 *
 * Tracks high-value TRX transfers that exceed the whale threshold for
 * historical analysis, Telegram notifications, and dashboard display.
 */
export interface IWhaleTransaction {
    /** Unique transaction ID from TRON blockchain */
    txId: string;

    /** Transaction timestamp from blockchain */
    timestamp: Date;

    /** Transaction amount in sun (smallest TRX unit) */
    amountSun: number;

    /** Transaction amount in TRX */
    amountTRX: number;

    /** Transaction amount in USD (if available) */
    amountUSD?: number;

    /** Sender wallet address */
    fromAddress: string;

    /** Receiver wallet address */
    toAddress: string;

    /** Pattern detected (e.g., 'exchange-withdrawal', 'accumulation') */
    pattern?: string;

    /** Cluster ID for grouping related whale activity */
    clusterId?: string;

    /** Confidence score for pattern detection (0-1) */
    confidence?: number;

    /** Telegram channel ID where notification was sent */
    channelId?: string;

    /** Telegram thread ID where notification was sent */
    threadId?: number;

    /** Threshold that triggered this whale alert */
    thresholdTRX: number;

    /** Timestamp when Telegram notification was sent (null if not sent) */
    notifiedAt?: Date | null;

    /** Record creation timestamp */
    createdAt: Date;

    /** Record last update timestamp */
    updatedAt: Date;
}
