import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import type { IMigration } from '@/types';
import type { IMigrationMetadata, MigrationSortStrategy } from './types.js';
import { logger } from '../../../lib/logger.js';

/**
 * Filesystem scanner for discovering database migrations.
 *
 * Scans predefined locations in the codebase (system, modules, plugins) for migration
 * files, validates naming conventions, loads and validates migration objects, calculates
 * checksums, and builds a dependency graph for topological sorting.
 *
 * **Discovery locations:**
 * - System: `src/backend/services/database/migrations/`
 * - Modules: `src/backend/modules/{name}/migrations/`
 * - Plugins: `src/plugins/{name}/src/backend/migrations/`
 *
 * **Naming convention:**
 * Files must match: /^\d{3}_[a-z0-9_-]+\.(ts|js)$/
 *
 * Examples:
 * - 001_create_users.ts or .js (valid)
 * - 042_add_indexes.ts or .js (valid)
 * - 1_create_users.ts (invalid - insufficient leading zeros)
 * - 001-create-users.ts (invalid - hyphen instead of underscore)
 *
 * **Circular dependency detection:**
 * The scanner builds a dependency graph and detects cycles using depth-first search.
 * If a cycle is found, an error is thrown with the cycle path for debugging.
 *
 * @example
 * ```typescript
 * const scanner = new MigrationScanner();
 * const migrations = await scanner.scan();
 *
 * console.log(`Found ${migrations.length} migrations`);
 * migrations.forEach(m => {
 *     console.log(`${m.id} (${m.source}): ${m.description}`);
 * });
 * ```
 */
export class MigrationScanner {
    /**
     * Regex pattern for valid migration filenames.
     *
     * Format: `{3 digits}_{snake_case_description}.(ts|js)`
     *
     * Accepts both .ts (development) and .js (production/Docker) extensions.
     *
     * Captures:
     * - Group 1: Numeric prefix (001, 042, 123)
     * - Group 2: Description (create_users, add_indexes, etc.)
     */
    private static readonly FILENAME_PATTERN = /^(\d{3})_([a-z0-9_-]+)\.(ts|js)$/;

    /**
     * Project root anchor used to derive both compiled and source backend paths.
     *
     * `process.cwd()` is stable across `npm run dev` (project root) and production
     * Docker (`WORKDIR /app`). `import.meta.url` points at the esbuild bundle in
     * production and is unreliable for filesystem navigation.
     */
    private readonly projectRoot: string;

    /**
     * Compiled backend tree (`<root>/dist/backend`) — preferred at runtime.
     *
     * Node's dynamic `import()` cannot load TypeScript directly; the backend itself
     * runs from `dist/backend/index.js` in production, and migrations must execute
     * from the same compiled tree. `dist/` is the canonical runtime location.
     */
    private readonly distBackendRoot: string;

    /**
     * Source backend tree (`<root>/src/backend`) — development fallback.
     *
     * Used when `dist/` has not been generated, so `npm run dev` (tsx/ts-node)
     * keeps working without an explicit build step. Production images do not
     * ship `src/backend/`, so this fallback never resolves there.
     */
    private readonly srcBackendRoot: string;

    constructor() {
        this.projectRoot = process.cwd();
        this.distBackendRoot = join(this.projectRoot, 'dist', 'backend');
        this.srcBackendRoot = join(this.projectRoot, 'src', 'backend');
    }

    /**
     * Validate migration filename against naming convention.
     *
     * Checks if filename matches the required pattern:
     * - 3 digits prefix (001-999)
     * - Underscore separator
     * - Lowercase description with letters, numbers, hyphens, underscores
     * - .ts or .js extension (both accepted)
     *
     * @param filename - Base filename to validate (e.g., '001_create_users.ts' or '001_create_users.js')
     * @returns True if filename matches convention, false otherwise
     *
     * @example
     * ```typescript
     * scanner.isValidFilename('001_create_users.ts')  // true
     * scanner.isValidFilename('001_create_users.js')  // true
     * scanner.isValidFilename('1_test.ts')            // false (not 3 digits)
     * scanner.isValidFilename('001_CreateUsers.ts')   // false (uppercase)
     * ```
     */
    public isValidFilename(filename: string): boolean {
        return MigrationScanner.FILENAME_PATTERN.test(filename);
    }

