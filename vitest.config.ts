import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/globalSetup.ts'],
    globalSetup: ['./tests/setup/startup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        isolate: true,
      },
    },
    sequence: {
      shuffle: false,
    },
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['server/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.config.ts', 'tests/**'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@server': resolve(__dirname, 'server'),
    },
  },
});
