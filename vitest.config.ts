import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest configuration for TronRelic single-package architecture.
 *
 * This config provides path alias resolution matching tsconfig.json
 * and includes tests from all source directories.
 *
 * Running tests:
 * - `npm test`: Runs all core tests
 * - `npm run test:plugins`: Runs tests in each plugin directory
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: [
            'src/**/__tests__/**/*.test.ts',
            'src/**/tests/**/*.test.ts'
        ],
        exclude: [
            'node_modules',
            'dist',
            '.next',
            'src/frontend/.next',
            'src/plugins/**',
            '**/*.d.ts'
        ],
        testTimeout: 90_000,
        hookTimeout: 90_000,
        reporters: 'default',
        env: {
            NODE_ENV: 'test',
            MONGODB_URI: 'mongodb://localhost:27017/test',
            REDIS_URL: 'redis://localhost:6379'
        }
    },
    resolve: {
        alias: {
            '@/types': path.resolve(__dirname, 'src/types'),
            '@/shared': path.resolve(__dirname, 'src/shared'),
            '@/backend': path.resolve(__dirname, 'src/backend'),
            '@/frontend': path.resolve(__dirname, 'src/frontend'),
            '@/plugins': path.resolve(__dirname, 'src/plugins')
        }
    }
});
