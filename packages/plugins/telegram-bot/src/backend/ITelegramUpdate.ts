/**
 * Telegram message object from webhook update.
 *
 * Why this interface exists:
 * Represents the message structure sent by Telegram Bot API webhooks.
 * Provides type safety when processing incoming messages.
 */
export interface ITelegramMessage {
    /**
     * Unique message identifier.
     */
    message_id: number;

    /**
     * Sender information (may be absent in channel posts).
     */
    from?: {
        /** Telegram user ID */
        id: number;
        /** Username (without @) */
        username?: string;
        /** User's first name */
        first_name?: string;
        /** User's last name */
        last_name?: string;
    };

    /**
     * Chat where message was sent.
     */
    chat: {
        /** Chat ID */
        id: number;
        /** Chat type (private, group, supergroup, channel) */
        type: string;
    };

    /**
     * Message text content.
     */
    text?: string;
}

/**
 * Telegram callback query from inline button press.
 *
 * Why this interface exists:
 * Represents callback queries triggered when users press inline keyboard buttons.
 */
export interface ITelegramCallbackQuery {
    /**
     * Unique callback query identifier.
     */
    id: string;

    /**
     * User who pressed the button.
     */
    from: {
        /** Telegram user ID */
        id: number;
        /** Username (without @) */
        username?: string;
        /** User's first name */
        first_name?: string;
        /** User's last name */
        last_name?: string;
    };

    /**
     * Data associated with the callback button.
     */
    data?: string;
}

/**
 * Telegram webhook update.
 *
 * Why this interface exists:
 * Represents the complete update structure sent by Telegram Bot API webhooks.
 * An update can contain either a message, a callback query, or other update types.
 *
 * @remarks
 * Only message and callback_query fields are currently implemented.
 * Additional update types (edited_message, channel_post, etc.) can be added as needed.
 */
export interface ITelegramUpdate {
    /**
     * Unique update identifier.
     */
    update_id: number;

    /**
     * New incoming message (optional).
     */
    message?: ITelegramMessage;

    /**
     * New incoming callback query from inline button (optional).
     */
    callback_query?: ITelegramCallbackQuery;
}
