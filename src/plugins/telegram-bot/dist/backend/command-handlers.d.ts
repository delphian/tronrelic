import type { ISystemLogService, IPluginDatabase } from '@/types';
import { MarketQueryService } from './market-query.service.js';
import type { ITelegramUpdate } from './ITelegramUpdate.js';
/**
 * Command handler response.
 */
interface ICommandResponse {
    chatId: string;
    text: string;
    parseMode?: 'MarkdownV2' | 'HTML' | null;
}
/**
 * Handles Telegram bot commands and generates appropriate responses.
 * Each command method validates input, performs business logic, and returns a formatted response.
 *
 * Why this pattern:
 * Separating command logic from webhook handling makes testing easier and keeps the
 * webhook handler thin (just routing and validation).
 */
export declare class CommandHandler {
    private readonly database;
    private readonly marketQueryService;
    private readonly logger;
    /**
     * Creates a command handler.
     *
     * @param database - Plugin database for user tracking
     * @param marketQueryService - Service for querying market prices
     * @param logger - Logger for debugging and error tracking
     */
    constructor(database: IPluginDatabase, marketQueryService: MarketQueryService, logger: ISystemLogService);
    /**
     * Tracks user interaction and updates database.
     * Creates new user record if this is the first interaction.
     *
     * @param telegramId - Telegram user ID
     * @param username - Telegram username (optional)
     * @param firstName - User's first name (optional)
     * @param lastName - User's last name (optional)
     *
     * Why tracking matters:
     * User tracking enables rate limiting, analytics, and subscription management.
     * Without it, we can't prevent abuse or personalize responses.
     */
    private trackUser;
    /**
     * Handles /start command.
     * Sends welcome message explaining bot capabilities with HTML formatting.
     *
     * @param update - Telegram update with message data
     * @returns Response object for webhook handler to send
     */
    handleStart(update: ITelegramUpdate): Promise<ICommandResponse>;
    /**
     * Handles /subscribe command.
     * Stub implementation for future subscription feature.
     *
     * @param update - Telegram update with message data
     * @returns Response acknowledging subscription request
     */
    handleSubscribe(update: ITelegramUpdate): Promise<ICommandResponse>;
    /**
     * Handles /unsubscribe command.
     * Stub implementation for future subscription feature.
     *
     * @param update - Telegram update with message data
     * @returns Response acknowledging unsubscribe request
     */
    handleUnsubscribe(update: ITelegramUpdate): Promise<ICommandResponse>;
    /**
     * Handles /price command with optional arguments.
     * Parses arguments and queries market data.
     *
     * @param update - Telegram update with message data
     * @returns Response with market pricing information
     *
     * Command formats:
     * - /price -> Cost for 1 USDT transfer, 1 day
     * - /price 100 -> Cost for 100 transfers, 1 day
     * - /price 100 30 -> Cost for 100 transfers over 30 days
     */
    handlePrice(update: ITelegramUpdate): Promise<ICommandResponse>;
    /**
     * Routes incoming Telegram updates to appropriate command handlers.
     * Validates message structure and extracts command.
     *
     * @param update - Telegram update from webhook
     * @returns Command response or null if update should be ignored
     *
     * Why routing here instead of webhook handler:
     * Keeps webhook handler focused on HTTP concerns (security, parsing).
     * Command routing is business logic that belongs in the command layer.
     */
    handleUpdate(update: ITelegramUpdate): Promise<ICommandResponse | null>;
}
export {};
//# sourceMappingURL=command-handlers.d.ts.map