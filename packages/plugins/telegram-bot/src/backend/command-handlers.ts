import type { ILogger, IPluginDatabase } from '@tronrelic/types';
import type { ITelegramUser } from '../shared/index.js';
import { MarketQueryService } from './market-query.service.js';

/**
 * Telegram message object from webhook update.
 */
interface ITelegramMessage {
    message_id: number;
    from?: {
        id: number;
        username?: string;
        first_name?: string;
        last_name?: string;
    };
    chat: {
        id: number;
        type: string;
    };
    text?: string;
}

/**
 * Telegram update from webhook.
 */
export interface ITelegramUpdate {
    update_id: number;
    message?: ITelegramMessage;
    callback_query?: {
        id: string;
        from: {
            id: number;
            username?: string;
            first_name?: string;
            last_name?: string;
        };
        data?: string;
    };
}

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
export class CommandHandler {
    /**
     * Creates a command handler.
     *
     * @param database - Plugin database for user tracking
     * @param marketQueryService - Service for querying market prices
     * @param logger - Logger for debugging and error tracking
     */
    constructor(
        private readonly database: IPluginDatabase,
        private readonly marketQueryService: MarketQueryService,
        private readonly logger: ILogger
    ) {}

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
    private async trackUser(
        telegramId: number,
        username?: string,
        firstName?: string,
        lastName?: string
    ): Promise<void> {
        const collection = this.database.getCollection<ITelegramUser>('users');

        const existingUser = await collection.findOne({ telegramId });

        if (existingUser) {
            await collection.updateOne(
                { telegramId },
                {
                    $set: {
                        username,
                        firstName,
                        lastName,
                        lastInteraction: new Date()
                    },
                    $inc: { commandCount: 1 }
                }
            );
        } else {
            const newUser: ITelegramUser = {
                telegramId,
                username,
                firstName,
                lastName,
                subscriptions: [],
                lastInteraction: new Date(),
                commandCount: 1,
                createdAt: new Date()
            };
            await collection.insertOne(newUser as any);
        }
    }

    /**
     * Handles /start command.
     * Sends welcome message explaining bot capabilities with HTML formatting.
     *
     * @param update - Telegram update with message data
     * @returns Response object for webhook handler to send
     */
    async handleStart(update: ITelegramUpdate): Promise<ICommandResponse> {
        const message = update.message!;
        const chatId = String(message.chat.id);

        await this.trackUser(
            message.from!.id,
            message.from?.username,
            message.from?.first_name,
            message.from?.last_name
        );

        const text = `🤖 <b>Welcome to TronRelic Bot!</b>

I can help you with:

💰 <b>Market Prices</b>
• <code>/price</code> - Get cheapest USDT transfer cost
• <code>/price 100</code> - Cost for 100 transfers
• <code>/price 100 30</code> - Cost for 100 transfers over 30 days

🔔 <b>Notifications</b> <i>(coming soon)</i>
• <code>/subscribe &lt;type&gt;</code> - Subscribe to alerts
• <code>/unsubscribe &lt;type&gt;</code> - Unsubscribe

Need help? Just send me a message!`;

        return { chatId, text, parseMode: 'HTML' };
    }

    /**
     * Handles /subscribe command.
     * Stub implementation for future subscription feature.
     *
     * @param update - Telegram update with message data
     * @returns Response acknowledging subscription request
     */
    async handleSubscribe(update: ITelegramUpdate): Promise<ICommandResponse> {
        const message = update.message!;
        const chatId = String(message.chat.id);

        await this.trackUser(
            message.from!.id,
            message.from?.username,
            message.from?.first_name,
            message.from?.last_name
        );

        const text = `🔔 <b>Subscription feature coming soon!</b>

Available subscription types will include:
• Whale alerts (large transfers)
• Market updates (price changes)
• Price alerts (threshold notifications)

Stay tuned!`;

        return { chatId, text, parseMode: 'HTML' };
    }

    /**
     * Handles /unsubscribe command.
     * Stub implementation for future subscription feature.
     *
     * @param update - Telegram update with message data
     * @returns Response acknowledging unsubscribe request
     */
    async handleUnsubscribe(update: ITelegramUpdate): Promise<ICommandResponse> {
        const message = update.message!;
        const chatId = String(message.chat.id);

        await this.trackUser(
            message.from!.id,
            message.from?.username,
            message.from?.first_name,
            message.from?.last_name
        );

        const text = `🔕 <b>Unsubscribe feature coming soon!</b>

You will be able to manage your subscriptions from this bot.`;

        return { chatId, text, parseMode: 'HTML' };
    }

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
    async handlePrice(update: ITelegramUpdate): Promise<ICommandResponse> {
        const message = update.message!;
        const chatId = String(message.chat.id);

        await this.trackUser(
            message.from!.id,
            message.from?.username,
            message.from?.first_name,
            message.from?.last_name
        );

        // Parse command arguments
        const text = message.text || '';
        const parts = text.trim().split(/\s+/);
        const args = parts.slice(1); // Remove '/price' command

        let transferCount = 1;
        let days = 1;

        // Parse first argument (transfer count)
        if (args.length >= 1) {
            const parsed = parseInt(args[0], 10);
            if (isNaN(parsed) || parsed <= 0) {
                return {
                    chatId,
                    text: '⚠️ Invalid transfer count. Please use a positive number.',
                    parseMode: 'HTML'
                };
            }
            transferCount = parsed;
        }

        // Parse second argument (days)
        if (args.length >= 2) {
            const parsed = parseInt(args[1], 10);
            if (isNaN(parsed) || parsed <= 0) {
                return {
                    chatId,
                    text: '⚠️ Invalid days. Please use a positive number.',
                    parseMode: 'HTML'
                };
            }
            days = parsed;
        }

        // Query markets
        try {
            const responseText = await this.marketQueryService.queryMarkets({
                transferCount,
                days,
                chatId
            });

            return { chatId, text: responseText, parseMode: 'HTML' };
        } catch (error) {
            this.logger.error({ error }, 'Failed to query markets');
            return {
                chatId,
                text: '⚠️ Failed to fetch market data. Please try again later.',
                parseMode: 'HTML'
            };
        }
    }

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
    async handleUpdate(update: ITelegramUpdate): Promise<ICommandResponse | null> {
        // Only process messages (ignore callback queries for now)
        if (!update.message || !update.message.text) {
            return null;
        }

        const message = update.message;

        // Only process private messages (DMs)
        if (message.chat.type !== 'private') {
            this.logger.debug({ chatType: message.chat.type }, 'Ignoring non-private message');
            return null;
        }

        // Ensure message has sender info
        if (!message.from) {
            this.logger.warn('Message missing from field');
            return null;
        }

        const text = (message.text || '').trim();

        // Extract command
        if (text.startsWith('/start')) {
            return this.handleStart(update);
        } else if (text.startsWith('/subscribe')) {
            return this.handleSubscribe(update);
        } else if (text.startsWith('/unsubscribe')) {
            return this.handleUnsubscribe(update);
        } else if (text.startsWith('/price')) {
            return this.handlePrice(update);
        } else {
            // Unknown command
            const chatId = String(message.chat.id);
            return {
                chatId,
                text: `❓ Unknown command. Try /start to see available commands.`,
                parseMode: 'HTML'
            };
        }
    }
}
