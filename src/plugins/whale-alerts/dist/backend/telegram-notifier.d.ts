import type { IPluginDatabase, ISystemLogService } from '@/types';
/**
 * Telegram notification service for whale alerts.
 *
 * @deprecated This class implements direct Telegram API integration and will be removed
 * in a future version. The telegram-bot plugin now provides a centralized Telegram service
 * that should be used instead via plugin-to-plugin service architecture.
 *
 * Sends Telegram messages for unnotified whale transactions using a simple
 * HTTP API approach. This keeps the plugin independent of Telegram SDK libraries.
 *
 * Migration path:
 * 1. Install and enable telegram-bot plugin (configure bot token via /system/plugins admin UI)
 * 2. Wait for plugin-to-plugin service registry to be implemented
 * 3. Replace this class with calls to ITelegramBotService from context
 * 4. Remove TELEGRAM_TOKEN environment variable (bot tokens are now database-backed)
 */
export declare class TelegramNotifier {
    private readonly database;
    private readonly logger;
    private readonly telegramToken?;
    constructor(database: IPluginDatabase, logger: ISystemLogService, telegramToken?: string);
    /**
     * Process pending whale transactions and send Telegram notifications.
     *
     * Finds up to 10 unnotified whale transactions, sends them to the configured
     * Telegram channel/thread, and marks them as notified.
     */
    sendPendingNotifications(): Promise<void>;
    /**
     * Build Telegram message for a whale transaction.
     *
     * @param whale - Whale transaction to format
     * @returns Formatted message string
     */
    private buildWhaleMessage;
    /**
     * Send a message to Telegram via HTTP API.
     *
     * @param chatId - Telegram chat/channel ID
     * @param text - Message text
     * @param threadId - Optional message thread ID
     */
    private sendTelegramMessage;
}
//# sourceMappingURL=telegram-notifier.d.ts.map