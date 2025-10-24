/**
 * Simple Telegram Bot API client for sending messages.
 * This is a lightweight implementation that doesn't depend on apps/backend services.
 *
 * Why inline implementation:
 * Plugins should be self-contained and not import from apps/backend at compile time.
 * This client provides the minimal Telegram API functionality needed for the bot plugin.
 */

/**
 * Message sending options.
 */
export interface ITelegramSendOptions {
    parseMode?: 'MarkdownV2' | 'HTML' | null;
    threadId?: number;
    disablePreview?: boolean;
    replyMarkup?: unknown;
}

/**
 * Simple Telegram Bot API client.
 */
export class TelegramClient {
    private readonly token: string;

    /**
     * Creates a Telegram client.
     *
     * @param token - Telegram bot token from BotFather
     *
     * Why token is required:
     * All Telegram API calls require authentication. Token is obtained from @BotFather
     * and is configured via the /system/settings admin UI (stored in database).
     */
    constructor(token: string) {
        this.token = token;
    }

    /**
     * Builds Telegram API URL for a method.
     *
     * @param method - API method name (e.g., 'sendMessage')
     * @returns Full API URL
     */
    private buildUrl(method: string): string {
        return `https://api.telegram.org/bot${this.token}/${method}`;
    }

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
    async sendMessage(chatId: string, text: string, options: ITelegramSendOptions = {}): Promise<void> {
        if (!this.token) {
            throw new Error('Telegram bot token not configured');
        }

        const { parseMode, threadId, disablePreview, replyMarkup } = options;
        const payload: Record<string, unknown> = {
            chat_id: chatId,
            text
        };

        if (threadId !== undefined) {
            payload.message_thread_id = threadId;
        }

        if (parseMode === undefined) {
            payload.parse_mode = 'MarkdownV2';
        } else if (parseMode) {
            payload.parse_mode = parseMode;
        }

        if (disablePreview !== undefined) {
            payload.disable_web_page_preview = disablePreview;
        }

        if (replyMarkup !== undefined) {
            payload.reply_markup = replyMarkup;
        }

        // Use dynamic import to avoid bundling axios at compile time
        const axios = (await import('axios')).default;

        await axios.post(this.buildUrl('sendMessage'), payload);
    }

    /**
     * Answers a callback query.
     *
     * @param callbackId - Callback query ID
     * @param text - Optional response text
     * @param showAlert - Whether to show alert instead of notification
     */
    async answerCallbackQuery(callbackId: string, text?: string, showAlert = false): Promise<void> {
        if (!this.token) {
            throw new Error('Telegram bot token not configured');
        }

        const payload: Record<string, unknown> = {
            callback_query_id: callbackId
        };

        if (text) {
            payload.text = text;
        }

        if (showAlert) {
            payload.show_alert = true;
        }

        const axios = (await import('axios')).default;

        await axios.post(this.buildUrl('answerCallbackQuery'), payload);
    }
}
