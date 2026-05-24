import { promises as fs } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const pluginsRoot = join(repoRoot, 'src', 'plugins');
const outputPath = join(repoRoot, 'src', 'frontend', 'components', 'plugins', 'plugins.generated.ts');
const widgetsOutputPath = join(repoRoot, 'src', 'frontend', 'components', 'widgets', 'widgets.generated.ts');
const publicAssetsOutputRoot = join(repoRoot, 'src', 'frontend', 'public', 'plugins');
const outputDir = dirname(outputPath);
const widgetsOutputDir = dirname(widgetsOutputPath);

/**
 * Discovers plugin directories with frontend entry points.
 *
 * Accepts either a raw `src/frontend/frontend.ts` (legacy, core transpiles) or
 * a `package.json` with an `exports."./frontend"` field that points at a
 * compiled artifact (self-built plugins). The exports field is checked first
 * so an opted-in plugin wins even if the raw TS entry still exists.
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

        if (await hasFrontendEntry(directory)) {
            directories.push(directory);
        }
    }

    return directories;
}

/**
 * Returns true if the plugin ships a frontend entry.
 *
 * Matches the two shapes the generator supports: a legacy raw TS entry at
 * `src/frontend/frontend.ts`, or a `package.json` that declares a frontend
 * export via the `exports` map.
 *
 * Errors from `resolveFrontendEntry` (e.g., declared compiled export missing
 * its built artifact) propagate intentionally so the operator sees the real
 * failure instead of silently falling back to a legacy TS entry.
 */
