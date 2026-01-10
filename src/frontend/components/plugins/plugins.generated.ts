/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * This module is produced by scripts/generate-frontend-plugin-registry.mjs
 * and exposes lazy loaders for plugin frontend modules.
 */
import type { IPlugin } from '@/types';

async function load_example_dashboard(): Promise<IPlugin> {
    const module = await import('../../../plugins/example-dashboard/src/frontend/frontend');
    return resolvePluginExport('example-dashboard', module);
}

async function load_resource_markets(): Promise<IPlugin> {
    const module = await import('../../../plugins/resource-markets/src/frontend/frontend');
    return resolvePluginExport('resource-markets', module);
}

async function load_resource_tracking(): Promise<IPlugin> {
    const module = await import('../../../plugins/resource-tracking/src/frontend/frontend');
    return resolvePluginExport('resource-tracking', module);
}

async function load_telegram_bot(): Promise<IPlugin> {
    const module = await import('../../../plugins/telegram-bot/src/frontend/frontend');
    return resolvePluginExport('telegram-bot', module);
}

async function load_delegation_pools(): Promise<IPlugin> {
    const module = await import('../../../plugins/trp-delegation-pools/src/frontend/frontend');
    return resolvePluginExport('delegation-pools', module);
}

async function load_dust_tracker(): Promise<IPlugin> {
    const module = await import('../../../plugins/trp-dust-tracker/src/frontend/frontend');
    return resolvePluginExport('dust-tracker', module);
}

async function load_memo_tracker(): Promise<IPlugin> {
    const module = await import('../../../plugins/trp-memo-tracker/src/frontend/frontend');
    return resolvePluginExport('memo-tracker', module);
}

async function load_whale_alerts(): Promise<IPlugin> {
    const module = await import('../../../plugins/whale-alerts/src/frontend/frontend');
    return resolvePluginExport('whale-alerts', module);
}

export const frontendPluginLoaders: Record<string, () => Promise<IPlugin>> = {
    'example-dashboard': load_example_dashboard,
    'resource-markets': load_resource_markets,
    'resource-tracking': load_resource_tracking,
    'telegram-bot': load_telegram_bot,
    'delegation-pools': load_delegation_pools,
    'dust-tracker': load_dust_tracker,
    'memo-tracker': load_memo_tracker,
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
