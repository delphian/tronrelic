import { definePlugin, type IPluginContext, type IApiRouteConfig, type IHttpRequest, type IHttpResponse, type IHttpNext } from '@tronrelic/types';
import { telegramBotManifest } from '../manifest.js';
import type { ITelegramUser, ITelegramSubscription } from '../shared/index.js';
import { CommandHandler } from './command-handlers.js';
import { MarketQueryService } from './market-query.service.js';
import { createWebhookHandler } from './webhook-handler.js';
import { TelegramBotService } from './telegram-bot.service.js';

// Store context for API handlers
let pluginContext: IPluginContext;

/**
 * Telegram Bot plugin for TronRelic.
 * Handles all Telegram bot interactions including webhook callbacks, command processing,
 * and user management.
 *
 * This plugin replaces the core Telegram functionality that was deleted from the backend.
 * It provides:
 * - Secure webhook endpoint with IP allowlist and secret validation
 * - Bot command handlers (/start, /price, /subscribe, /unsubscribe)
 * - Market price queries with multi-day regeneration support
 * - User tracking and subscription management
 * - Admin interface for configuration and monitoring
 *
 * Architecture:
 * - Backend: Webhook endpoint, command handlers, market queries, user database
 * - Frontend: Admin page for settings and user statistics
 * - Plugin-to-plugin: Service stub for future cross-plugin communication
 */
