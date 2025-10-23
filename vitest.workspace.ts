import { defineWorkspace } from 'vitest/config';

/**
 * Vitest workspace configuration for VSCode extension support.
 *
 * This file tells the Vitest VSCode extension to discover tests across all
 * workspaces in the monorepo. Each workspace can have its own vitest.config.ts
 * with custom settings.
 *
 * Why this exists:
 * - VSCode Vitest extension needs workspace definitions to discover tests in packages/
 * - Enables "Run Test" and "Debug Test" CodeLens in all workspace test files
 * - Allows running tests from the Vitest sidebar for the entire monorepo
 *
 * Without this file:
 * - VSCode may only discover tests in apps/ directories
 * - Tests in packages/plugins/ may not show CodeLens or sidebar entries
 * - "Run All Tests" may miss workspace test files
 *
 * Glob patterns:
 * - 'packages/plugins/*' automatically discovers all plugin packages
 * - New plugins are automatically included without modifying this file
 */
export default defineWorkspace([
    // Apps
    'apps/backend',
    'apps/frontend',

    // Core packages
    'packages/types',
    'packages/shared',

    // Plugin packages (all plugins discovered automatically)
    'packages/plugins/*'
]);
