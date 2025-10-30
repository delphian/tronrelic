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
        /** Chat title (for groups and channels) */
        title?: string;
        /** Chat username (for public channels and supergroups) */
        username?: string;
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
 * Telegram chat object representing a channel, group, or private chat.
 *
 * Why this interface exists:
 * Represents chat information from Telegram Bot API.
 */
export interface ITelegramChat {
    /**
     * Unique chat identifier.
     */
    id: number;

    /**
     * Type of chat (private, group, supergroup, or channel).
     */
    type: string;

    /**
     * Title of the chat (for groups and channels).
     */
    title?: string;

    /**
     * Username of the chat (for public channels and supergroups).
     */
    username?: string;
}

/**
 * Telegram chat member status.
 *
 * Why this interface exists:
 * Represents the bot's membership status in a chat.
 */
export interface ITelegramChatMember {
    /**
     * Member's status in the chat.
     * @example 'member', 'administrator', 'creator', 'restricted', 'left', 'kicked'
     */
    status: string;

    /**
     * Information about the user.
     */
    user: {
        /** Telegram user ID */
        id: number;
        /** Whether this is a bot */
        is_bot: boolean;
        /** User's or bot's first name */
        first_name: string;
        /** Username (without @) */
        username?: string;
    };
}

/**
 * Telegram chat member update event.
 *
 * Why this interface exists:
 * Represents updates to chat member status, including when the bot
 * is added to or removed from channels/groups.
 */
export interface ITelegramChatMemberUpdated {
    /**
     * Chat where the status was changed.
     */
    chat: ITelegramChat;

    /**
     * User who changed the status.
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
     * Timestamp of the change.
     */
    date: number;

    /**
     * Previous member status.
     */
    old_chat_member: ITelegramChatMember;

    /**
     * New member status.
     */
    new_chat_member: ITelegramChatMember;
}

/**
 * Telegram webhook update.
 *
 * Why this interface exists:
 * Represents the complete update structure sent by Telegram Bot API webhooks.
 * An update can contain a message, a callback query, chat member updates, or other update types.
 *
 * @remarks
 * Currently implemented: message, callback_query, my_chat_member.
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

    /**
     * The bot's chat member status was updated (optional).
     * Triggers when the bot is added to or removed from a chat.
     */
    my_chat_member?: ITelegramChatMemberUpdated;
}
