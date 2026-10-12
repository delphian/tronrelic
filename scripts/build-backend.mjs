#!/usr/bin/env node
/**
 * @fileoverview Backend build script using esbuild.
 *
 * Bundles the backend application with path alias resolution. External
 * dependencies (express, mongoose, etc.) are not bundled to keep the
 * output lean and allow native modules to work correctly.
 *
 * Also compiles each migration into its own self-contained file so it can be
 * dynamically imported at runtime by MigrationScanner. Migrations stay out of
 * the main bundle because the scanner finds them on the filesystem, but each
 * one is bundled on its own so the module files it imports travel with it.
 */

import * as esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** Path aliases shared between the main bundle and migration file compilation. */
const aliases = {
    '@/types': path.join(projectRoot, 'packages/types/src'),
    '@/shared': path.join(projectRoot, 'src/shared'),
    '@/backend': path.join(projectRoot, 'src/backend'),
    '@/frontend': path.join(projectRoot, 'src/frontend'),
    '@/plugins': path.join(projectRoot, 'src/plugins'),
};

// --- Main backend bundle ---
await esbuild.build({
    entryPoints: [path.join(projectRoot, 'src/backend/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: path.join(projectRoot, 'dist/backend/index.js'),
    sourcemap: true,
    external: [
        // Keep all node_modules external - they'll be installed via npm ci
        './node_modules/*',
        '../node_modules/*',
        '*.node',
    ],
    packages: 'external',
    alias: aliases,
});

console.log('Backend build complete: dist/backend/index.js');

// --- Compile migration files individually ---
// MigrationScanner discovers migrations via readdir() and dynamic import() at runtime.
// These files are NOT included in the main bundle, so they must be compiled separately
// and placed at the same relative paths under dist/ for production Docker images.
//
// The production image ships dist/backend/ and not src/backend/, and with
// NODE_ENV=production the scanner reads only dist/backend/.

/**
 * Collect .ts files from a directory, returning paths relative to projectRoot.
 *
 * @param {string} dirPath - Absolute path to scan for .ts files
 * @returns {string[]} Relative paths (e.g., 'src/backend/services/database/migrations/001_foo.ts')
 */
function collectTsFiles(dirPath) {
    const result = [];

    try {
        const files = fs.readdirSync(dirPath);

        for (const file of files) {
            if (file.endsWith('.ts')) {
                result.push(path.relative(projectRoot, path.join(dirPath, file)));
            }
        }
    } catch {
        // Directory doesn't exist — expected for optional locations
    }

    return result;
}

const migrationFiles = [
    // System migrations
    ...collectTsFiles(path.join(projectRoot, 'src/backend/services/database/migrations')),
    // Module migrations (scan each module's migrations/ subdirectory)
    ...(fs.existsSync(path.join(projectRoot, 'src/backend/modules'))
        ? fs.readdirSync(path.join(projectRoot, 'src/backend/modules'))
            .filter(name => {
                const fullPath = path.join(projectRoot, 'src/backend/modules', name);
                return fs.statSync(fullPath).isDirectory();
            })
            .flatMap(name =>
                collectTsFiles(path.join(projectRoot, 'src/backend/modules', name, 'migrations'))
            )
        : []),
];

if (migrationFiles.length > 0) {
    await esbuild.build({
        entryPoints: migrationFiles.map(f => path.join(projectRoot, f)),
        // Each migration is bundled into one self-contained file. Only migration
        // entry points are emitted under dist/, so with bundle:false a relative
        // runtime import such as '../chain-data/buildChainDataSchema.js' would
        // survive into the compiled file with nothing to resolve to, and
        // MigrationScanner would log the failed import and skip the migration.
        // Bundling inlines those imports, so a migration can share constants with
        // its module instead of copying them.
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'esm',
        outbase: path.join(projectRoot, 'src'),
        outdir: path.join(projectRoot, 'dist'),
        alias: aliases,
        // The root tsconfig maps bare package names such as 'mongodb' through
        // compilerOptions.paths, and esbuild treats a remapped name as a file path,
        // which overrides packages:'external' and copies the whole driver into the
        // migration. This override drops baseUrl and paths for this build so
        // node_modules stay external; the aliases above cover the @/ imports.
        tsconfigRaw: { compilerOptions: { target: 'ES2022' } },
        packages: 'external',
    });

    console.log(`Compiled ${migrationFiles.length} migration file(s) to dist/`);
} else {
    console.log('No migration files found to compile');
}
