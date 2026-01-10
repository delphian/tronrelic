/**
 * Backend Plugin Registry Generator.
 *
 * Scans src/plugins/ for directories containing backend entry points and generates
 * a TypeScript registry file with static imports. This enables on-the-fly compilation
 * during development (tsx compiles imported source files) while keeping the core
 * plugin loader unaware of specific plugin names.
 *
 * Usage: node scripts/generate-backend-plugin-registry.mjs
 *
 * The generated registry is imported by src/backend/loaders/plugins.ts which then
 * initializes all discovered plugins without hardcoding any plugin paths.
 */

import { promises as fs } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const pluginsRoot = join(repoRoot, 'src', 'plugins');
const outputPath = join(repoRoot, 'src', 'backend', 'loaders', 'plugins.generated.ts');
const outputDir = dirname(outputPath);

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
 * @returns {Promise<Array<{id: string, manifestImportPath: string, backendImportPath: string|null}>>}
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

        // Generate relative import path for manifest
        const manifestRelative = relative(outputDir, manifestPath).replace(/\\/g, '/');
        const manifestImportPath = manifestRelative.startsWith('.')
            ? manifestRelative.replace(/\.ts$/, '.js')
            : `./${manifestRelative.replace(/\.ts$/, '.js')}`;

        // Generate relative import path for backend (if exists)
        let backendImportPath = null;
        if (await hasBackend(directory)) {
            const backendPath = join(directory, 'src', 'backend', 'backend.ts');
            const backendRelative = relative(outputDir, backendPath).replace(/\\/g, '/');
            backendImportPath = backendRelative.startsWith('.')
                ? backendRelative.replace(/\.ts$/, '.js')
                : `./${backendRelative.replace(/\.ts$/, '.js')}`;
        }

        metadata.push({
            id: pluginId,
            manifestImportPath,
            backendImportPath
        });
    }

    return metadata;
}

/**
 * Renders the TypeScript source for the backend plugin registry.
 *
 * Generates static imports for all discovered plugins, creating an array
 * of IPlugin objects that the loader can iterate without filesystem scanning.
 *
 * @param {Array<{id: string, manifestImportPath: string, backendImportPath: string|null}>} metadata
 * @returns {string} TypeScript source code
 */
function renderModule(metadata) {
    const header = `/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * This module is produced by scripts/generate-backend-plugin-registry.mjs
 * and provides static imports for all discovered backend plugins.
 *
 * Regenerate by running: node scripts/generate-backend-plugin-registry.mjs
 */

import type { IPlugin, IPluginManifest } from '@/types';

`;

    if (metadata.length === 0) {
        return `${header}/**
 * No plugins discovered.
 */
export const discoveredPlugins: IPlugin[] = [];
`;
    }

    // Generate imports for manifests and backends
    const imports = [];
    const pluginEntries = [];

    for (const { id, manifestImportPath, backendImportPath } of metadata) {
        const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');

        imports.push(`import * as ${safeId}_manifest_module from '${manifestImportPath}';`);

        if (backendImportPath) {
            imports.push(`import * as ${safeId}_backend_module from '${backendImportPath}';`);
            pluginEntries.push(`    resolvePlugin('${id}', ${safeId}_manifest_module, ${safeId}_backend_module),`);
        } else {
            pluginEntries.push(`    resolveManifestOnlyPlugin('${id}', ${safeId}_manifest_module),`);
        }
    }

    const resolver = `
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
        throw new Error(\`Failed to resolve plugin export for '\${pluginId}'. Ensure backend.ts exports an IPlugin.\`);
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
        throw new Error(\`Failed to resolve manifest for '\${pluginId}'. Ensure manifest.ts exports an IPluginManifest.\`);
    }
    return { manifest };
}

`;

    const registry = `/**
 * All discovered plugins with their compiled exports.
 *
 * This array is populated at import time with statically-imported plugins.
 * The loader iterates this array instead of scanning the filesystem.
 */
export const discoveredPlugins: IPlugin[] = [
${pluginEntries.join('\n')}
];
`;

    return `${header}${imports.join('\n')}\n${resolver}${registry}`;
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
    for (const { id, backendImportPath } of metadata) {
        const type = backendImportPath ? 'backend' : 'frontend-only';
        console.log(`    - ${id} (${type})`);
    }
}

void run();
