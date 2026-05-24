/**
 * Backend Plugin Registry Generator.
 *
 * Scans src/plugins/ for directories containing backend entry points and emits
 * a TypeScript registry that loads each plugin via dynamic import() at runtime.
 *
 * Why dynamic instead of static: esbuild bundles src/backend/index.ts into a
 * single dist/backend/index.js. With static imports, esbuild crawls into each
 * plugin's source and inlines its module body into the bundle — but with
 * `packages: 'external'` it leaves bare specifiers (e.g. 'isomorphic-dompurify')
 * pointing at the bundle's location. Node ESM then resolves those specifiers
 * by walking up from /app/dist/backend/index.js, never reaching a plugin's
 * sibling node_modules at /app/src/plugins/<id>/node_modules/. Dynamic import
 * keeps the plugin file as the importer at runtime, so its nested node_modules
 * is on the resolution path.
 *
 * Usage: node scripts/generate-backend-plugin-registry.mjs
 */

import { promises as fs } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const pluginsRoot = join(repoRoot, 'src', 'plugins');
const outputPath = join(repoRoot, 'src', 'backend', 'loaders', 'plugins.generated.ts');

/**
 * Discovers plugin directories with backend entry points.
 *
 * Scans for directories containing src/backend/backend.ts, indicating the plugin
 * ships backend code that needs to be loaded.
 *
 * @returns {Promise<string[]>} Array of absolute paths to plugin directories
 */
async function discoverPluginDirectories() {
    const directories = [];
    const entries = await fs.readdir(pluginsRoot, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        // Skip hidden and special directories
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
        }

        const directory = join(pluginsRoot, entry.name);

        // Skip plugins that don't exist (e.g., uninitialized submodules)
        try {
            await fs.access(directory);
        } catch {
            console.log(`  Skipping ${entry.name} (directory not accessible)`);
            continue;
        }

        // Check for backend entry point
        try {
            await fs.access(join(directory, 'src', 'backend', 'backend.ts'));
            directories.push(directory);
        } catch {
            // Plugin doesn't have backend code - check for manifest only (frontend-only plugin)
            try {
                await fs.access(join(directory, 'src', 'manifest.ts'));
                directories.push(directory);
            } catch {
                // Not a valid plugin
            }
        }
    }

    return directories;
}

/**
 * Reads a JSON file from disk.
 *
 * @param {string} filePath - Absolute path to JSON file
 * @returns {Promise<object>} Parsed JSON object
 */
async function readJson(filePath) {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents);
}

/**
 * Extracts the plugin identifier from its manifest source.
 *
 * Parses the TypeScript source to find the id field without requiring compilation.
 *
 * @param {string} manifestPath - Path to manifest.ts
 * @param {string} fallbackId - Fallback identifier if parsing fails
 * @returns {Promise<string>} Plugin identifier
 */
async function readPluginId(manifestPath, fallbackId) {
    try {
        const contents = await fs.readFile(manifestPath, 'utf8');
        const match = contents.match(/id\s*:\s*['"]([^'\"]+)['"]/);
        if (match && match[1]) {
            return match[1];
        }
    } catch {
        // Fall through to fallback
    }
    return fallbackId;
}

/**
 * Checks if a plugin has backend code.
 *
 * @param {string} directory - Plugin directory path
 * @returns {Promise<boolean>} True if plugin has backend entry point
 */
async function hasBackend(directory) {
    try {
        await fs.access(join(directory, 'src', 'backend', 'backend.ts'));
        return true;
    } catch {
        return false;
    }
}

/**
 * Collects metadata for all discovered plugins.
 *
 * Paths are emitted relative to the repository root with a `.js` extension. The
 * generated runtime swaps `/src/` to `/dist/` when NODE_ENV=production so the
 * same registry works against the source tree under tsx watch and the compiled
 * tree inside the production image.
 *
 * @returns {Promise<Array<{id: string, manifestSrcPath: string, backendSrcPath: string|null}>>}
 */
async function collectPluginMetadata() {
    const directories = await discoverPluginDirectories();
    const metadata = [];

    for (const directory of directories) {
        const packageJsonPath = join(directory, 'package.json');
        const manifestPath = join(directory, 'src', 'manifest.ts');

        let packageJson;
        try {
            packageJson = await readJson(packageJsonPath);
        } catch {
            console.log(`  Skipping ${directory} (no package.json)`);
            continue;
        }

        const pluginId = await readPluginId(manifestPath, packageJson.name.split('/').at(-1));

        const manifestSrcPath = relative(repoRoot, manifestPath).replace(/\\/g, '/').replace(/\.ts$/, '.js');

        let backendSrcPath = null;
        if (await hasBackend(directory)) {
            const backendPath = join(directory, 'src', 'backend', 'backend.ts');
            backendSrcPath = relative(repoRoot, backendPath).replace(/\\/g, '/').replace(/\.ts$/, '.js');
        }

        metadata.push({ id: pluginId, manifestSrcPath, backendSrcPath });
    }

    return metadata;
}

