import * as esbuild from 'esbuild';
import { sassPlugin } from 'esbuild-sass-plugin';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginsRoot = __dirname;
const frontendEntrySegments = ['src', 'frontend', 'frontend.ts'];
const manifestSegments = ['src', 'manifest.ts'];
const outputSegments = ['dist', 'frontend.bundle.js'];

/**
 * Determine whether a filesystem path is accessible.
 * This helper checks for the existence of optional plugin files before the build script touches them, and it prevents the main logic from throwing.
 * It returns true when the path can be accessed, otherwise false so the caller may skip the missing asset gracefully.
 */
async function pathExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Clean the frontend bundle artifacts for a plugin.
 *
 * Removes the frontend.bundle.js and frontend.bundle.css files from the plugin's
 * dist directory to ensure a fresh build. This is called when --force-build is
 * specified to prevent stale artifacts.
 *
 * @param pluginDir - The plugin directory containing the dist folder
 * @param pluginName - The plugin name for logging purposes
 * @returns Promise that resolves when cleanup is complete
 */
async function cleanPluginFrontend(pluginDir, pluginName) {
    const distPath = join(pluginDir, 'dist');
    if (await pathExists(distPath)) {
        const bundleJs = join(distPath, 'frontend.bundle.js');
        const bundleCss = join(distPath, 'frontend.bundle.css');

        let cleaned = false;
        if (await pathExists(bundleJs)) {
            await fs.rm(bundleJs, { force: true });
            cleaned = true;
        }
        if (await pathExists(bundleCss)) {
            await fs.rm(bundleCss, { force: true });
            cleaned = true;
        }

        if (cleaned) {
            console.log(`  Cleaning frontend bundles for ${pluginName}`);
        }
    }
}

/**
 * Discover plugin directories that expose frontend bundles.
 * This scans the plugins workspace, filters out non-plugin directories, and inspects the manifest for a frontend flag so only eligible plugins are bundled.
 * It returns an array of plugin descriptors containing the directory path and manifest contents used throughout the build process.
 */
async function discoverFrontendPlugins() {
    const directories = await fs.readdir(pluginsRoot, { withFileTypes: true });
    const plugins = [];

    for (const entry of directories) {
        if (!entry.isDirectory()) {
            continue;
        }

        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
            continue;
        }

        const pluginDir = join(pluginsRoot, entry.name);
        const manifestPath = join(pluginDir, ...manifestSegments);
        const frontendEntryPath = join(pluginDir, ...frontendEntrySegments);

        if (!(await pathExists(manifestPath)) || !(await pathExists(frontendEntryPath))) {
            continue;
        }

        const manifestSource = await fs.readFile(manifestPath, 'utf8');
        if (!/frontend\s*:\s*true/.test(manifestSource)) {
            continue;
        }

        plugins.push({
            name: entry.name,
            directory: pluginDir,
            frontendEntryPath,
            outputPath: join(pluginDir, ...outputSegments),
        });
    }

    return plugins;
}

/**
 * Build a plugin's frontend bundle with esbuild.
 * This compiles the canonical frontend entry into the shared dist location using consistent externals so every plugin follows the same bundling contract.
 * It resolves once the bundle is written, propagating any build errors for centralized handling.
 */
async function buildPluginFrontend(plugin) {
    const frontendAppDir = join(__dirname, '../../apps/frontend/app');

    await esbuild.build({
        entryPoints: [plugin.frontendEntryPath],
        bundle: true,
        format: 'esm',
        outfile: plugin.outputPath,
        platform: 'browser',
        target: 'es2020',
        jsx: 'automatic',
        external: ['react', 'react-dom', 'react-redux', '@reduxjs/toolkit', '@tronrelic/frontend/*'],
        logLevel: 'info',
        plugins: [
            sassPlugin({
                type: 'css',
                loadPaths: [frontendAppDir],
            }),
        ],
    });
}

/**
 * Coordinate bundling for every frontend-enabled plugin.
 *
 * This discovers eligible plugins, optionally cleans their frontend bundles if
 * --force-build is specified, and runs esbuild sequentially for clearer logging.
 * It surfaces a non-zero exit code when any bundle fails so CI and build scripts
 * can react appropriately.
 *
 * @returns Promise that resolves when all builds complete
 */
async function run() {
    const forceBuild = process.argv.includes('--force-build');

    if (forceBuild) {
        console.log('Force rebuild enabled: cleaning plugin frontend bundles\n');
    }

    const plugins = await discoverFrontendPlugins();

    if (plugins.length === 0) {
        console.log('No frontend-enabled plugins discovered.');
        return;
    }

    console.log(`Found ${plugins.length} frontend-enabled plugin(s):\n`);

    // Clean plugins if force build is enabled
    if (forceBuild) {
        for (const plugin of plugins) {
            await cleanPluginFrontend(plugin.directory, plugin.name);
        }
        console.log('');
    }

    // Build all plugins
    let successCount = 0;
    let failureCount = 0;

    for (const plugin of plugins) {
        console.log(`Building frontend for plugin: ${plugin.name}`);
        try {
            await buildPluginFrontend(plugin);
            console.log(`✓ Built frontend bundle for ${plugin.name}\n`);
            successCount++;
        } catch (error) {
            console.error(`✗ Failed to build frontend bundle for ${plugin.name}`);
            console.error(`  ${error.message}\n`);
            failureCount++;
            process.exitCode = 1;
        }
    }

    // Summary
    console.log('─'.repeat(60));
    console.log(`Plugin frontend build summary:`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Failed:  ${failureCount}`);
    console.log(`  Total:   ${plugins.length}`);
    console.log('─'.repeat(60));

    if (failureCount > 0) {
        process.exitCode = 1;
    }
}

await run();
