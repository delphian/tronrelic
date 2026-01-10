/**
 * Represents a Telegram user who has interacted with the bot.
 * Tracks user identity, activity, and subscription preferences.
 */
export interface ITelegramUser {
    /**
     * Telegram user ID (unique identifier from Telegram API).
     */
    telegramId: number;

    /**
     * Telegram username (without @ prefix, may be undefined if user has no username).
     */
    username?: string;

    /**
     * User's first name from Telegram profile.
     */
    firstName?: string;

    /**
     * User's last name from Telegram profile.
     */
    lastName?: string;

    /**
     * Array of notification types the user has subscribed to.
     * Examples: ['whale-alerts', 'market-updates', 'price-alerts']
     */
    subscriptions: string[];

    /**
     * Timestamp of the user's last interaction with the bot.
     * Used for activity tracking and rate limiting.
     */
    lastInteraction: Date;

    /**
     * Number of commands the user has issued (for analytics and rate limiting).
     */
    commandCount: number;

    /**
     * Timestamp when the user was first seen by the bot.
     */
    createdAt: Date;
}
