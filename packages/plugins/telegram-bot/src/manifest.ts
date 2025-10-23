import type { IPluginManifest } from '@tronrelic/types';

/**
 * Telegram Bot plugin manifest.
 * This manifest centralizes shared metadata for the Telegram bot plugin. It enables both backend webhook handling
 * and frontend admin interface for bot configuration and monitoring.
 */
export const telegramBotManifest: IPluginManifest = {
    id: 'telegram-bot',
    title: 'Telegram Bot',
    version: '1.0.0',
    description: 'Telegram bot interface for market queries and notifications',
    author: 'TronRelic',
    license: 'MIT',
    backend: true,
    frontend: true,
    adminUrl: '/system/plugins/telegram-bot/settings'
};
