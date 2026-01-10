import type { IHttpRequest, IHttpResponse, ISystemLogService, IPluginContext } from '@/types';
import { CommandHandler } from './command-handlers.js';
import type { TelegramBotService } from './telegram-bot.service.js';
/**
 * Creates a webhook handler for processing Telegram bot updates.
 * This handler validates security, routes commands, sends responses, and tracks channel membership.
 *
 * @param commandHandler - Command handler for processing bot commands
 * @param telegramBotService - Service for managing Telegram client and sending messages
 * @param context - Plugin context for database access and system services
 * @param logger - Logger for debugging and error tracking
 * @param securityOptions - IP allowlist and webhook secret configuration
 * @returns Express-compatible route handler
 *
 * Why separate webhook handler:
 * Webhook handling has distinct concerns: HTTP request validation, security checks,
 * JSON parsing, error handling. Separating it from command logic keeps both clean.
 *
 * Why use TelegramBotService instead of TelegramClient:
 * The service manages client lifecycle and allows hot-reload when bot token is updated
 * via the admin UI, without requiring backend restart.
 *
 * Why track channels:
 * The bot needs to maintain a list of all channels/groups it's been invited to for
 * broadcasting capabilities and usage monitoring.
 */
export declare function createWebhookHandler(commandHandler: CommandHandler, telegramBotService: TelegramBotService, context: IPluginContext, logger: ISystemLogService, securityOptions: {
    allowedIps?: string;
    webhookSecret?: string;
}): (req: IHttpRequest, res: IHttpResponse) => Promise<void>;
//# sourceMappingURL=webhook-handler.d.ts.map