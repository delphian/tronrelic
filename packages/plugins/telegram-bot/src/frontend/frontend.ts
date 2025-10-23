import type { IFrontendPlugin, IPageConfig, IMenuItemConfig } from '@tronrelic/types';
import { telegramBotManifest } from '../manifest.js';
import { TelegramBotSettingsPage } from './TelegramBotSettingsPage.js';

/**
 * Telegram Bot plugin frontend.
 * Registers admin settings page and navigation menu item.
 *
 * This frontend provides:
 * - Admin settings page at /system/plugins/telegram-bot/settings
 * - Webhook configuration display and copy functionality
 * - User statistics and activity monitoring
 * - Test notification form for verification
 * - Future: Subscription type management
 */

/**
 * Menu item configuration.
 * Adds "Telegram Bot" to System > Plugins navigation.
 */
const menuItem: IMenuItemConfig = {
    id: 'telegram-bot',
    label: 'Telegram Bot',
    category: 'System',
    url: '/system/plugins/telegram-bot/settings',
    icon: 'MessageSquare', // Lucide React icon name
    order: 100,
    requiresAdmin: true // Only visible to authenticated admins
};

/**
 * Page configuration.
 * Registers settings page with dynamic routing system.
 */
const settingsPage: IPageConfig = {
    id: 'telegram-bot-settings',
    path: '/system/plugins/telegram-bot/settings',
    title: 'Telegram Bot Settings',
    component: TelegramBotSettingsPage,
    requiresAdmin: true // Requires admin authentication
};

/**
 * Frontend plugin export.
 * Must match structure expected by plugin loader.
 */
export const telegramBotFrontendPlugin: IFrontendPlugin = {
    manifest: telegramBotManifest,

    /**
     * Navigation menu items.
     * These appear in the main navigation sidebar.
     */
    menuItems: [menuItem],

    /**
     * Page components.
     * These are rendered via dynamic routing based on URL path.
     */
    pages: [settingsPage]
};

/**
 * Default export for plugin loader.
 */
export default telegramBotFrontendPlugin;
