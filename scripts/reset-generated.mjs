/**
 * Resets generated plugin/widget registry files to empty stubs.
 *
 * Why this exists: the frontend and backend import from three registry files
 * that are produced by generate-{backend,frontend}-plugin-registry.mjs at
 * build time. When plugins are present in src/plugins/, those generators emit
 * static imports into plugin source trees. That breaks `tsc --noEmit` because
 * (a) each plugin's nested node_modules/@delphian/tronrelic-types creates
 * duplicate type identities and (b) transitive import chains pull the entire
 * plugin graph into the core typecheck.
 *
 * This script writes the same empty output each generator emits when no
 * plugins are discovered, so typecheck can run against core code only. The
 * real generators run again during `build:frontend` (via generate:plugins)
 * before `next build`, so production builds are unaffected.
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const backendPluginStub = `/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * This module is produced by scripts/generate-backend-plugin-registry.mjs
 * and provides static imports for all discovered backend plugins.
 *
 * Regenerate by running: node scripts/generate-backend-plugin-registry.mjs
 */

import type { IPlugin, IPluginManifest } from '@/types';

/**
 * No plugins discovered.
 */
export const discoveredPlugins: IPlugin[] = [];
`;

const frontendPluginStub = `/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * This module is produced by scripts/generate-frontend-plugin-registry.mjs
 * and exposes a synchronous, statically-imported array of plugin frontends.
 *
 * Static imports are required so the plugin registry can be populated at
 * module load time on both server and client. CSS code splitting is preserved
 * because plugin frontend entry files use next/dynamic() for their page
 * components — only the manifest and dynamic wrappers are pulled in here.
 */
import type { IPlugin } from '@/types';

export const frontendPlugins: IPlugin[] = [];
`;

const widgetStub = `/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * This module is produced by scripts/generate-frontend-plugin-registry.mjs
 * and provides static imports for widget components enabling SSR.
 *
 * Widget components are statically imported (not lazy-loaded) so they're
 * available during server-side rendering. This enables full widget HTML
 * to be rendered on the server for instant display without loading flash.
 */
import type { WidgetComponent } from '@/types';

/**
 * Combined widget component registry from all plugins.
 * Empty because no plugins export widget components.
 */
export const widgetComponentRegistry: Record<string, WidgetComponent> = {};

/**
 * Look up a widget component by ID.
 */
export function getWidgetComponent(widgetId: string): WidgetComponent | undefined {
    return widgetComponentRegistry[widgetId];
}
`;

const targets = [
    { path: join(repoRoot, 'src', 'backend', 'loaders', 'plugins.generated.ts'), content: backendPluginStub },
    { path: join(repoRoot, 'src', 'frontend', 'components', 'plugins', 'plugins.generated.ts'), content: frontendPluginStub },
    { path: join(repoRoot, 'src', 'frontend', 'components', 'widgets', 'widgets.generated.ts'), content: widgetStub }
];

/**
 * Writes each stub, creating parent directories if needed.
 */
async function run() {
    for (const { path, content } of targets) {
        await fs.mkdir(dirname(path), { recursive: true });
        await fs.writeFile(path, content, 'utf8');
    }
    console.log(`✅ Reset ${targets.length} generated registry file(s) to empty stubs`);
}

void run();
