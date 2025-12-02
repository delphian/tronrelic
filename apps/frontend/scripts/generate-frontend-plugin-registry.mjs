import { promises as fs } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..', '..');
const pluginsRoot = join(repoRoot, 'packages', 'plugins');
const outputPath = join(repoRoot, 'apps', 'frontend', 'components', 'plugins', 'plugins.generated.ts');
const widgetsOutputPath = join(repoRoot, 'apps', 'frontend', 'components', 'widgets', 'widgets.generated.ts');
const outputDir = dirname(outputPath);
const widgetsOutputDir = dirname(widgetsOutputPath);

/**
 * Discovers plugin directories with frontend entry points.
 *
 * It reads the plugins workspace and keeps directories that expose `src/frontend/frontend.ts`. This ensures the generator only creates loaders for plugins that actually ship frontend code.
 */
async function discoverPluginDirectories() {
    const directories = [];
    const entries = await fs.readdir(pluginsRoot, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const directory = join(pluginsRoot, entry.name);

        // Skip plugins that don't exist (e.g., private submodules not initialized)
        try {
            await fs.access(directory);
        } catch {
            console.log(`⏭️  Skipping ${entry.name} (directory not found - may be uninitialized submodule)`);
            continue;
        }

        try {
            await fs.access(join(directory, 'src', 'frontend', 'frontend.ts'));
            directories.push(directory);
        } catch {
            // Ignore plugins without frontend modules.
        }
    }

    return directories;
}

/**
 * Reads a JSON file from disk.
 *
 * It loads the file contents and parses them so that callers can obtain structured metadata. This allows the generator to reuse package manifest data without duplicating schema knowledge.
 */
async function readJson(filePath) {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents);
}

/**
 * Extracts the plugin identifier from its manifest.
 *
 * It scans the manifest source for the `id` field and returns the matched value. This keeps the identifier in sync with the manifest without hardcoding directory names.
 */
async function readPluginId(manifestPath, fallbackId) {
    try {
        const contents = await fs.readFile(manifestPath, 'utf8');
        const match = contents.match(/id\s*:\s*['"]([^'\"]+)['"]/);
        if (match && match[1]) {
            return match[1];
        }
    } catch {
        // Fall through to the fallback identifier.
    }
    return fallbackId;
}

/**
 * Collects plugin metadata for code generation.
 *
 * It merges manifest identifiers with absolute file paths to produce import targets. This avoids redundant filesystem scans when rendering the registry.
 */
async function collectPluginMetadata() {
    const directories = await discoverPluginDirectories();
    const metadata = [];

    for (const directory of directories) {
        const packageJsonPath = join(directory, 'package.json');
        const manifestPath = join(directory, 'src', 'manifest.ts');
        const frontendEntry = join(directory, 'src', 'frontend', 'frontend.ts');
        const packageJson = await readJson(packageJsonPath);
        const pluginId = await readPluginId(manifestPath, packageJson.name.split('/').at(-1));
        const relativeImportPath = relative(outputDir, frontendEntry).replace(/\\/g, '/');
        const sanitizedImportPath = relativeImportPath.startsWith('.')
            ? relativeImportPath
            : `./${relativeImportPath}`;
        const importPathWithoutExtension = sanitizedImportPath.replace(/\.ts$/, '');

        metadata.push({
            id: pluginId,
            importPath: importPathWithoutExtension
        });
    }

    return metadata;
}

/**
 * Renders the TypeScript source for the registry module.
 *
 * It generates lazy loader functions that import plugin frontends on demand. This lets the frontend dynamically initialize plugins without bundling them all upfront.
 */
function renderModule(metadata) {
    const header = `/**\n * AUTO-GENERATED FILE. DO NOT EDIT.\n *\n * This module is produced by scripts/generate-frontend-plugin-registry.mjs\n * and exposes lazy loaders for plugin frontend modules.\n */\n`;

    const imports = `import type { IPlugin } from '@tronrelic/types';\n\n`;

    if (metadata.length === 0) {
        const emptyBody = `export const frontendPluginLoaders: Record<string, () => Promise<IPlugin>> = {};\n\nfunction resolvePluginExport(pluginId: string): IPlugin {\n    throw new Error(\`Plugin registry attempted to load '\${pluginId}' but no loaders were generated.\`);\n}\n`;
        return `${header}${imports}${emptyBody}`;
    }

    const loaderBodies = metadata
        .map(({ id, importPath }) => {
            const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');
            return `async function load_${safeId}(): Promise<IPlugin> {\n    const module = await import('${importPath}');\n    return resolvePluginExport('${id}', module);\n}\n`;
        })
        .join('\n');

    const registryEntries = metadata
        .map(({ id }) => {
            const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');
            return `    '${id}': load_${safeId},`;
        })
        .join('\n');

    const registry = `export const frontendPluginLoaders: Record<string, () => Promise<IPlugin>> = {\n${registryEntries}\n};\n`;

    const resolver = `function resolvePluginExport(pluginId: string, module: Record<string, unknown>): IPlugin {\n    const candidate = Object.values(module).find((value): value is IPlugin => {\n        return typeof value === 'object' && value !== null && 'manifest' in value;\n    });\n\n    if (!candidate) {\n        throw new Error(\`Failed to locate plugin export for '\${pluginId}'. Ensure the module exports an IPlugin.\`);\n    }\n\n    return candidate;\n}\n`;

    return `${header}${imports}${loaderBodies}\n${registry}\n${resolver}`;
}

