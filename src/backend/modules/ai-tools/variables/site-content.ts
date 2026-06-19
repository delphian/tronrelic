/**
 * @file variables/site-content.ts
 *
 * Built-in dynamic prompt variables in the "Site & Content" category.
 * Registered by {@link registerBuiltinVariables} via registerSiteContentVariables.
 *
 * Lifted from the trp-ai-assistant plugin to core unchanged in behaviour; the
 * resolvers now read injected core services (`deps`) instead of `IPluginContext`.
 */

import type { IPromptVariableRegistry } from '@/types';
import type { IBuiltinVariableDeps } from './types.js';

/**
 * Register all "Site & Content" built-in variables on the given registry.
 *
 * @param registry - The core prompt-variable registry.
 * @param deps - Injected core services the resolvers read at expansion time.
 */
export function registerSiteContentVariables(
    registry: IPromptVariableRegistry,
    deps: IBuiltinVariableDeps
): void {
    registry.registerVariable({
        name: 'site-info',
        category: 'Site & Content',
        description: 'TronRelic site URL, platform identity, and navigation structure',
        resolve: async () => {
            const siteUrl = await deps.systemConfig.getSiteUrl();
            const namespaces = deps.menuService.getNamespaces();

            const lines = [
                'Site Information:',
                `  URL: ${siteUrl}`,
                `  Platform: TronRelic - TRON Blockchain Analytics`,
                `  Menu Namespaces: ${namespaces.join(', ')}`,
                ''
            ];

            // Include main navigation structure
            const mainTree = deps.menuService.getTree('main');
            if (mainTree.roots.length > 0) {
                lines.push('  Main Navigation:');
                for (const node of mainTree.roots) {
                    const icon = node.icon ? `[${node.icon}] ` : '';
                    lines.push(`    ${icon}${node.label} → ${node.url}`);
                    const children = deps.menuService.getChildren(node._id!, 'main');
                    for (const child of children) {
                        lines.push(`      ${child.label} → ${child.url}`);
                    }
                }
                lines.push('');
            }

            // System navigation
            const systemTree = deps.menuService.getTree('system');
            if (systemTree.roots.length > 0) {
                lines.push('  System Navigation:');
                for (const node of systemTree.roots) {
                    lines.push(`    ${node.label} → ${node.url}`);
                }
            }

            return lines.join('\n');
        }
    });
}