    /**
     * Calculate SHA-256 checksum for file contents.
     *
     * Used to detect if migration code has changed since last execution.
     * Changes to migration files after they've been executed should be avoided,
     * but this checksum helps detect accidental modifications.
     *
     * @param content - File content as string or Buffer
     * @returns Hexadecimal checksum string (64 characters)
     *
     * @example
     * ```typescript
     * const checksum = scanner.calculateChecksum('export const migration = {...}');
     * console.log(checksum); // "a3d4e5f6..."
     * ```
     */
    public calculateChecksum(content: string | Buffer): string {
        return createHash('sha256').update(content).digest('hex');
    }

    /**
     * Validate that migration ID matches its filename.
     *
     * This prevents copy-paste errors where developers duplicate a migration file
     * but forget to update the id field inside. Mismatched IDs cause database
     * tracking issues where the filesystem shows one thing but the database
     * records another.
     *
     * @param filePath - Absolute path to migration file
     * @param migration - Loaded migration object
     * @throws Error if migration.id doesn't match the filename (without extension)
     *
     * @example
     * ```typescript
     * // Valid - ID matches filename
     * scanner.validateIdMatchesFilename(
     *     '/path/001_create_users.ts', // or .js
     *     { id: '001_create_users', ... }
     * ); // No error
     *
     * // Invalid - ID mismatch
     * scanner.validateIdMatchesFilename(
     *     '/path/001_create_users.ts',
     *     { id: '999_wrong', ... }
     * ); // Throws error
     * ```
     */
    public validateIdMatchesFilename(filePath: string, migration: IMigration): void {
        const ext = filePath.endsWith('.js') ? '.js' : '.ts';
        const filename = basename(filePath, ext);
        if (migration.id !== filename) {
            throw new Error(
                `ID mismatch: filename is '${filename}' but migration.id is '${migration.id}'. ` +
                `These must match to prevent database tracking errors. ` +
                `Did you copy this file and forget to update the id field?`
            );
        }
    }

    /**
     * Validate an imported migration module and build complete metadata.
     *
     * This is the core validation logic separated from I/O operations for testability.
     * Validates that the module exports a properly structured migration object with
     * all required fields, checks ID matches filename, and builds complete metadata.
     *
     * **This method is public to enable thorough unit testing of validation logic
     * without requiring filesystem access or dynamic imports.**
     *
     * @param migrationModule - Imported module object (should have `migration` property)
     * @param filePath - Absolute path to migration file (for error messages and ID validation)
     * @param source - Source identifier ('system', 'module:name', or 'plugin:name')
     * @param checksum - SHA-256 checksum of file contents
     * @param timestamp - File modification time
     * @returns Complete migration metadata ready for execution
     * @throws Error if module doesn't export migration, or migration is invalid
     *
     * @example
     * ```typescript
     * const mockModule = {
     *     migration: {
     *         id: '001_test',
     *         description: 'Test migration',
     *         dependencies: [],
     *         up: async (db) => { ... }
     *     }
     * };
     *
     * const metadata = scanner.validateMigrationObject(
     *     mockModule,
     *     '/path/001_test.ts',
     *     'system',
     *     'abc123...',
     *     new Date()
     * );
     * ```
     */
    public validateMigrationObject(
        migrationModule: any,
        filePath: string,
        source: string,
        checksum: string,
        timestamp: Date
    ): IMigrationMetadata {
        // Validate module exports migration object
        if (!migrationModule.migration) {
            throw new Error(`Migration file must export 'migration' object: ${basename(filePath)}`);
        }

        const migration: IMigration = migrationModule.migration;

        // Validate required fields
        if (!migration.id || typeof migration.id !== 'string') {
            throw new Error(`Migration must have valid 'id' field: ${basename(filePath)}`);
        }

        if (!migration.description || typeof migration.description !== 'string') {
            throw new Error(`Migration must have valid 'description' field: ${migration.id}`);
        }

        if (typeof migration.up !== 'function') {
            throw new Error(`Migration must have 'up' method: ${migration.id}`);
        }

        // Validate ID matches filename (prevents copy-paste errors)
        this.validateIdMatchesFilename(filePath, migration);

        // Build qualified ID based on source
        // System migrations use plain ID, modules/plugins get source prefix
        const qualifiedId = source === 'system'
            ? migration.id
            : `${source}:${migration.id}`;

        // Build complete metadata
        const metadata: IMigrationMetadata = {
            ...migration,
            source,
            qualifiedId,
            filePath,
            timestamp,
            checksum,
            dependencies: migration.dependencies || []
        };

        logger.debug({
            id: metadata.id,
            qualifiedId: metadata.qualifiedId,
            source: metadata.source,
            dependencies: metadata.dependencies?.length || 0
        }, 'Loaded migration');

        return metadata;
    }