async function hasFrontendEntry(directory) {
    const entry = await resolveFrontendEntry(directory);
    if (entry) {
        return true;
    }
    try {
        await fs.access(join(directory, 'src', 'frontend', 'frontend.ts'));
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolves a package export entry to an absolute path on disk.
 *
 * Accepts either a string shortcut or a conditions object, preferring the
 * `import` condition (falls through to `default` and `require` for tolerance).
 * Returns null when the subpath isn't declared or the pointed-at file doesn't
 * exist — callers decide whether to fall back to a legacy source path.
 *
 * Callers may pass an already-parsed `packageJson` to avoid a redundant read
 * when the outer loop has already loaded it.
 *
 * Fails fast when the declared path has a compiled extension (.js/.mjs/.cjs)
 * but the file is missing. Silently falling back to a legacy TS entry in that
 * case is dangerous: `next.config.mjs` classifies compiled-mode purely on the
 * declared extension, so the generator and Next would disagree and webpack
 * would choke importing un-transpiled TS. Throwing here surfaces "you forgot
 * to run the plugin's build" as a clear error instead.
 */
async function resolveExportEntry(directory, subpath, packageJson) {
    if (!packageJson) {
        const packageJsonPath = join(directory, 'package.json');
        try {
            packageJson = await readJson(packageJsonPath);
        } catch {
            return null;
        }
    }

    const exportsField = packageJson.exports;
    if (!exportsField || typeof exportsField !== 'object') {
        return null;
    }

    const entry = exportsField[subpath];
    if (!entry) {
        return null;
    }

    const relativePath = typeof entry === 'string'
        ? entry
        : (entry.import || entry.default || entry.require || null);

    if (!relativePath) {
        return null;
    }

    const absolutePath = join(directory, relativePath);
    const isCompiled = /\.(js|mjs|cjs)$/.test(relativePath);
    try {
        await fs.access(absolutePath);
    } catch {
        if (isCompiled) {
            throw new Error(
                `Plugin at ${directory} declares compiled export "${subpath}" -> "${relativePath}" ` +
                `but the file does not exist. Run \`npm run build\` inside the plugin before ` +
                `\`npm run generate:plugins\`.`
            );
        }
        return null;
    }
    return absolutePath;
}

/**
 * Resolves the frontend entry the generator should import for a plugin.
 *
 * Prefers `exports."./frontend"` from the plugin's package.json so self-built
 * plugins can point at compiled output. Returns null when no exports-based
 * entry is declared; callers fall back to `src/frontend/frontend.ts`.
 */
async function resolveFrontendEntry(directory, packageJson) {
    return resolveExportEntry(directory, './frontend', packageJson);
}

/**
 * Resolves the widgets entry the generator should import for a plugin.
 *
 * Mirrors the frontend-entry resolver. Self-built plugins advertise a compiled
 * widget registry via `exports."./frontend/widgets"`; legacy plugins keep
 * shipping raw TS at `src/frontend/widgets/index.ts`.
 */
async function resolveWidgetsEntry(directory, packageJson) {
    return resolveExportEntry(directory, './frontend/widgets', packageJson);
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
 *
 * Also classifies each entry as compiled (.js/.mjs/.cjs) or raw TS (.ts/.tsx) so
 * downstream rendering can emit typed default imports for the former and keep
 * the legacy namespace-import + runtime-discovery path for the latter.
 */
async function collectPluginMetadata() {
    const directories = await discoverPluginDirectories();
    const metadata = [];

    for (const directory of directories) {
        const packageJsonPath = join(directory, 'package.json');
        const manifestPath = join(directory, 'src', 'manifest.ts');
        const packageJson = await readJson(packageJsonPath);
        const resolvedEntry = await resolveFrontendEntry(directory, packageJson);
        const frontendEntry = resolvedEntry || join(directory, 'src', 'frontend', 'frontend.ts');
        const fallbackId = packageJson.name?.split('/').at(-1) || directory.split(/[\\/]/).at(-1);
        const pluginId = await readPluginId(manifestPath, fallbackId);
        const relativeImportPath = relative(outputDir, frontendEntry).replace(/\\/g, '/');
        const sanitizedImportPath = relativeImportPath.startsWith('.')
            ? relativeImportPath
            : `./${relativeImportPath}`;
        // Strip TS-only extensions. Compiled entries keep their .js/.mjs
        // extension so Node/webpack resolve the artifact as-is.
        const importPathWithoutExtension = sanitizedImportPath.replace(/\.(ts|tsx)$/, '');
        const isCompiled = /\.(js|mjs|cjs)$/.test(frontendEntry);

        metadata.push({
            id: pluginId,
            importPath: importPathWithoutExtension,
            absoluteEntry: frontendEntry,
            isCompiled
        });
    }

    return metadata;
}

/**
 * Renders the TypeScript source for the registry module.
 *
 * Generates synchronous static imports for every plugin's frontend entry file
 * and exports a `frontendPlugins` array. Static imports are required for SSR:
 * the catch-all route's generateMetadata reads the registry server-side, and the
 * client-side PluginPageHandler now does a synchronous lookup during render
 * instead of polling, so the registry must be populated at module load time on
 * both server and client.
 *
 * Every plugin uses one import shape — namespace import (`import * as foo_module`)
 * — and the registry resolves the IPlugin via runtime discovery
 * (`Object.values().find(...)`). This contract is symmetric with the backend
 * loader at src/backend/loaders/plugins.generated.ts and removes the prior
 * default-import-only path that silently produced `undefined` whenever a plugin
 * forgot `export default`. Invalid plugins are skipped with a logged error
 * instead of poisoning the array — see `loadPluginCandidate` below.
 *
 * Plugin authors may use any named export. `export default` is permitted but
 * not required: the runtime walks Object.values for the first IPlugin-shaped
 * value. A `.d.ts` sidecar (see writeCompiledPluginTypes) supplies the IPlugin
 * type for TS module resolution so namespace imports on .js artifacts resolve
 * without allowJs.
 *
 * CSS code splitting is preserved because each plugin's frontend.ts uses
 * next/dynamic() to lazy-load its actual page components — the static import
 * here only pulls in the manifest and the dynamic wrappers, not the page CSS.
 */
function renderModule(metadata) {
    const header = `/**\n * AUTO-GENERATED FILE. DO NOT EDIT.\n *\n * This module is produced by scripts/generate-frontend-plugin-registry.mjs\n * and exposes a synchronous, statically-imported array of plugin frontends.\n *\n * Static imports are required so the plugin registry can be populated at\n * module load time on both server and client. CSS code splitting is preserved\n * because plugin frontend entry files use next/dynamic() for their page\n * components — only the manifest and dynamic wrappers are pulled in here.\n *\n * Every plugin module is imported under a namespace binding and the IPlugin\n * value is discovered via Object.values().find() at load time. Plugins whose\n * module exposes no IPlugin-shaped export are reported and dropped from the\n * resulting registry, never propagated as undefined into consumers.\n */\n`;

    const imports = `import type { IPlugin } from '@/types';\n\n`;

    if (metadata.length === 0) {
        const emptyBody = `export const frontendPlugins: IPlugin[] = [];\nexport const failedPluginLoads: ReadonlyArray<{ readonly pluginId: string; readonly reason: string }> = [];\n`;
        return `${header}${imports}${emptyBody}`;
    }

    const staticImports = metadata
        .map(({ id, importPath }) => {
            const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');
            return `import * as ${safeId}_module from '${importPath}';`;
        })
        .join('\n');

    const candidateEntries = metadata
        .map(({ id }) => {
            const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');
            return `    { pluginId: ${JSON.stringify(id)}, module: ${safeId}_module as Record<string, unknown> },`;
        })
        .join('\n');

    const resolver = `interface IPluginCandidate {\n    pluginId: string;\n    module: Record<string, unknown>;\n}\n\ninterface ILoadFailure {\n    pluginId: string;\n    reason: string;\n}\n\n/**\n * Returns true when value has the minimum IPlugin shape: a manifest object\n * with non-empty string id and title. Looser than the full IPlugin type so a\n * plugin can lack optional surfaces (pages, menuItems, adminPages, component)\n * and still register — those are validated by downstream consumers.\n */\nfunction isIPluginShape(value: unknown): value is IPlugin {\n    if (typeof value !== 'object' || value === null) return false;\n    const v = value as Record<string, unknown>;\n    if (typeof v.manifest !== 'object' || v.manifest === null) return false;\n    const m = v.manifest as Record<string, unknown>;\n    return typeof m.id === 'string' && m.id.length > 0\n        && typeof m.title === 'string' && m.title.length > 0;\n}\n\n/**\n * Scans a plugin module for the IPlugin-shaped value and returns it. Returns\n * null and records a failure when no candidate is found — the alternative,\n * throwing, would crash module load and break every consumer of\n * frontendPlugins, which is exactly the failure mode this loader exists to\n * eliminate.\n */\nfunction loadPluginCandidate(\n    candidate: IPluginCandidate,\n    failures: ILoadFailure[]\n): IPlugin | null {\n    const found = Object.values(candidate.module).find(isIPluginShape);\n    if (!found) {\n        const reason = \`No IPlugin-shaped export found. Ensure frontend.ts exports a constant whose \\\`manifest\\\` has string \\\`id\\\` and \\\`title\\\`.\`;\n        failures.push({ pluginId: candidate.pluginId, reason });\n        console.error(\`[plugins.generated] Failed to load plugin '\${candidate.pluginId}': \${reason}\`);\n        return null;\n    }\n    if (found.manifest.id !== candidate.pluginId) {\n        console.warn(\n            \`[plugins.generated] Plugin '\${candidate.pluginId}' has manifest id '\${found.manifest.id}'; \` +\n            \`the directory id is canonical for registry lookups.\`\n        );\n    }\n    return found;\n}\n\nconst _pluginCandidates: IPluginCandidate[] = [\n${candidateEntries}\n];\n\nconst _loadFailures: ILoadFailure[] = [];\n\n/**\n * Every plugin whose module produced a valid IPlugin shape. Plugins whose\n * module is malformed are absent and surfaced via failedPluginLoads.\n */\nexport const frontendPlugins: IPlugin[] = _pluginCandidates\n    .map(c => loadPluginCandidate(c, _loadFailures))\n    .filter((p): p is IPlugin => p !== null);\n\n/**\n * Diagnostic record of plugins whose module failed validation at load time.\n * Surface via /system/plugins so operators can see broken registrations\n * without grepping logs.\n */\nexport const failedPluginLoads: ReadonlyArray<ILoadFailure> = _loadFailures;\n`;

    const body = `${staticImports}\n\n${resolver}`;

    return `${header}${imports}${body}`;
}

/**
 * Writes a .d.ts sidecar next to each compiled plugin artifact.
 *
 * The root tsconfig uses `moduleResolution: "Node"` (legacy), so it doesn't
 * honor package `exports.types` conditions and instead looks for `.d.ts` files
 * sitting next to the imported `.js`. Each compiled plugin frontend therefore
 * needs a declaration that lets the registry's namespace import resolve.
 *
 * The declaration is intentionally permissive: it advertises a single
 * `plugin: IPlugin` and a matching default export so namespace imports always
 * compile, but the runtime registry rediscovers the actual export via
 * Object.values().find() regardless of name. Plugin authors are not bound to
 * use this exact identifier — the sidecar exists only to satisfy TS module
 * resolution, not to constrain the plugin's public API.
 *
 * The plugin's own build intentionally does not emit .d.ts — core's registry
 * generator owns the declarations because that's the only consumer that needs
 * them. The sidecar is reproducible from plugin source, so the plugin's
 * `dist/` stays a build artifact. We write using the `@delphian/tronrelic-types`
 * specifier (aliased project-wide in tsconfig.paths) so the sidecar resolves
 * without needing the plugin's node_modules to contain the types package.
 */
async function writeCompiledPluginTypes(metadata) {
    for (const entry of metadata) {
        if (!entry.isCompiled) {
            continue;
        }
        const sidecarPath = entry.absoluteEntry.replace(/\.(js|mjs|cjs)$/, '.d.ts');
        const contents = `/**\n * AUTO-GENERATED FILE. DO NOT EDIT.\n *\n * This declaration file is produced by\n * scripts/generate-frontend-plugin-registry.mjs so the core registry's\n * namespace import resolves under moduleResolution: "Node" without allowJs.\n *\n * The shape below is a TS-resolution affordance, not a runtime contract:\n * the registry discovers the IPlugin via Object.values().find() at load time,\n * so plugin authors may use any named export — this file does not bind them\n * to the identifier 'plugin' nor to providing a default export.\n */\nimport type { IPlugin } from '@delphian/tronrelic-types';\n\ndeclare const plugin: IPlugin;\nexport { plugin };\nexport default plugin;\n`;
        await writeIfChanged(sidecarPath, contents);
    }
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
 * Discovers plugin directories that ship widget components.
 *
 * Accepts either a legacy raw TS registry at `src/frontend/widgets/index.ts`
 * or a `package.json` exposing `exports."./frontend/widgets"` for self-built
 * plugins. The exports field is checked first so an opted-in plugin wins even
 * when the raw TS file is still present in the source tree.
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

        const resolved = await resolveWidgetsEntry(directory);
        if (resolved) {
            directories.push(directory);
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
        const packageJson = await readJson(packageJsonPath);
        const resolvedEntry = await resolveWidgetsEntry(directory, packageJson);
        const widgetsEntry = resolvedEntry || join(directory, 'src', 'frontend', 'widgets', 'index.ts');
        const fallbackId = packageJson.name?.split('/').at(-1) || directory.split(/[\\/]/).at(-1);
        const pluginId = await readPluginId(manifestPath, fallbackId);
        const relativeImportPath = relative(widgetsOutputDir, widgetsEntry).replace(/\\/g, '/');
        const sanitizedImportPath = relativeImportPath.startsWith('.')
            ? relativeImportPath
            : `./${relativeImportPath}`;
        // Strip TS-only extensions. Compiled entries keep their .js/.mjs
        // extension so Node/webpack resolve the artifact as-is.
        const importPathWithoutExtension = sanitizedImportPath.replace(/\.(ts|tsx)$/, '');
        const isCompiled = /\.(js|mjs|cjs)$/.test(widgetsEntry);

        metadata.push({
            id: pluginId,
            importPath: importPathWithoutExtension,
            absoluteEntry: widgetsEntry,
            isCompiled
        });
    }

    return metadata;
}

/**
 * Writes a .d.ts sidecar next to each compiled widget artifact.
 *
 * Mirrors `writeCompiledPluginTypes`: the root tsconfig uses
 * `moduleResolution: "Node"` (legacy) without `allowJs`, so importing a `.js`
 * widget registry without a sibling `.d.ts` triggers TS2307. Each compiled
 * widget entry needs a declaration stating that it exports
 * `widgetComponents: Record<string, WidgetComponent>` — the exact shape
 * `widgets.generated.ts` imports.
 *
 * The plugin's own build intentionally does not emit .d.ts — core's registry
 * generator owns the declarations because that's the only consumer that needs
 * them. The sidecar is reproducible from plugin source, so the plugin's
 * `dist/` stays a build artifact.
 */
async function writeCompiledWidgetTypes(metadata) {
    for (const entry of metadata) {
        if (!entry.isCompiled) {
            continue;
        }
        const sidecarPath = entry.absoluteEntry.replace(/\.(js|mjs|cjs)$/, '.d.ts');
        const contents = `/**\n * AUTO-GENERATED FILE. DO NOT EDIT.\n *\n * This declaration file is produced by\n * scripts/generate-frontend-plugin-registry.mjs and gives core's\n * widgets.generated.ts a typed named import for this compiled widget\n * registry. The plugin's own build intentionally skips .d.ts emission —\n * core owns this sidecar because core is the only consumer.\n */\nimport type { WidgetComponent } from '@delphian/tronrelic-types';\n\nexport declare const widgetComponents: Record<string, WidgetComponent>;\n`;
        await writeIfChanged(sidecarPath, contents);
    }
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
import type { WidgetComponent } from '@/types';

`;

    if (metadata.length === 0) {
        return `${header}/**
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
    }

    // Generate namespace imports for each plugin's widget module. Using a
    // namespace import (rather than `import { widgetComponents }`) means a
    // plugin that fails to export `widgetComponents` resolves to an empty
    // namespace at load time — the spread below would otherwise throw
    // "Cannot read properties of undefined" and take down every page that
    // hosts a widget zone.
    const imports = metadata
        .map(({ id, importPath }) => {
            const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');
            return `import * as ${safeId}_widgets_module from '${importPath}';`;
        })
        .join('\n');

    const mergeCalls = metadata
        .map(({ id }) => {
            const safeId = id.replace(/[^a-zA-Z0-9_]/g, '_');
            return `safeMergeWidgets(${JSON.stringify(id)}, (${safeId}_widgets_module as { widgetComponents?: unknown }).widgetComponents);`;
        })
        .join('\n');

    const registry = `
/**
 * Validates a plugin's widget map and merges it into the registry.
 *
 * Refuses missing or non-object exports rather than crashing the spread at
 * module load. A plugin whose frontend bundle is missing widgetComponents is
 * dropped with a logged warning instead of poisoning every widget zone on
 * the site.
 */
function safeMergeWidgets(
    pluginId: string,
    widgets: unknown
): void {
    if (widgets == null) {
        console.error(
            \`[widgets.generated] Plugin '\${pluginId}' module did not export widgetComponents. \` +
            \`Ensure src/frontend/widgets/index.ts contains \\\`export const widgetComponents = {...}\\\`.\`
        );
        return;
    }
    if (typeof widgets !== 'object') {
        console.error(
            \`[widgets.generated] Plugin '\${pluginId}' widgetComponents export is not an object (got \${typeof widgets}).\`
        );
        return;
    }
    Object.assign(widgetComponentRegistry, widgets);
}

/**
 * Combined widget component registry from all plugins.
 *
 * Maps widget IDs to their React components. Widget IDs must match
 * the IDs used in backend widget registration. Plugins whose widgetComponents
 * export is malformed are skipped with a logged error instead of crashing the
 * spread at module load.
 */
export const widgetComponentRegistry: Record<string, WidgetComponent> = {};

${mergeCalls}

/**
 * Look up a widget component by ID.
 *
 * @param widgetId - Widget identifier (e.g., 'whale-alerts:recent')
 * @returns Component if registered, undefined otherwise
 */
export function getWidgetComponent(widgetId: string): WidgetComponent | undefined {
    return widgetComponentRegistry[widgetId];
}
`;

    return `${header}${imports}\n${registry}`;
}

/**
 * Recursively counts files inside a directory.
 *
 * Used purely for the asset-copy log line so operators can see at a glance
 * how many plugin-owned files were staged into the frontend public folder.
 */
async function countFilesRecursive(directory) {
    let count = 0;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            count += await countFilesRecursive(join(directory, entry.name));
        } else {
            count++;
        }
    }
    return count;
}

/**
 * Copies plugin-owned static assets into the frontend public folder.
 *
 * Why this exists: plugins need stable, unfingerprinted public URLs for assets
 * that external consumers cache long-term — Open Graph images, manifest icons,
 * favicons. Webpack-imported assets (the `src/frontend/assets/` convention)
 * get hashed URLs that change every build, which breaks social media previews
 * cached by Facebook, Twitter, Discord, and Slack for weeks at a time.
 *
 * Convention: each plugin may declare a `src/frontend/public/` directory.
 * Everything inside is mirrored to `src/frontend/public/plugins/<plugin-id>/`
 * before `next build` runs, so Next.js's static file server picks them up
 * automatically. Plugin authors reference the deployed path as
 * `/plugins/<plugin-id>/<file>` from page configs, components, or metadata.
 *
 * The destination directory is wiped before each run so removed or renamed
 * plugins don't leave orphan files behind. The destination is git-ignored
 * (see .gitignore) because it is a build artifact reproducible from sources.
 */
async function copyPluginPublicAssets() {
    // Wipe stale assets from previous runs (handles removed/renamed plugins)
    // and recreate the parent so the destination is always present for inspection
    // even when no plugins ship public/ directories.
    await fs.rm(publicAssetsOutputRoot, { recursive: true, force: true });
    await fs.mkdir(publicAssetsOutputRoot, { recursive: true });

    const entries = await fs.readdir(pluginsRoot, { withFileTypes: true });
    let pluginsWithAssets = 0;
    let totalFilesCopied = 0;

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const pluginDirectory = join(pluginsRoot, entry.name);
        const sourcePublicDir = join(pluginDirectory, 'src', 'frontend', 'public');
        const manifestPath = join(pluginDirectory, 'src', 'manifest.ts');
        const packageJsonPath = join(pluginDirectory, 'package.json');

        // Skip plugins that don't ship a public/ directory. Use lstat (not stat)
        // so a symlinked public/ dir is rejected outright instead of being followed
        // — see the symlink filter on fs.cp below for the same defense in depth.
        try {
            const stat = await fs.lstat(sourcePublicDir);
            if (!stat.isDirectory()) {
                if (stat.isSymbolicLink()) {
                    console.warn(`⚠️  Skipping public assets for ${entry.name}: src/frontend/public is a symlink (refused)`);
                }
                continue;
            }
        } catch {
            continue;
        }

        // Resolve plugin id from manifest (matches the import-registry convention)
        let pluginId;
        try {
            const packageJson = await readJson(packageJsonPath);
            pluginId = await readPluginId(manifestPath, packageJson.name.split('/').at(-1));
        } catch (error) {
            console.warn(`⚠️  Skipping public assets for ${entry.name}: failed to resolve plugin id (${error.message})`);
            continue;
        }

        // Validate pluginId before using it as a filesystem path segment.
        // readPluginId() returns whatever string sits between quotes in manifest.ts,
        // which would let an id like '../foo' or 'a/b' write outside the destination
        // root or produce broken public URLs. Restrict to the same character set
        // every other TronRelic plugin id uses in practice.
        if (!pluginId || !/^[a-zA-Z0-9_-]+$/.test(pluginId)) {
            console.warn(`⚠️  Skipping public assets for ${entry.name}: invalid plugin id "${pluginId}" (must match [a-zA-Z0-9_-]+)`);
            continue;
        }

        const destinationDir = join(publicAssetsOutputRoot, pluginId);

        // Refuse to follow symlinks anywhere inside the plugin's public/ tree.
        // Plugins are first-party code, but a stray symlink pointing at host files
        // would silently mirror them into the publicly-served Next.js folder. The
        // filter walks every entry, lstat's it, and rejects symlinks before copy.
        await fs.cp(sourcePublicDir, destinationDir, {
            recursive: true,
            filter: async (src) => {
                const stat = await fs.lstat(src);
                if (stat.isSymbolicLink()) {
                    console.warn(`⚠️  Skipping symlink in ${entry.name} public assets: ${relative(pluginDirectory, src)}`);
                    return false;
                }
                return true;
            }
        });

        const fileCount = await countFilesRecursive(destinationDir);
        pluginsWithAssets++;
        totalFilesCopied += fileCount;
    }

    if (pluginsWithAssets > 0) {
        console.log(`✅ Copied ${totalFilesCopied} public asset(s) from ${pluginsWithAssets} plugin(s) → src/frontend/public/plugins/`);
    } else {
        console.log(`✅ No plugin public assets to copy`);
    }
}

/**
 * Orchestrates registry generation.
 *
 * Generates both the plugin loader registry (lazy imports for pages/components)
 * and the widget component registry (static imports for SSR), then mirrors
 * each plugin's `src/frontend/public/` directory into the frontend's public
 * folder so Next.js can serve plugin-owned static assets at stable URLs.
 */
async function run() {
    // Generate plugin loaders (lazy imports)
    const pluginMetadata = await collectPluginMetadata();
    const pluginModuleSource = renderModule(pluginMetadata);
    await writeIfChanged(outputPath, pluginModuleSource);

    // Emit a typed .d.ts sidecar next to each compiled plugin artifact so the
    // root tsconfig (moduleResolution: Node, legacy) can type default imports
    // without each plugin shipping its own declarations.
    await writeCompiledPluginTypes(pluginMetadata);

    // Generate widget component registry (static imports for SSR)
    const widgetMetadata = await collectWidgetMetadata();
    const widgetModuleSource = renderWidgetsModule(widgetMetadata);
    await writeIfChanged(widgetsOutputPath, widgetModuleSource);

    // Emit a typed .d.ts sidecar next to each compiled widget artifact for the
    // same reason as plugin frontends — the root tsconfig cannot resolve bare
    // .js imports without allowJs under strict mode.
    await writeCompiledWidgetTypes(widgetMetadata);

    // Mirror plugin-owned static assets into the frontend public folder
    await copyPluginPublicAssets();

    console.log(`✅ Generated plugin registry: ${pluginMetadata.length} plugins`);
    console.log(`✅ Generated widget registry: ${widgetMetadata.length} plugins with widgets`);
}

void run();
