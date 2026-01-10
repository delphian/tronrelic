/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * This module is produced by scripts/generate-backend-plugin-registry.mjs
 * and provides static imports for all discovered backend plugins.
 *
 * Regenerate by running: node scripts/generate-backend-plugin-registry.mjs
 */

import type { IPlugin, IPluginManifest } from '@/types';

import * as example_dashboard_manifest_module from '../../plugins/example-dashboard/src/manifest.js';
import * as resource_markets_manifest_module from '../../plugins/resource-markets/src/manifest.js';
import * as resource_markets_backend_module from '../../plugins/resource-markets/src/backend/backend.js';
import * as resource_tracking_manifest_module from '../../plugins/resource-tracking/src/manifest.js';
import * as resource_tracking_backend_module from '../../plugins/resource-tracking/src/backend/backend.js';
import * as telegram_bot_manifest_module from '../../plugins/telegram-bot/src/manifest.js';
import * as telegram_bot_backend_module from '../../plugins/telegram-bot/src/backend/backend.js';
import * as delegation_pools_manifest_module from '../../plugins/trp-delegation-pools/src/manifest.js';
import * as delegation_pools_backend_module from '../../plugins/trp-delegation-pools/src/backend/backend.js';
import * as dust_tracker_manifest_module from '../../plugins/trp-dust-tracker/src/manifest.js';
import * as dust_tracker_backend_module from '../../plugins/trp-dust-tracker/src/backend/backend.js';
import * as memo_tracker_manifest_module from '../../plugins/trp-memo-tracker/src/manifest.js';
import * as memo_tracker_backend_module from '../../plugins/trp-memo-tracker/src/backend/backend.js';
import * as whale_alerts_manifest_module from '../../plugins/whale-alerts/src/manifest.js';
import * as whale_alerts_backend_module from '../../plugins/whale-alerts/src/backend/backend.js';

/**
 * Finds the manifest export from a module.
 */
function findManifest(module: Record<string, unknown>): IPluginManifest | undefined {
    return Object.values(module).find(
        (exp): exp is IPluginManifest =>
            typeof exp === 'object' &&
            exp !== null &&
            'id' in exp &&
            'title' in exp &&
            'version' in exp
    );
}

/**
 * Finds the plugin export from a backend module.
 */
function findPlugin(module: Record<string, unknown>): IPlugin | undefined {
    return Object.values(module).find(
        (exp): exp is IPlugin =>
            typeof exp === 'object' &&
            exp !== null &&
            'manifest' in exp &&
            typeof (exp as Record<string, unknown>).manifest === 'object'
    );
}

/**
 * Resolves a full plugin from manifest and backend modules.
 */
function resolvePlugin(
    pluginId: string,
    manifestModule: Record<string, unknown>,
    backendModule: Record<string, unknown>
): IPlugin {
    const plugin = findPlugin(backendModule);
    if (!plugin) {
        throw new Error(`Failed to resolve plugin export for '${pluginId}'. Ensure backend.ts exports an IPlugin.`);
    }
    return plugin;
}

/**
 * Resolves a frontend-only plugin from its manifest module.
 */
function resolveManifestOnlyPlugin(
    pluginId: string,
    manifestModule: Record<string, unknown>
): IPlugin {
    const manifest = findManifest(manifestModule);
    if (!manifest) {
        throw new Error(`Failed to resolve manifest for '${pluginId}'. Ensure manifest.ts exports an IPluginManifest.`);
    }
    return { manifest };
}

/**
 * All discovered plugins with their compiled exports.
 *
 * This array is populated at import time with statically-imported plugins.
 * The loader iterates this array instead of scanning the filesystem.
 */
export const discoveredPlugins: IPlugin[] = [
    resolveManifestOnlyPlugin('example-dashboard', example_dashboard_manifest_module),
    resolvePlugin('resource-markets', resource_markets_manifest_module, resource_markets_backend_module),
    resolvePlugin('resource-tracking', resource_tracking_manifest_module, resource_tracking_backend_module),
    resolvePlugin('telegram-bot', telegram_bot_manifest_module, telegram_bot_backend_module),
    resolvePlugin('delegation-pools', delegation_pools_manifest_module, delegation_pools_backend_module),
    resolvePlugin('dust-tracker', dust_tracker_manifest_module, dust_tracker_backend_module),
    resolvePlugin('memo-tracker', memo_tracker_manifest_module, memo_tracker_backend_module),
    resolvePlugin('whale-alerts', whale_alerts_manifest_module, whale_alerts_backend_module),
];
