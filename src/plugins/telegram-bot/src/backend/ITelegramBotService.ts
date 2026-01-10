import type { TelegramClient } from './telegram-client.js';

/**
 * Public interface for Telegram bot service.
 * Other plugins depend on this interface, not the concrete implementation.
 *
 * Why interface instead of class:
 * Interfaces enable dependency inversion. Consuming plugins depend on abstractions,
 * not concrete implementations. This makes testing easier and reduces coupling.
 */
export interface ITelegramBotService {
    /**
     * Sends a message to a Telegram chat.
     *
     * @param chatId - Telegram chat ID (user or channel)
     * @param text - Message text
     * @param options - Optional formatting and delivery options
     *
     * Use cases:
     * - Send whale alerts to configured channel
     * - Send price alerts to user DMs
     * - Send system notifications to admin channel
     */
    sendMessage(chatId: string, text: string, options?: {
        parseMode?: 'MarkdownV2' | 'HTML' | null;
        threadId?: number;
        disablePreview?: boolean;
    }): Promise<void>;

    /**
     * Sends a notification to a specific user.
     * Looks up user's chat ID from database and sends message.
     *
     * @param telegramUserId - Telegram user ID (from ITelegramUser)
     * @param message - Notification message
     *
     * Use cases:
     * - Send personalized alerts to users who subscribed
     * - Send confirmation messages after subscription changes
     *
     * Why separate from sendMessage:
     * This method handles user lookup and subscription checking automatically.
     * Consuming plugins don't need to know how to map user IDs to chat IDs.
     */
    sendNotification(telegramUserId: number, message: string): Promise<void>;

    /**
     * Checks if a user has subscribed to a notification type.
     *
     * @param telegramUserId - Telegram user ID
     * @param subscriptionType - Subscription type to check (e.g., 'whale-alerts')
     * @returns True if subscribed, false otherwise
     *
     * Use cases:
     * - Before sending notification, check if user wants it
     * - Display subscription status in UI
     *
     * Why this matters:
     * Prevents spam. Users should only receive notifications they explicitly subscribed to.
     */
    isSubscribed(telegramUserId: number, subscriptionType: string): Promise<boolean>;

    /**
     * Reloads the Telegram client with updated configuration.
     *
     * @returns True if reload succeeded, false if bot token not configured
     *
     * Why this method exists:
     * Allows bot token to be changed at runtime without restarting the backend.
     * Called after configuration is updated via the admin UI.
     */
    reloadClient(): Promise<boolean>;

    /**
     * Gets the active Telegram client instance.
     *
     * @returns TelegramClient if configured, null otherwise
     *
     * Why this method exists:
     * Allows direct access to the client for advanced use cases (webhook handlers,
     * admin endpoints, etc.) while still managing client lifecycle centrally.
     */
    getClient(): TelegramClient | null;

    /**
     * Checks if the Telegram client is ready to send messages.
     *
     * @returns True if client is initialized with valid bot token
     *
     * Why this matters:
     * Allows callers to check if bot is configured before attempting to send messages.
     */
    isReady(): boolean;
}
