/**
 * @file variables/database-access.ts
 *
 * Built-in dynamic prompt variables in the "Database Access" category.
 * Registered by {@link registerBuiltinVariables} via registerDatabaseAccessVariables.
 *
 * Lifted from the trp-ai-assistant plugin to core unchanged in behaviour; the
 * resolvers now read injected core services (`deps`) instead of `IPluginContext`.
 */

import type { IPromptVariableRegistry } from '@/types';
import type { IBuiltinVariableDeps } from './types.js';

/**
 * Register all "Database Access" built-in variables on the given registry.
 *
 * @param registry - The core prompt-variable registry.
 * @param deps - Injected core services the resolvers read at expansion time.
 */
export function registerDatabaseAccessVariables(
    registry: IPromptVariableRegistry,
    deps: IBuiltinVariableDeps
): void {
    registry.registerVariable({
        name: 'cache-keys',
        category: 'Database Access',
        description: 'All Redis cache keys currently stored, grouped by prefix',
        resolve: async () => {
            const keys = await deps.cache.keys('*');

            if (keys.length === 0) {
                return 'Cache: Empty - no keys stored.';
            }

            // Group by prefix (first segment before colon)
            const groups = new Map<string, string[]>();

            for (const key of keys) {
                const prefix = key.split(':')[0] || 'other';
                const group = groups.get(prefix) || [];
                group.push(key);
                groups.set(prefix, group);
            }

            const lines = [
                `Cache Keys (${keys.length} total):`,
                ''
            ];

            const sortedGroups = [...groups.entries()].sort(([, a], [, b]) => b.length - a.length);
            for (const [prefix, groupKeys] of sortedGroups) {
                lines.push(`  ${prefix}/ (${groupKeys.length} keys):`);
                // Show up to 10 keys per group
                for (const key of groupKeys.slice(0, 10)) {
                    lines.push(`    ${key}`);
                }
                if (groupKeys.length > 10) {
                    lines.push(`    ... and ${groupKeys.length - 10} more`);
                }
            }

            return lines.join('\n');
        }
    });
}