/**
 * Writes the registry file when its contents change.
 *
 * It compares the newly generated code with the existing file to avoid unnecessary rewrites. This minimizes spurious rebuilds during development.
 */
async function writeIfChanged(filePath, contents) {
    try {
        const existing = await fs.readFile(filePath, 'utf8');
        if (existing === contents) {
            return;
        }
    } catch {
        await fs.mkdir(dirname(filePath), { recursive: true });
    }

    await fs.writeFile(filePath, contents, 'utf8');
}

/**
 * Discovers plugin directories with widget component exports.
 *
 * Scans for plugins that have a src/frontend/widgets/index.ts file exporting
 * widget components for SSR rendering.
 */
async function discoverWidgetDirectories() {
    const directories = [];
    const entries = await fs.readdir(pluginsRoot, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const directory = join(pluginsRoot, entry.name);

        try {
            await fs.access(directory);
        } catch {
            continue;
        }

        try {
            await fs.access(join(directory, 'src', 'frontend', 'widgets', 'index.ts'));
            directories.push(directory);
        } catch {
            // Plugin doesn't have widget components
        }
    }

    return directories;
}

/**
 * Collects widget component metadata for static import generation.
 *
 * Unlike plugin loaders which use dynamic imports, widget components use
 * static imports so they're available during server-side rendering.
 */
async function collectWidgetMetadata() {
    const directories = await discoverWidgetDirectories();
    const metadata = [];

    for (const directory of directories) {
        const packageJsonPath = join(directory, 'package.json');
        const manifestPath = join(directory, 'src', 'manifest.ts');
        const widgetsEntry = join(directory, 'src', 'frontend', 'widgets', 'index.ts');
        const packageJson = await readJson(packageJsonPath);
        const pluginId = await readPluginId(manifestPath, packageJson.name.split('/').at(-1));
        const relativeImportPath = relative(widgetsOutputDir, widgetsEntry).replace(/\\/g, '/');
        const sanitizedImportPath = relativeImportPath.startsWith('.')
            ? relativeImportPath
            : `./${relativeImportPath}`;
        const importPathWithoutExtension = sanitizedImportPath.replace(/\.ts$/, '');

        metadata.push({
            id: pluginId,
            importPath: importPathWithoutExtension
        });
    }

    return metadata;
}

/**
 * Renders the TypeScript source for the widget registry module.
 *
 * Generates static imports for widget components, making them available
 * during SSR. Each plugin exports a widgetComponents record mapping
 * widget IDs to React components.
 */
function renderWidgetsModule(metadata) {
    const header = `/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * This module is produced by scripts/generate-frontend-plugin-registry.mjs
 * and provides static imports for widget components enabling SSR.
 *
 * Widget components are statically imported (not lazy-loaded) so they're
 * available during server-side rendering. This enables full widget HTML
 * to be rendered on the server for instant display without loading flash.
 */
import type { ComponentType } from 'react';

`;

    if (metadata.length === 0) {
        return `${header}/**
 * Combined widget component registry from all plugins.
 * Empty because no plugins export widget components.
 */
export const widgetComponentRegistry: Record<string, ComponentType<{ data: unknown }>> = {};

/**
 * Look up a widget component by ID.
 */
export function getWidgetComponent(widgetId: string): ComponentType<{ data: unknown }> | undefined {
    return widgetComponentRegistry[widgetId];
}
`;
    }

    // Generate static imports for each plugin's widget components
    const imports = metadata
        .map(({ id, importPath }) => {
            const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');
            return `import { widgetComponents as ${safeId}_widgets } from '${importPath}';`;
        })
        .join('\n');

    // Generate the merged registry
    const registrySpread = metadata
        .map(({ id }) => {
            const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');
            return `    ...${safeId}_widgets,`;
        })
        .join('\n');

    const registry = `
/**
 * Combined widget component registry from all plugins.
 *
 * Maps widget IDs to their React components. Widget IDs must match
 * the IDs used in backend widget registration.
 */
export const widgetComponentRegistry: Record<string, ComponentType<{ data: unknown }>> = {
${registrySpread}
};

/**
 * Look up a widget component by ID.
 *
 * @param widgetId - Widget identifier (e.g., 'whale-alerts:recent')
 * @returns Component if registered, undefined otherwise
 */
export function getWidgetComponent(widgetId: string): ComponentType<{ data: unknown }> | undefined {
    return widgetComponentRegistry[widgetId];
}
`;

    return `${header}${imports}\n${registry}`;
}

/**
 * Orchestrates registry generation.
 *
 * Generates both the plugin loader registry (lazy imports for pages/components)
 * and the widget component registry (static imports for SSR).
 */
async function run() {
    // Generate plugin loaders (lazy imports)
    const pluginMetadata = await collectPluginMetadata();
    const pluginModuleSource = renderModule(pluginMetadata);
    await writeIfChanged(outputPath, pluginModuleSource);

    // Generate widget component registry (static imports for SSR)
    const widgetMetadata = await collectWidgetMetadata();
    const widgetModuleSource = renderWidgetsModule(widgetMetadata);
    await writeIfChanged(widgetsOutputPath, widgetModuleSource);

    console.log(`✅ Generated plugin registry: ${pluginMetadata.length} plugins`);
    console.log(`✅ Generated widget registry: ${widgetMetadata.length} plugins with widgets`);
}

void run();
