import { defineConfig } from 'vitest/config';

/**
 * Root-level Vitest configuration for monorepo.
 *
 * This config provides default settings when running `vitest` from the root directory.
 * Individual workspaces can override settings with their own vitest.config.ts files.
 *
 * Note: The VSCode Vitest extension uses vitest.workspace.ts instead of this file
 * for workspace discovery. This config serves as a fallback and provides defaults.
 *
 * Why both files exist:
 * - vitest.workspace.ts: Workspace discovery for VSCode extension (glob-based)
 * - vitest.config.ts: Default config and fallback for CLI usage
 *
 * Running tests:
 * - `npm test`: Uses this config to run all tests
 * - VSCode extension: Uses vitest.workspace.ts for test discovery
 * - Individual workspaces: Can override with their own vitest.config.ts
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: [
            'apps/**/tests/**/*.test.ts',           // Legacy tests in tests/ directories
            'apps/**/src/**/__tests__/**/*.test.ts', // Colocated tests in apps
            'packages/**/src/**/__tests__/**/*.test.ts' // Colocated tests in packages
        ],
        exclude: ['node_modules', 'dist', '.next', '**/*.d.ts'],
        testTimeout: 90_000,
        hookTimeout: 90_000,
        reporters: 'default',
        // Default env vars for all tests (individual workspaces can override)
        env: {
            NODE_ENV: 'test',
            MONGODB_URI: 'mongodb://localhost:27017/test',
            REDIS_URL: 'redis://localhost:6379'
        }
    }
});
