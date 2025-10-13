import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginsRoot = __dirname;

/**
 * Determine whether a filesystem path is accessible.
 *
 * This helper checks for the existence of plugin directories and package.json files
 * before attempting to build them. It returns true when the path exists and is
 * accessible, otherwise false so the caller may skip missing plugins gracefully.
 *
 * @param path - The filesystem path to check
 * @returns Promise resolving to true if path exists, false otherwise
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
 * Clean the dist directory for a plugin.
 *
 * Removes all build artifacts from the plugin's dist directory to ensure a fresh
 * build. This is called when --force-build is specified to prevent stale artifacts
 * from causing issues.
 *
 * @param pluginDir - The plugin directory containing the dist folder
 * @param pluginName - The plugin name for logging purposes
 * @returns Promise that resolves when cleanup is complete
 */
async function cleanPlugin(pluginDir, pluginName) {
    const distPath = join(pluginDir, 'dist');
    if (await pathExists(distPath)) {
        console.log(`  Cleaning dist/ for ${pluginName}`);
        await fs.rm(distPath, { recursive: true, force: true });
    }
}

/**
 * Discover plugin directories that have backend builds.
 *
 * This scans the plugins workspace, filters out non-plugin directories, and checks
 * for package.json files with a "build" script. Only plugins with build scripts
 * are included in the returned list.
 *
 * @returns Promise resolving to array of plugin descriptors with name and directory
 */
async function discoverBackendPlugins() {
    const directories = await fs.readdir(pluginsRoot, { withFileTypes: true });
    const plugins = [];

    for (const entry of directories) {
        if (!entry.isDirectory()) {
            continue;
        }

        // Skip hidden directories, node_modules, and dist
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
            continue;
        }

        const pluginDir = join(pluginsRoot, entry.name);
        const packageJsonPath = join(pluginDir, 'package.json');

        if (!(await pathExists(packageJsonPath))) {
            continue;
        }

        // Check if package.json has a build script
        try {
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
            if (packageJson.scripts && packageJson.scripts.build) {
                plugins.push({
                    name: entry.name,
                    directory: pluginDir,
                });
            }
        } catch (error) {
            console.warn(`Warning: Failed to read package.json for ${entry.name}:`, error.message);
        }
    }

    return plugins;
}

/**
 * Build a plugin's backend using its npm build script.
 *
 * This executes the plugin's build script (typically TypeScript compilation) and
 * captures the output. Build errors are propagated to the caller for centralized
 * error handling.
 *
 * @param plugin - Plugin descriptor with name and directory
 * @returns Promise that resolves when build completes
 */
async function buildPluginBackend(plugin) {
    try {
        execSync('npm run build', {
            cwd: plugin.directory,
            stdio: 'inherit',
            encoding: 'utf8'
        });
    } catch (error) {
        throw new Error(`Build failed for ${plugin.name}: ${error.message}`);
    }
}

/**
 * Coordinate building for all backend-enabled plugins.
 *
 * This discovers eligible plugins, optionally cleans their dist directories if
 * --force-build is specified, and runs their build scripts sequentially for
 * clearer logging. It surfaces a non-zero exit code when any build fails so
 * CI and build scripts can react appropriately.
 *
 * @returns Promise that resolves when all builds complete
 */
async function run() {
    const forceBuild = process.argv.includes('--force-build');

    if (forceBuild) {
        console.log('Force rebuild enabled: cleaning plugin dist directories\n');
    }

    const plugins = await discoverBackendPlugins();

    if (plugins.length === 0) {
        console.log('No backend-enabled plugins discovered.');
        return;
    }

    console.log(`Found ${plugins.length} plugin(s) with build scripts:\n`);

    // Clean plugins if force build is enabled
    if (forceBuild) {
        for (const plugin of plugins) {
            await cleanPlugin(plugin.directory, plugin.name);
        }
        console.log('');
    }

    // Build all plugins
    let successCount = 0;
    let failureCount = 0;

    for (const plugin of plugins) {
        console.log(`Building backend for plugin: ${plugin.name}`);
        try {
            await buildPluginBackend(plugin);
            console.log(`✓ Built backend for ${plugin.name}\n`);
            successCount++;
        } catch (error) {
            console.error(`✗ Failed to build backend for ${plugin.name}`);
            console.error(`  ${error.message}\n`);
            failureCount++;
            process.exitCode = 1;
        }
    }

    // Summary
    console.log('─'.repeat(60));
    console.log(`Plugin backend build summary:`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Failed:  ${failureCount}`);
    console.log(`  Total:   ${plugins.length}`);
    console.log('─'.repeat(60));

    if (failureCount > 0) {
        process.exitCode = 1;
    }
}

await run();