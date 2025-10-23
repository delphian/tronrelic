/**
 * Options for market price queries via Telegram bot.
 * Allows users to customize energy cost calculations.
 */
export interface IMarketQueryOptions {
    /**
     * Number of USDT transfers to calculate cost for.
     * Default: 1
     */
    transferCount?: number;

    /**
     * Number of days to calculate rental cost over.
     * Accounts for energy regeneration (energy refills every 24 hours).
     * Default: 1
     */
    days?: number;

    /**
     * Telegram chat ID to send response to.
     */
    chatId: string;
}
