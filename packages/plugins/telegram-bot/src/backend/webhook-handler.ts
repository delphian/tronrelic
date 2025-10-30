import type { IHttpRequest, IHttpResponse, ISystemLogService, IPluginContext } from '@tronrelic/types';
import { validateTelegramWebhook } from './security.js';
import { CommandHandler } from './command-handlers.js';
import type { ITelegramUpdate } from './ITelegramUpdate.js';
import type { TelegramBotService } from './telegram-bot.service.js';
import type { ITelegramChannel } from '../shared/index.js';

/**
 * Tracks channel membership by processing my_chat_member updates.
 * Updates the channels collection when the bot is added to or removed from chats.
 *
 * @param update - Telegram update containing chat member change
 * @param context - Plugin context with database access
 * @param logger - Logger for debugging
 *
 * Why this function exists:
 * The bot needs to track which channels it's been invited to and is still active in.
 * This enables features like broadcasting to all channels and monitoring bot usage.
 */
async function trackChannelMembership(
    update: ITelegramUpdate,
    context: IPluginContext,
    logger: ISystemLogService
): Promise<void> {
    if (!update.my_chat_member) {
        return;
    }

    const { chat, new_chat_member, old_chat_member } = update.my_chat_member;

    // Only track if the update is about the bot itself
    if (!new_chat_member.user.is_bot) {
        return;
    }

    const channelsCollection = context.database.getCollection<ITelegramChannel>('channels');

    // Determine if the bot is now active in this chat
    const wasActive = ['member', 'administrator', 'creator'].includes(old_chat_member.status);
    const isActive = ['member', 'administrator', 'creator'].includes(new_chat_member.status);

    const now = new Date();

    try {
        // Check if channel already exists
        const existingChannel = await channelsCollection.findOne({ chatId: chat.id });

        if (existingChannel) {
            // Update existing channel
            await channelsCollection.updateOne(
                { chatId: chat.id },
                {
                    $set: {
                        type: chat.type,
                        title: chat.title,
                        username: chat.username,
                        isActive: isActive,
                        lastUpdate: now,
                        ...(isActive ? {} : { leftAt: now })
                    }
                }
            );

            logger.info(
                {
                    chatId: chat.id,
                    title: chat.title,
                    wasActive,
                    isActive,
                    oldStatus: old_chat_member.status,
                    newStatus: new_chat_member.status
                },
                `Bot membership updated in ${chat.type}`
            );
        } else {
            // Create new channel entry
            const newChannel: ITelegramChannel = {
                chatId: chat.id,
                type: chat.type,
                title: chat.title,
                username: chat.username,
                isActive: isActive,
                joinedAt: now,
                lastUpdate: now,
                ...(isActive ? {} : { leftAt: now })
            };

            await channelsCollection.insertOne(newChannel as any);

            logger.info(
                {
                    chatId: chat.id,
                    title: chat.title,
                    type: chat.type,
                    isActive
                },
                `Bot ${isActive ? 'added to' : 'tracked'} new ${chat.type}`
            );
        }
    } catch (error) {
        logger.error(
            { error, chatId: chat.id, title: chat.title },
            'Failed to track channel membership'
        );
    }
}

/**
 * Tracks channel membership by inferring from message activity.
 * If we receive a message from a channel/group, we must be a member of it.
 *
 * @param update - Telegram update containing a message
 * @param context - Plugin context with database access
 * @param logger - Logger for debugging
 *
 * Why this function exists:
 * This provides a defensive backup mechanism for channel tracking. If my_chat_member
 * updates are missed or the bot was added before tracking was implemented, we can
 * infer membership from the fact that we're receiving messages. This ensures our
 * channel list stays accurate even if explicit membership events are lost.
 */