    /**
     * Scan filesystem for all migration files and build metadata.
     *
     * Discovers migrations from all configured locations, validates naming conventions,
     * loads migration objects, calculates checksums, resolves dependencies, and sorts
     * migrations in topological order.
     *
     * **Execution flow:**
     * 1. Scan system migrations directory
     * 2. Scan all module migrations directories
     * 3. Scan all plugin migrations directories
     * 4. Validate each migration file (naming, structure, required fields)
     * 5. Calculate SHA-256 checksums
     * 6. Build dependency graph
     * 7. Detect circular dependencies
     * 8. Sort migrations topologically
     *
     * **Error handling:**
     * - Invalid filenames are logged as warnings and skipped
     * - Missing dependencies cause scan to fail with descriptive error
     * - Circular dependencies cause scan to fail with cycle path
     * - File read errors are logged as errors and skipped
     *
     * **Phantom dependencies.** Pass `completedQualifiedIds` to satisfy
     * declared dependencies whose source has been retired but whose execution
     * is still recorded in the `migrations` collection. The graph then
     * accepts them as already-completed leaves and the scan no longer fails
     * just because an old migration file was deleted — see `topologicalSort`.
     *
     * @param sortStrategy - How to order migrations before dependency resolution (default: 'id')
     * @param completedQualifiedIds - Qualified IDs of migrations recorded as completed in history. Empty by default; pass from {@link MigrationTracker.getCompletedMigrationIds} for production use.
     * @returns Promise resolving to array of validated migration metadata in execution order
     * @throws Error if circular dependencies detected or required dependencies missing
     *
     * @example
     * ```typescript
     * const scanner = new MigrationScanner();
     *
     * try {
     *     const completed = new Set(await tracker.getCompletedMigrationIds());
     *     const migrations = await scanner.scan('id', completed);
     *     console.log(`Ready to execute ${migrations.length} migrations`);
     * } catch (error) {
     *     console.error('Migration scan failed:', error.message);
     * }
     * ```
     */
    public async scan(
        sortStrategy: MigrationSortStrategy = 'id',
        completedQualifiedIds: Set<string> = new Set()
    ): Promise<IMigrationMetadata[]> {
        logger.info('Scanning for database migrations...');

        const migrations: IMigrationMetadata[] = [];

        // System and module migrations resolve under whichever backend tree
        // exists — dist/ in production, src/ in dev. Plugin enumeration always
        // walks src/plugins/ (the directory exists in both environments); the
        // dist-vs-src choice happens per-plugin inside scanPlugins.
        const backendRoot = await this.resolveBackendRoot();

        const systemMigrations = await this.scanDirectory(
            join(backendRoot, 'services', 'database', 'migrations'),
            'system'
        );
        migrations.push(...systemMigrations);

        const moduleMigrations = await this.scanModules(join(backendRoot, 'modules'));
        migrations.push(...moduleMigrations);

        const pluginMigrations = await this.scanPlugins(join(this.projectRoot, 'src', 'plugins'));
        migrations.push(...pluginMigrations);

        // Sort migrations by chosen strategy
        this.sortMigrations(migrations, sortStrategy);

        // Validate dependencies and build execution order
        const sorted = this.topologicalSort(migrations, completedQualifiedIds);

        logger.info({
            total: sorted.length,
            system: sorted.filter(m => m.source === 'system').length,
            modules: sorted.filter(m => m.source.startsWith('module:')).length,
            plugins: sorted.filter(m => m.source.startsWith('plugin:')).length
        }, 'Migration scan complete');

        return sorted;
    }

    /**
     * Pick the runtime backend root, gated on `NODE_ENV`.
     *
     * **Production (`NODE_ENV === 'production'`):** always `dist/backend`. No
     * fallback. Production images ship the compiled tree and omit `src/backend`;
     * if `dist/` is somehow missing, the scanner returns no migrations rather
     * than dropping back to `.ts` source files that Node's `import()` cannot
     * load. The previous fallback masked exactly the packaging failure this
     * PR is fixing.
     *
     * **Development (anything else):** prefer `src/backend` so hot-reloaded
     * source edits are picked up immediately. A stale `dist/` left over from
     * an earlier `npm run build` would otherwise shadow source changes —
     * `dev:backend` does not clean it. Falls through to `dist/backend` only
     * when `src/backend` is absent (rare; typically a misconfigured workspace).
     */
    private async resolveBackendRoot(): Promise<string> {
        if (process.env.NODE_ENV === 'production') {
            return this.distBackendRoot;
        }
        return (await this.directoryExists(this.srcBackendRoot))
            ? this.srcBackendRoot
            : this.distBackendRoot;
    }

