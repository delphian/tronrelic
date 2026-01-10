/**
 * Represents a Telegram channel or group that the bot is a member of.
 * Tracks channel identity, membership status, and metadata.
 *
 * Why this interface exists:
 * The bot needs to track which channels it has been added to and is still
 * currently a member of. This enables features like broadcasting messages
 * to all channels, tracking bot usage across channels, and managing
 * channel-specific settings.
 */
export interface ITelegramChannel {
    /**
     * Telegram chat ID (unique identifier from Telegram API).
     * Negative for groups/channels, positive for private chats.
     */
    chatId: number;

    /**
     * Chat type from Telegram.
     * @example 'channel', 'supergroup', 'group', 'private'
     */
    type: string;

    /**
     * Channel/group title.
     * May be undefined for private chats.
     */
    title?: string;

    /**
     * Channel username (without @ prefix).
     * Only present for public channels/groups.
     * @example 'mychannel'
     */
    username?: string;

    /**
     * Whether the bot is currently a member of this channel.
     * Set to false when the bot is removed/kicked.
     */
    isActive: boolean;

    /**
     * Timestamp when the bot was first added to the channel.
     */
    joinedAt: Date;

    /**
     * Timestamp of the last update received from this channel.
     * Used to track activity and stale channels.
     */
    lastUpdate: Date;

    /**
     * Timestamp when the bot was removed from the channel.
     * Undefined if the bot is still a member.
     */
    leftAt?: Date;
}
