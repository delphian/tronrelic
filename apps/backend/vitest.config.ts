import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.ts',              // Legacy tests in tests/ directory
      'src/**/__tests__/**/*.test.ts'     // Colocated tests in __tests__/ subdirectories
    ],
    exclude: ['node_modules', 'dist', '**/*.d.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    reporters: 'default',
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://localhost:27017/test',
      REDIS_URL: 'redis://localhost:6379'
    }
  }
});
