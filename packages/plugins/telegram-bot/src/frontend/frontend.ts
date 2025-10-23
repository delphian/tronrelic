import { definePlugin } from '@tronrelic/types';
import { telegramBotManifest } from '../manifest';
import { TelegramBotSettingsPage } from './TelegramBotSettingsPage';

/**
 * Telegram Bot plugin frontend definition.
 *
 * Registers admin settings page for webhook configuration, user statistics,
 * and bot monitoring. The page is available at /system/plugins/telegram-bot/settings
 * and requires admin authentication.
 *
 * This plugin provides:
 * - Webhook URL display and copy functionality
 * - User statistics and activity monitoring
 * - Test notification form for verification
 * - Future: Subscription type management
 */
export const telegramBotFrontendPlugin = definePlugin({
    manifest: telegramBotManifest,

    /**
     * Navigation menu items.
     * Adds "Telegram Bot" to System > Plugins navigation.
     */
    menuItems: [
        {
            label: 'Telegram Bot',
            href: '/system/plugins/telegram-bot/settings',
            icon: 'MessageSquare',
            category: 'System',
            order: 100,
            adminOnly: true
        }
    ],

    /**
     * Admin pages.
     * Registered under /system/plugins/ namespace with admin authentication.
     */
    adminPages: [
        {
            path: '/system/plugins/telegram-bot/settings',
            component: TelegramBotSettingsPage,
            title: 'Telegram Bot Settings',
            requiresAdmin: true
        }
    ]
});

/**
 * Default export for plugin loader.
 */
export default telegramBotFrontendPlugin;