async function trackChannelFromMessage(
    update: ITelegramUpdate,
    context: IPluginContext,
    logger: ISystemLogService
): Promise<void> {
    if (!update.message) {
        return;
    }

    const { chat } = update.message;

    // Only track groups and channels, not private chats
    if (chat.type === 'private') {
        return;
    }

    const channelsCollection = context.database.getCollection<ITelegramChannel>('channels');
    const now = new Date();

    try {
        // Check if channel already exists
        const existingChannel = await channelsCollection.findOne({ chatId: chat.id });

        if (existingChannel) {
            // Update lastUpdate timestamp and ensure isActive is true
            // (if we're receiving messages, we must be active)
            if (!existingChannel.isActive) {
                await channelsCollection.updateOne(
                    { chatId: chat.id },
                    {
                        $set: {
                            isActive: true,
                            lastUpdate: now
                        },
                        $unset: {
                            leftAt: ''
                        }
                    }
                );

                logger.info(
                    {
                        chatId: chat.id,
                        title: chat.title,
                        type: chat.type
                    },
                    `Reactivated ${chat.type} based on message activity`
                );
            } else {
                // Just update lastUpdate
                await channelsCollection.updateOne(
                    { chatId: chat.id },
                    {
                        $set: {
                            lastUpdate: now
                        }
                    }
                );
            }
        } else {
            // Create new channel entry (we must be active if we're receiving messages)
            const newChannel: ITelegramChannel = {
                chatId: chat.id,
                type: chat.type,
                title: chat.title,
                username: undefined, // Message doesn't include username
                isActive: true,
                joinedAt: now,
                lastUpdate: now
            };

            await channelsCollection.insertOne(newChannel as any);

            logger.info(
                {
                    chatId: chat.id,
                    title: chat.title,
                    type: chat.type
                },
                `Discovered new ${chat.type} from message activity`
            );
        }
    } catch (error) {
        logger.error(
            { error, chatId: chat.id, title: chat.title },
            'Failed to track channel from message'
        );
    }
}

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
export function createWebhookHandler(
    commandHandler: CommandHandler,
    telegramBotService: TelegramBotService,
    context: IPluginContext,
    logger: ISystemLogService,
    securityOptions: {
        allowedIps?: string;
        webhookSecret?: string;
    }
) {
    return async (req: IHttpRequest, res: IHttpResponse): Promise<void> => {
        // Parse update first so it's available in catch block
        let update: ITelegramUpdate | undefined;

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
            update = req.body as ITelegramUpdate;

            // Determine update type (first key that's not update_id)
            const updateType = Object.keys(update).find(key => key !== 'update_id') || 'unknown';

            // Log summary at DEBUG level
            logger.debug(
                {
                    updateId: update.update_id,
                    updateType,
                    hasMessage: !!update.message,
                    hasCallbackQuery: !!update.callback_query
                },
                'Received Telegram webhook'
            );

            // Log full payload at TRACE level (most verbose)
            logger.trace(
                { fullUpdate: update },
                'Full Telegram webhook payload'
            );

            // Track channel membership (when bot is added/removed from chats)
            await trackChannelMembership(update, context, logger);

            // Track channel activity from messages (defensive backup for membership tracking)
            await trackChannelFromMessage(update, context, logger);

            // Route to command handler
            const response = await commandHandler.handleUpdate(update);

            if (response) {
                // Send response via Telegram bot service
                await telegramBotService.sendMessage(response.chatId, response.text, {
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

            // Try to send an error message to the user instead of silently failing
            try {
                const chatId = update?.message?.chat?.id || update?.callback_query?.from?.id;
                if (chatId) {
                    await telegramBotService.sendMessage(
                        String(chatId),
                        '⚠️ Sorry, something went wrong processing your request. Please try again later.',
                        { parseMode: null }
                    );
                    logger.info({ chatId }, 'Sent error notification to user');
                }
            } catch (notifyError) {
                logger.error({ notifyError }, 'Failed to send error notification to user');
            }

            // Still acknowledge to Telegram to prevent retries
            res.status(200).json({ ok: true });
        }
    };
}