    /**
     * Pick a plugin's migrations directory, gated on `NODE_ENV`.
     *
     * Same production-strict / dev-prefer-src rule as {@link resolveBackendRoot}.
     * In production the scanner only looks at `<plugin>/dist/backend/migrations`
     * — a missing or empty compiled tree surfaces as "no migrations discovered"
     * rather than silently loading `.ts` sources that fail at `import()` time.
     */
    private async resolvePluginMigrationsPath(pluginPath: string): Promise<string> {
        const distPath = join(pluginPath, 'dist', 'backend', 'migrations');
        const srcPath = join(pluginPath, 'src', 'backend', 'migrations');
        if (process.env.NODE_ENV === 'production') {
            return distPath;
        }
        return (await this.directoryExists(srcPath)) ? srcPath : distPath;
    }

    /**
     * Test whether a path exists and is a directory. Returns false on any
     * stat failure (ENOENT, permission errors, race conditions) so callers
     * can treat "not present" and "not accessible" identically.
     */
    private async directoryExists(path: string): Promise<boolean> {
        try {
            const s = await stat(path);
            return s.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Scan a specific directory for migration files.
     *
     * Reads all `.ts` or `.js` files in the directory, validates naming conventions, loads
     * migration objects, and builds metadata.
     *
     * **Note:** Does not scan subdirectories. Migrations must be directly in the
     * specified directory.
     *
     * @param dirPath - Absolute path to migrations directory
     * @param source - Source identifier (e.g., 'system', 'module:menu', 'plugin:whale-alerts')
     * @returns Promise resolving to array of migration metadata from this directory
     */
    private async scanDirectory(dirPath: string, source: string): Promise<IMigrationMetadata[]> {
        const migrations: IMigrationMetadata[] = [];

        try {
            // Check if directory exists
            const dirStats = await stat(dirPath);
            if (!dirStats.isDirectory()) {
                logger.warn({ path: dirPath }, 'Migration path is not a directory');
                return migrations;
            }

            // Read all files in directory
            const files = await readdir(dirPath);

            for (const file of files) {
                // Skip non-migration files (both .ts and .js are valid)
                if (!file.endsWith('.ts') && !file.endsWith('.js')) {
                    continue;
                }

                // Validate filename format using dedicated method
                if (!this.isValidFilename(file)) {
                    logger.warn({
                        file,
                        source,
                        pattern: MigrationScanner.FILENAME_PATTERN.toString()
                    }, 'Migration filename does not match naming convention (skipping)');
                    continue;
                }

                const filePath = join(dirPath, file);

                try {
                    const metadata = await this.loadMigration(filePath, source);
                    migrations.push(metadata);
                } catch (error) {
                    logger.error({ error, file, source }, 'Failed to load migration (skipping)');
                }
            }
        } catch (error: any) {
            // Directory doesn't exist or not readable - this is expected for many locations
            if (error.code === 'ENOENT') {
                logger.debug({ path: dirPath }, 'Migration directory does not exist (skipping)');
            } else {
                logger.error({ error, path: dirPath }, 'Failed to scan migration directory');
            }
        }

        return migrations;
    }

    /**
     * Scan all module directories for migrations.
     *
     * Iterates through `src/backend/modules/*` and scans each module's
     * `migrations/` subdirectory.
     *
     * @param modulesDir - Path to modules directory
     * @returns Promise resolving to array of all module migrations
     */
    private async scanModules(modulesDir: string): Promise<IMigrationMetadata[]> {
        const migrations: IMigrationMetadata[] = [];

        try {
            const modules = await readdir(modulesDir);

            for (const moduleName of modules) {
                const modulePath = join(modulesDir, moduleName);
                const moduleStats = await stat(modulePath);

                if (!moduleStats.isDirectory()) {
                    continue;
                }

                const migrationsPath = join(modulePath, 'migrations');
                const moduleMigrations = await this.scanDirectory(migrationsPath, `module:${moduleName}`);
                migrations.push(...moduleMigrations);
            }
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                logger.error({ error, path: modulesDir }, 'Failed to scan modules directory');
            }
        }

        return migrations;
    }

    /**
     * Scan all plugin directories for migrations.
     *
     * Iterates through `src/plugins/*` and resolves each plugin's migrations
     * path via {@link resolvePluginMigrationsPath} — preferring the compiled
     * `<plugin>/dist/backend/migrations` and falling back to the source path
     * for dev. Plugin enumeration walks `src/plugins/` because that directory
     * exists in both environments; the per-plugin pick selects compiled vs.
     * source for the migration files themselves.
     *
     * @param pluginsDir - Path to plugins directory
     * @returns Promise resolving to array of all plugin migrations
     */
    private async scanPlugins(pluginsDir: string): Promise<IMigrationMetadata[]> {
        const migrations: IMigrationMetadata[] = [];

        try {
            const plugins = await readdir(pluginsDir);

            for (const pluginId of plugins) {
                const pluginPath = join(pluginsDir, pluginId);
                const pluginStats = await stat(pluginPath);

                if (!pluginStats.isDirectory()) {
                    continue;
                }

                const migrationsPath = await this.resolvePluginMigrationsPath(pluginPath);
                const pluginMigrations = await this.scanDirectory(migrationsPath, `plugin:${pluginId}`);
                migrations.push(...pluginMigrations);
            }
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                logger.error({ error, path: pluginsDir }, 'Failed to scan plugins directory');
            }
        }

        return migrations;
    }

