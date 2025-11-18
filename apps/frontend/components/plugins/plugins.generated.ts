/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * This module is produced by scripts/generate-frontend-plugin-registry.mjs
 * and exposes lazy loaders for plugin frontend modules.
 */
import type { IPlugin } from '@tronrelic/types';

async function load_example_dashboard(): Promise<IPlugin> {
    const module = await import('../../../../packages/plugins/example-dashboard/src/frontend/frontend');
    return resolvePluginExport('example-dashboard', module);
}

async function load_resource_tracking(): Promise<IPlugin> {
    const module = await import('../../../../packages/plugins/resource-tracking/src/frontend/frontend');
    return resolvePluginExport('resource-tracking', module);
}

async function load_telegram_bot(): Promise<IPlugin> {
    const module = await import('../../../../packages/plugins/telegram-bot/src/frontend/frontend');
    return resolvePluginExport('telegram-bot', module);
}

async function load_whale_alerts(): Promise<IPlugin> {
    const module = await import('../../../../packages/plugins/whale-alerts/src/frontend/frontend');
    return resolvePluginExport('whale-alerts', module);
}

export const frontendPluginLoaders: Record<string, () => Promise<IPlugin>> = {
    'example-dashboard': load_example_dashboard,
    'resource-tracking': load_resource_tracking,
    'telegram-bot': load_telegram_bot,
    'whale-alerts': load_whale_alerts,
};

function resolvePluginExport(pluginId: string, module: Record<string, unknown>): IPlugin {
    const candidate = Object.values(module).find((value): value is IPlugin => {
        return typeof value === 'object' && value !== null && 'manifest' in value;
    });

    if (!candidate) {
        throw new Error(`Failed to locate plugin export for '${pluginId}'. Ensure the module exports an IPlugin.`);
    }

    return candidate;
}