/**
 * Renders the TypeScript source for the backend plugin registry.
 *
 * Emits an async loader that dynamic-imports each plugin's backend (or manifest
 * for frontend-only plugins) at runtime. The dynamic import keeps the plugin
 * file as the bare-specifier importer at runtime — see the file header comment
 * on this script for the resolution-locality rationale.
 *
 * @param {Array<{id: string, manifestSrcPath: string, backendSrcPath: string|null}>} metadata
 * @returns {string} TypeScript source code
 */
function renderModule(metadata) {
    const header = `/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * Produced by scripts/generate-backend-plugin-registry.mjs.
 *
 * Plugins are loaded via dynamic import() so esbuild does not crawl plugin
 * source into the backend bundle. Each plugin file therefore stays in its own
 * directory at runtime, and Node ESM resolves the plugin's bare-specifier
 * dependencies from the plugin's own node_modules — not from /app/node_modules.
 *
 * Regenerate by running: node scripts/generate-backend-plugin-registry.mjs
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { IPlugin, IPluginManifest } from '@/types';
import { loadFromPluginLoaders } from './safe-plugin-load.js';
`;

    if (metadata.length === 0) {
        return `${header}
/**
 * No plugins discovered.
 */
export async function loadDiscoveredPlugins(): Promise<IPlugin[]> {
    return [];
}
`;
    }

    const entries = metadata.map(({ id, manifestSrcPath, backendSrcPath }) => {
        if (backendSrcPath) {
            return `    () => resolvePlugin(${JSON.stringify(id)}, ${JSON.stringify(backendSrcPath)})`;
        }
        return `    () => resolveManifestOnlyPlugin(${JSON.stringify(id)}, ${JSON.stringify(manifestSrcPath)})`;
    }).join(',\n');

    const body = `
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Resolves a repo-relative plugin source path to a runtime file:// URL.
 *
 * In dev, paths point at src/ and tsx transparently rewrites .js→.ts. In
 * production, src/ is swapped to dist/ so Node ESM loads the plugin's
 * compiled JavaScript directly. process.cwd() is /app inside the production
 * image (Dockerfile WORKDIR) and the project root in dev.
 */
function pluginUrl(srcRelPath: string): string {
    const runtimePath = isProduction ? srcRelPath.replace(/\\/src\\//, '/dist/') : srcRelPath;
    return pathToFileURL(join(process.cwd(), runtimePath)).href;
}

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

function findPlugin(module: Record<string, unknown>): IPlugin | undefined {
    return Object.values(module).find(
        (exp): exp is IPlugin =>
            typeof exp === 'object' &&
            exp !== null &&
            'manifest' in exp &&
            typeof (exp as Record<string, unknown>).manifest === 'object'
    );
}

async function resolvePlugin(pluginId: string, backendSrcPath: string): Promise<IPlugin> {
    const backendModule = (await import(pluginUrl(backendSrcPath))) as Record<string, unknown>;
    const plugin = findPlugin(backendModule);
    if (!plugin) {
        throw new Error(\`Failed to resolve plugin export for '\${pluginId}'. Ensure backend.ts exports an IPlugin.\`);
    }
    return plugin;
}

async function resolveManifestOnlyPlugin(pluginId: string, manifestSrcPath: string): Promise<IPlugin> {
    const manifestModule = (await import(pluginUrl(manifestSrcPath))) as Record<string, unknown>;
    const manifest = findManifest(manifestModule);
    if (!manifest) {
        throw new Error(\`Failed to resolve manifest for '\${pluginId}'. Ensure manifest.ts exports an IPluginManifest.\`);
    }
    return { manifest };
}

const pluginLoaders: Array<() => Promise<IPlugin>> = [
${entries}
];

/**
 * Loads every discovered plugin via dynamic import. Resolution failures are
 * isolated per plugin: a broken module-level import, evaluation throw, or a
 * resolved value that fails the minimum IPlugin shape check is logged and
 * dropped from the returned set, leaving the rest of the registry — and
 * backend startup — unaffected. The orchestration lives in
 * loaders/safe-plugin-load.ts so the contract is testable.
 */
export async function loadDiscoveredPlugins(): Promise<IPlugin[]> {
    return loadFromPluginLoaders(pluginLoaders);
}
`;

    return `${header}${body}`;
}

/**
 * Writes file only if contents changed.
 *
 * Avoids unnecessary file writes that would trigger recompilation.
 *
 * @param {string} filePath - Output file path
 * @param {string} contents - File contents to write
 */
async function writeIfChanged(filePath, contents) {
    try {
        const existing = await fs.readFile(filePath, 'utf8');
        if (existing === contents) {
            return false;
        }
    } catch {
        await fs.mkdir(dirname(filePath), { recursive: true });
    }

    await fs.writeFile(filePath, contents, 'utf8');
    return true;
}

/**
 * Main entry point.
 */
async function run() {
    console.log('Generating backend plugin registry...');

    const metadata = await collectPluginMetadata();
    const moduleSource = renderModule(metadata);
    const changed = await writeIfChanged(outputPath, moduleSource);

    if (changed) {
        console.log(`  Generated: ${outputPath}`);
    } else {
        console.log(`  Unchanged: ${outputPath}`);
    }

    console.log(`  Discovered ${metadata.length} plugins`);
    for (const { id, backendSrcPath } of metadata) {
        const type = backendSrcPath ? 'backend' : 'frontend-only';
        console.log(`    - ${id} (${type})`);
    }
}

void run();
