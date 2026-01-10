import type { ITelegramSendOptions } from './ITelegramSendOptions.js';
/**
 * Simple Telegram Bot API client for sending messages.
 * This is a lightweight implementation that doesn't depend on apps/backend services.
 *
 * Why inline implementation:
 * Plugins should be self-contained and not import from apps/backend at compile time.
 * This client provides the minimal Telegram API functionality needed for the bot plugin.
 */
/**
 * Simple Telegram Bot API client.
 */
export declare class TelegramClient {
    private readonly token;
    /**
     * Creates a Telegram client.
     *
     * @param token - Telegram bot token from BotFather
     *
     * Why token is required:
     * All Telegram API calls require authentication. Token is obtained from @BotFather
     * and is configured via the /system/settings admin UI (stored in database).
     */
    constructor(token: string);
    /**
     * Builds Telegram API URL for a method.
     *
     * @param method - API method name (e.g., 'sendMessage')
     * @returns Full API URL
     */
    private buildUrl;
    /**
     * Sends a message to a Telegram chat.
     *
     * @param chatId - Chat ID (user or channel)
     * @param text - Message text
     * @param options - Optional formatting and delivery options
     *
     * Why async with error handling:
     * Telegram API calls can fail (network issues, rate limits, invalid chat IDs).
     * This method throws errors for the caller to handle (retry, log, etc.).
     */
    sendMessage(chatId: string, text: string, options?: ITelegramSendOptions): Promise<void>;
    /**
     * Answers a callback query.
     *
     * @param callbackId - Callback query ID
     * @param text - Optional response text
     * @param showAlert - Whether to show alert instead of notification
     */
    answerCallbackQuery(callbackId: string, text?: string, showAlert?: boolean): Promise<void>;
}
//# sourceMappingURL=telegram-client.d.ts.map