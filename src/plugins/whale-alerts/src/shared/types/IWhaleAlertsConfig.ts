/**
 * Plugin configuration stored in database.
 */
export interface IWhaleAlertsConfig {
    /** Minimum TRX amount to trigger whale alert */
    thresholdTRX: number;

    /** Enable/disable Telegram notifications */
    telegramEnabled: boolean;

    /** Telegram channel ID for notifications */
    telegramChannelId?: string;

    /** Telegram thread ID for notifications */
    telegramThreadId?: number;
}
