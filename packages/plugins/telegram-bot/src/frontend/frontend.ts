import dynamic from 'next/dynamic';
import { definePlugin } from '@tronrelic/types';
import { telegramBotManifest } from '../manifest';

/**
 * Lazily loaded page components.
 *
 * Using next/dynamic ensures CSS modules are code-split and only load when
 * the page is actually visited. Without this, static imports cause plugin CSS
 * to be bundled in shared chunks that load on every page (including homepage).
 */
const TelegramBotSettingsPage = dynamic(() =>
    import('./TelegramBotSettingsPage').then(m => m.TelegramBotSettingsPage)
);

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
 *
 * Note: This plugin does not register menu items. The settings page is accessed
 * directly via URL or through the System Monitor's plugin management interface.
 */
export const telegramBotFrontendPlugin = definePlugin({
    manifest: telegramBotManifest,

    /**
     * Admin pages.
     * Registered under /system/plugins/ namespace with admin authentication.
     *
     * The settings page is accessible at /system/plugins/telegram-bot/settings
     * but is not exposed in the navigation menu. This is intentional - the plugin
     * provides backend infrastructure (webhook handling, command processing) and
     * admin settings should be managed through the plugin system interface.
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
