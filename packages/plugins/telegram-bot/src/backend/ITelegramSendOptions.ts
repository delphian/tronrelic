/**
 * Message sending options for Telegram Bot API.
 *
 * Why this interface exists:
 * Provides type-safe configuration for message formatting and delivery options
 * when sending messages through the Telegram Bot API.
 */
export interface ITelegramSendOptions {
    /**
     * Parse mode for message text formatting.
     *
     * @remarks
     * - 'MarkdownV2' - Use Telegram's MarkdownV2 syntax
     * - 'HTML' - Use HTML formatting
     * - null - Send as plain text without parsing
     * - undefined - Defaults to 'MarkdownV2' in TelegramClient
     */
    parseMode?: 'MarkdownV2' | 'HTML' | null;

    /**
     * Message thread ID for sending to specific topic in forum/group.
     *
     * @remarks
     * Only applicable in supergroups with topics enabled.
     */
    threadId?: number;

    /**
     * Disable link preview in message.
     *
     * @remarks
     * When true, prevents Telegram from showing preview cards for URLs in the message.
     */
    disablePreview?: boolean;

    /**
     * Reply markup (inline keyboard, custom keyboard, etc.).
     *
     * @remarks
     * Type is unknown to avoid coupling to specific Telegram API types.
     * Callers should provide Telegram API-compatible markup objects.
     */
    replyMarkup?: unknown;
}