export const telegramBotBackendPlugin = definePlugin({
    manifest: telegramBotManifest,

    /**
     * Install hook: Creates database indexes and seeds default configuration.
     * Runs once when plugin is first installed.
     *
     * @param context - Plugin context with database and logger
     *
     * Why this hook exists:
     * Database indexes are critical for query performance. Creating them in install()
     * ensures they exist before any queries run, preventing slow queries in production.
     */
    install: async (context: IPluginContext) => {
        context.logger.info('Installing telegram-bot plugin');

        // Create indexes for user collection
        const usersCollection = context.database.getCollection<ITelegramUser>('users');
        await usersCollection.createIndex({ telegramId: 1 }, { unique: true });
        await usersCollection.createIndex({ lastInteraction: -1 });
        await usersCollection.createIndex({ createdAt: -1 });

        context.logger.info('Created user collection indexes');

        // Seed default subscription types
        const subscriptionsCollection = context.database.getCollection<ITelegramSubscription>('subscriptions');
        const existingSubscriptions = await subscriptionsCollection.countDocuments();

        if (existingSubscriptions === 0) {
            const defaultSubscriptions: ITelegramSubscription[] = [
                {
                    id: 'whale-alerts',
                    name: 'Whale Alerts',
                    description: 'Get notified when large TRX transfers occur',
                    enabled: false, // Disabled until whale-alerts integration
                    sortOrder: 1
                },
                {
                    id: 'market-updates',
                    name: 'Market Updates',
                    description: 'Receive updates when energy market prices change significantly',
                    enabled: false, // Future feature
                    sortOrder: 2
                },
                {
                    id: 'price-alerts',
                    name: 'Price Alerts',
                    description: 'Custom price threshold notifications',
                    enabled: false, // Future feature
                    sortOrder: 3
                }
            ];

            await subscriptionsCollection.insertMany(defaultSubscriptions as any);
            context.logger.info({ count: defaultSubscriptions.length }, 'Seeded default subscription types');
        }

        // Store default configuration in key-value storage
        const existingConfig = await context.database.get('config');
        if (!existingConfig) {
            const defaultConfig = {
                webhookUrl: '', // Will be set when webhook is configured
                rateLimitPerUser: 10, // Max 10 commands per minute
                rateLimitWindowMs: 60000 // 1 minute window
            };
            await context.database.set('config', defaultConfig);
            context.logger.info('Created default configuration');
        }

        context.logger.info('Telegram-bot plugin installed successfully');
    },

    /**
     * Uninstall hook: Cleans up database collections and configuration.
     * Runs when plugin is uninstalled.
     *
     * @param context - Plugin context with database and logger
     *
     * Why cleanup matters:
     * Leaving orphaned data in MongoDB wastes space and creates confusion.
     * Clean uninstall ensures the plugin can be reinstalled from scratch.
     */
    uninstall: async (context: IPluginContext) => {
        context.logger.info('Uninstalling telegram-bot plugin');

        try {
            const usersCollection = context.database.getCollection('users');
            await usersCollection.drop();
            context.logger.info('Dropped users collection');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to drop users collection (may not exist)');
        }

        try {
            const subscriptionsCollection = context.database.getCollection('subscriptions');
            await subscriptionsCollection.drop();
            context.logger.info('Dropped subscriptions collection');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to drop subscriptions collection (may not exist)');
        }

        try {
            await context.database.delete('config');
            context.logger.info('Deleted configuration');
        } catch (error) {
            context.logger.warn({ error }, 'Failed to delete configuration');
        }

        context.logger.info('Telegram-bot plugin uninstalled');
    },

    /**
     * Enable hook: Called when plugin is enabled.
     * Currently no-op, but could start background services in the future.
     */
    enable: async (context: IPluginContext) => {
        context.logger.info('Telegram-bot plugin enabled');
    },

    /**
     * Disable hook: Called when plugin is disabled.
     * Stops background services and cleans up resources.
     */
    disable: async (context: IPluginContext) => {
        context.logger.info('Telegram-bot plugin disabled');
    },

    /**
     * Init hook: Initializes plugin services and registers routes.
     * Runs when backend starts up (after install/enable).
     *
     * @param context - Plugin context with all dependencies
     *
     * Why init is separate from install:
     * Install runs once (setup). Init runs every time the backend starts (runtime wiring).
     * This separation allows plugins to be enabled/disabled without reinstalling.
     */
    init: async (context: IPluginContext) => {
        pluginContext = context;
        context.logger.info('Initializing telegram-bot plugin');

        // Create Telegram client
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            context.logger.warn('TELEGRAM_BOT_TOKEN not set, bot functionality will be limited');
        }

        const { TelegramClient } = await import('./telegram-client.js');
        const telegramClient = new TelegramClient(botToken || '');

        // Create market query service
        // API base URL should point to backend API (adjust for Docker vs local)
        const apiBaseUrl = process.env.BACKEND_API_URL || 'http://localhost:4000/api';
        const marketQueryService = new MarketQueryService(apiBaseUrl, context.logger);

        // Create command handler
        const commandHandler = new CommandHandler(
            context.database,
            marketQueryService,
            context.logger
        );

        // Create webhook handler with security options from environment
        const webhookHandler = createWebhookHandler(
            commandHandler,
            telegramClient,
            context.logger,
            {
                allowedIps: process.env.TELEGRAM_IP_ALLOWLIST,
                webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET
            }
        );

        // Register webhook route
        const webhookRoute: IApiRouteConfig = {
            method: 'POST',
            path: '/webhook',
            handler: webhookHandler,
            description: 'Telegram bot webhook endpoint'
        };

        // Register config route
        const configRoute: IApiRouteConfig = {
            method: 'GET',
            path: '/config',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const config = await pluginContext.database.get('config');
                    const botTokenConfigured = !!botToken && botToken.length > 0;

                    res.json({
                        success: true,
                        config: {
                            ...(config || {}),
                            botTokenConfigured
                        }
                    });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get plugin configuration'
        };

        // Add routes to plugin (will be mounted at /api/plugins/telegram-bot/*)
        telegramBotBackendPlugin.routes = [webhookRoute, configRoute];

        // Log webhook URL for user to configure in Telegram
        const webhookUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/plugins/telegram-bot/webhook`;
        context.logger.info(
            { webhookUrl },
            'Telegram webhook endpoint ready. Configure this URL in your Telegram bot settings.'
        );

        // Store webhook URL in config for admin UI
        const config = await context.database.get('config') || {};
        await context.database.set('config', { ...config, webhookUrl });

        // PLUGIN-TO-PLUGIN SERVICE REGISTRATION (STUB)
        //
        // In the future, when IPluginContext includes serviceRegistry, this would be:
        //
        // const botService = new TelegramBotService(context.database, context.logger);
        // context.serviceRegistry.register('telegram-bot', botService);
        //
        // Then other plugins could consume it:
        //
        // const telegramService = context.serviceRegistry.get<ITelegramBotService>('telegram-bot');
        // if (telegramService) {
        //     await telegramService.sendNotification(userId, 'Whale detected!');
        // }
        //
        // This would enable whale-alerts, price-alerts, and other plugins to send
        // Telegram notifications without implementing their own Telegram logic.

        context.logger.info('Telegram-bot plugin initialized');
    },

    /**
     * API routes exposed by this plugin.
     * Routes are mounted at /api/plugins/telegram-bot/
     *
     * Currently populated dynamically in init() hook.
     */
    routes: [],

    /**
     * Admin routes exposed by this plugin.
     * Routes are mounted at /api/plugins/telegram-bot/system/
     *
     * Admin routes require ADMIN_API_TOKEN authentication.
     */
    adminRoutes: [
        {
            method: 'POST',
            path: '/configure-webhook',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const botToken = process.env.TELEGRAM_BOT_TOKEN;
                    if (!botToken) {
                        res.status(503).json({
                            success: false,
                            error: 'TELEGRAM_BOT_TOKEN not configured'
                        });
                        return;
                    }

                    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
                    if (!webhookSecret) {
                        res.status(503).json({
                            success: false,
                            error: 'TELEGRAM_WEBHOOK_SECRET not configured'
                        });
                        return;
                    }

                    // Get webhook URL from config
                    const config = await pluginContext.database.get('config');
                    const webhookUrl = config?.webhookUrl;

                    if (!webhookUrl) {
                        res.status(500).json({
                            success: false,
                            error: 'Webhook URL not found in configuration'
                        });
                        return;
                    }

                    // Call Telegram API to set webhook
                    const axios = (await import('axios')).default;
                    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;

                    const response = await axios.post(telegramApiUrl, {
                        url: webhookUrl,
                        secret_token: webhookSecret
                    });

                    if (response.data.ok) {
                        pluginContext.logger.info({ webhookUrl }, 'Telegram webhook configured successfully');
                        res.json({
                            success: true,
                            message: 'Webhook configured successfully',
                            webhookUrl,
                            telegramResponse: response.data
                        });
                    } else {
                        pluginContext.logger.error({ response: response.data }, 'Telegram API returned error');
                        res.status(500).json({
                            success: false,
                            error: response.data.description || 'Failed to configure webhook',
                            telegramResponse: response.data
                        });
                    }
                } catch (error: any) {
                    pluginContext.logger.error({ error }, 'Failed to configure webhook');

                    res.status(500).json({
                        success: false,
                        error: error.response?.data?.description || error.message || 'Failed to configure webhook'
                    });
                }
            },
            description: 'Configure Telegram webhook automatically using Telegram Bot API'
        },
        {
            method: 'POST',
            path: '/test',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const { chatId, message, threadId } = req.body;

                    if (!chatId || !message) {
                        res.status(400).json({
                            success: false,
                            error: 'chatId and message are required'
                        });
                        return;
                    }

                    const botToken = process.env.TELEGRAM_BOT_TOKEN;
                    if (!botToken) {
                        res.status(503).json({
                            success: false,
                            error: 'TELEGRAM_BOT_TOKEN not configured'
                        });
                        return;
                    }

                    // Import and use TelegramClient
                    const { TelegramClient } = await import('./telegram-client.js');
                    const telegramClient = new TelegramClient(botToken);

                    // Send test message with optional thread ID
                    await telegramClient.sendMessage(
                        chatId,
                        message,
                        {
                            parseMode: null, // Send plain text
                            threadId: threadId ? Number(threadId) : undefined
                        }
                    );

                    res.json({
                        success: true,
                        message: 'Test notification sent successfully'
                    });
                } catch (error: any) {
                    pluginContext.logger.error({ error }, 'Failed to send test notification');

                    // Return detailed error message
                    res.status(500).json({
                        success: false,
                        error: error.response?.data?.description || error.message || 'Failed to send test notification'
                    });
                }
            },
            description: 'Send a test notification to verify bot configuration'
        },
        {
            method: 'GET',
            path: '/stats',
            handler: async (req: IHttpRequest, res: IHttpResponse, next: IHttpNext) => {
                try {
                    const usersCollection = pluginContext.database.getCollection<ITelegramUser>('users');

                    // Calculate stats
                    const totalUsers = await usersCollection.countDocuments();

                    // Active users in last 24 hours
                    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const activeUsers24h = await usersCollection.countDocuments({
                        lastInteraction: { $gte: oneDayAgo }
                    });

                    // Total commands
                    const commandsResult = await usersCollection.aggregate<{ total: number }>([
                        {
                            $group: {
                                _id: null,
                                total: { $sum: '$commandCount' }
                            }
                        }
                    ]).toArray();

                    const totalCommands = commandsResult[0]?.total || 0;

                    // Subscription counts
                    const subscriptionResult = await usersCollection.aggregate<{ _id: string; count: number }>([
                        {
                            $unwind: '$subscriptions'
                        },
                        {
                            $group: {
                                _id: '$subscriptions',
                                count: { $sum: 1 }
                            }
                        }
                    ]).toArray();

                    const subscriptionCounts: Record<string, number> = {};
                    for (const item of subscriptionResult) {
                        subscriptionCounts[item._id] = item.count;
                    }

                    res.json({
                        success: true,
                        stats: {
                            totalUsers,
                            activeUsers24h,
                            totalCommands,
                            subscriptionCounts
                        }
                    });
                } catch (error) {
                    next(error);
                }
            },
            description: 'Get Telegram bot usage statistics'
        }
    ]
});
