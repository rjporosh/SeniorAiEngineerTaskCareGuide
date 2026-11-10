import { defineConfig } from 'vitest/config';

const integration = process.env.VITEST_INTEGRATION === '1';

export default defineConfig({
  test: {
    include: integration ? ['src/**/*.int.spec.ts'] : ['src/**/*.spec.ts'],
    exclude: integration ? [] : ['src/**/*.int.spec.ts', 'node_modules/**'],
    testTimeout: integration ? 60_000 : 10_000,
    hookTimeout: integration ? 60_000 : 10_000,
    fileParallelism: false,
  },
});
