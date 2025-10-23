import type { IHttpRequest, IHttpResponse, IHttpNext, ILogger } from '@tronrelic/types';
import { validateTelegramWebhook } from './security.js';
import { CommandHandler, type ITelegramUpdate } from './command-handlers.js';

import type { TelegramClient } from './telegram-client.js';

/**
 * Creates a webhook handler for processing Telegram bot updates.
 * This handler validates security, routes commands, and sends responses.
 *
 * @param commandHandler - Command handler for processing bot commands
 * @param telegramService - Service for sending Telegram messages
 * @param logger - Logger for debugging and error tracking
 * @param securityOptions - IP allowlist and webhook secret configuration
 * @returns Express-compatible route handler
 *
 * Why separate webhook handler:
 * Webhook handling has distinct concerns: HTTP request validation, security checks,
 * JSON parsing, error handling. Separating it from command logic keeps both clean.
 */
export function createWebhookHandler(
    commandHandler: CommandHandler,
    telegramClient: TelegramClient,
    logger: ILogger,
    securityOptions: {
        allowedIps?: string;
        webhookSecret?: string;
    }
) {
    return async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext): Promise<void> => {
        try {
            // Security validation
            const isValid = await validateTelegramWebhook(req, securityOptions);

            if (!isValid) {
                // Extract client IP for logging
                const forwardedFor = req.headers['x-forwarded-for'];
                const clientIp = forwardedFor
                    ? (forwardedFor as string).split(',')[0].trim()
                    : req.ip || 'unknown';

                logger.warn(
                    {
                        clientIp,
                        requestIp: req.ip,
                        forwardedFor,
                        secretTokenPresent: !!req.headers['x-telegram-bot-api-secret-token'],
                        allowedIps: securityOptions.allowedIps || 'default (149.154.160.0/20,91.108.4.0/22)',
                        webhookSecretConfigured: !!securityOptions.webhookSecret
                    },
                    'REJECTED unauthorized Telegram webhook request'
                );
                res.status(403).json({ error: 'Forbidden' });
                return;
            }

            // Parse update
            const update = req.body as ITelegramUpdate;

            logger.debug(
                {
                    updateId: update.update_id,
                    hasMessage: !!update.message,
                    hasCallbackQuery: !!update.callback_query
                },
                'Received Telegram webhook'
            );

            // Route to command handler
            const response = await commandHandler.handleUpdate(update);

            if (response) {
                // Send response via Telegram client
                await telegramClient.sendMessage(response.chatId, response.text, {
                    parseMode: response.parseMode
                });

                logger.info(
                    {
                        chatId: response.chatId,
                        command: update.message?.text?.split(' ')[0]
                    },
                    'Sent Telegram response'
                );
            } else {
                logger.debug('Update ignored (no response generated)');
            }

            // Acknowledge webhook (200 OK tells Telegram we processed it)
            res.status(200).json({ ok: true });
        } catch (error) {
            logger.error({ error }, 'Failed to process Telegram webhook');

            // Still acknowledge to Telegram to prevent retries
            res.status(200).json({ ok: true });
        }
    };
}