    /**
     * Dynamically import a migration module from filesystem.
     *
     * Thin wrapper around Node.js dynamic import. This method is intentionally simple
     * to isolate the hard-to-test I/O operation from the business logic.
     * The validation logic lives in validateMigrationObject() which is thoroughly unit tested.
     *
     * @param filePath - Absolute path to migration file
     * @returns Imported module object
     * @throws Error if import fails
     */
    private async importMigrationModule(filePath: string): Promise<any> {
        return await import(`file://${filePath}`);
    }

    /**
     * Load a migration file and build metadata.
     *
     * Coordinates filesystem operations, dynamic import, and validation to produce
     * complete migration metadata. This method is now a thin coordinator that delegates
     * to smaller, testable methods.
     *
     * **Required exports:**
     * Migration files must export a `migration` object implementing `IMigration`:
     * ```typescript
     * export const migration: IMigration = {
     *     id: '001_create_users',
     *     description: 'Create users collection',
     *     dependencies: [],
     *     async up(database) { ... }
     * };
     * ```
     *
     * @param filePath - Absolute path to migration file
     * @param source - Source identifier
     * @returns Promise resolving to complete migration metadata
     * @throws Error if migration export is invalid or required fields missing
     */
    private async loadMigration(filePath: string, source: string): Promise<IMigrationMetadata> {
        // Calculate checksum from file contents using dedicated method
        const buffer = await readFile(filePath);
        const checksum = this.calculateChecksum(buffer);

        // Get file modification time as fallback timestamp
        const fileStats = await stat(filePath);
        const timestamp = fileStats.mtime;

        // Dynamically import the migration module (thin I/O wrapper)
        const migrationModule = await this.importMigrationModule(filePath);

        // Validate and build metadata (pure logic, thoroughly tested)
        return this.validateMigrationObject(migrationModule, filePath, source, checksum, timestamp);
    }

    /**
     * Sort migrations by chosen strategy.
     *
     * Applies initial sorting before dependency resolution. Topological sort will
     * override this ordering when dependencies require it.
     *
     * **Strategies:**
     * - `'id'` - Lexicographic sort by ID (numeric prefixes provide natural order)
     * - `'timestamp'` - Chronological sort by file timestamp
     * - `'source-then-id'` - Group by source, then sort by ID within each group
     *
     * @param migrations - Array of migrations to sort (mutated in place)
     * @param strategy - Sorting strategy to apply
     */
    private sortMigrations(migrations: IMigrationMetadata[], strategy: MigrationSortStrategy): void {
        switch (strategy) {
            case 'timestamp':
                migrations.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
                break;

            case 'source-then-id':
                migrations.sort((a, b) => {
                    // System migrations first, then modules, then plugins
                    const sourceOrder = (src: string) => {
                        if (src === 'system') return 0;
                        if (src.startsWith('module:')) return 1;
                        return 2;
                    };

                    const orderA = sourceOrder(a.source);
                    const orderB = sourceOrder(b.source);

                    if (orderA !== orderB) {
                        return orderA - orderB;
                    }

                    return a.id.localeCompare(b.id);
                });
                break;

            case 'id':
            default:
                migrations.sort((a, b) => a.id.localeCompare(b.id));
                break;
        }
    }

