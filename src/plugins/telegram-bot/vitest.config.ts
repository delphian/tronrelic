import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: [
            'src/**/__tests__/**/*.test.ts'
        ],
        exclude: ['node_modules', 'dist', '**/*.d.ts'],
        testTimeout: 30_000,
        hookTimeout: 30_000,
        reporters: 'default'
    }
});