    /**
     * Perform topological sort on migrations based on dependencies.
     *
     * Uses depth-first search to build execution order that respects all dependencies.
     * Detects circular dependencies and throws error if found.
     *
     * **Algorithm:**
     * 1. Build adjacency list of dependency relationships
     * 2. For each unvisited migration, perform DFS
     * 3. Mark migrations as visiting (gray) or visited (black)
     * 4. Detect cycles if we encounter a gray node during traversal
     * 5. Add migrations to result in post-order (dependencies first)
     *
     * **Phantom dependencies.** A dep listed in `completedQualifiedIds`
     * but absent from the discovered set is treated as an already-executed
     * leaf: the validation accepts it, and the DFS does not recurse into
     * it (it has no further deps to traverse and cannot participate in a
     * cycle of currently-discoverable migrations). This lets operators
     * delete migration source files once every environment has run them
     * without breaking downstream migrations that still declare the
     * retired ID as a dependency.
     *
     * @param migrations - Array of migrations to sort
     * @param completedQualifiedIds - Qualified IDs of migrations recorded as completed in history. Empty by default — every dep must then be on disk.
     * @returns Array of migrations in topological order (dependencies before dependents)
     * @throws Error if circular dependencies detected or dependency not found on disk and not completed historically
     */
    private topologicalSort(
        migrations: IMigrationMetadata[],
        completedQualifiedIds: Set<string> = new Set()
    ): IMigrationMetadata[] {
        // Build map for fast lookup using qualified IDs
        const migrationMap = new Map<string, IMigrationMetadata>();
        for (const migration of migrations) {
            migrationMap.set(migration.qualifiedId, migration);
        }

        // Validate every dep either exists on disk or is recorded as
        // completed historically. The completed branch is what makes
        // retiring an old migration file safe in environments that have
        // already executed it.
        for (const migration of migrations) {
            for (const depId of migration.dependencies || []) {
                // Support both plain IDs (resolve to system) and qualified IDs
                // Plain dependency ID like '001_create_users' means system migration
                // Qualified dependency ID like 'module:menu:001_add_namespace' is explicit
                const lookupId = depId.includes(':') ? depId : depId; // Plain ID assumes system

                if (!migrationMap.has(lookupId) && !completedQualifiedIds.has(lookupId)) {
                    throw new Error(
                        `Migration '${migration.qualifiedId}' depends on '${depId}', but that migration was not found on disk and has no completed record in the migrations collection. ` +
                        `Available migrations: ${Array.from(migrationMap.keys()).join(', ')}. ` +
                        `Ensure the dependency exists, has been completed historically, or remove it from the dependencies array.`
                    );
                }
            }
        }

        // Topological sort with cycle detection
        const sorted: IMigrationMetadata[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>(); // Track nodes currently in DFS path (for cycle detection)

        const visit = (migration: IMigrationMetadata, path: string[] = []): void => {
            if (visited.has(migration.qualifiedId)) {
                return; // Already processed
            }

            if (visiting.has(migration.qualifiedId)) {
                // Circular dependency detected
                const cycle = [...path, migration.qualifiedId].join(' -> ');
                throw new Error(
                    `Circular dependency detected: ${cycle}. ` +
                    `Remove one of these dependencies to break the cycle.`
                );
            }

            visiting.add(migration.qualifiedId);
            path.push(migration.qualifiedId);

            // Visit all dependencies first (DFS)
            for (const depId of migration.dependencies || []) {
                // Support both plain and qualified dependency IDs
                const lookupId = depId.includes(':') ? depId : depId;
                const dep = migrationMap.get(lookupId);
                // Phantom deps (recorded as completed but absent from disk)
                // are leaves: already executed, no further deps to traverse,
                // can't participate in a cycle of discoverable migrations.
                if (dep) {
                    visit(dep, [...path]);
                }
            }

            visiting.delete(migration.qualifiedId);
            visited.add(migration.qualifiedId);
            sorted.push(migration);
        };

        // Visit all migrations
        for (const migration of migrations) {
            visit(migration);
        }

        return sorted;
    }
}
