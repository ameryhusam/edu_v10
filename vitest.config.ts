import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/contexts/**/domain/**', 'src/contexts/**/application/**'],
      // The domain layer is where the product's value and risk live.
      thresholds: { lines: 70, functions: 70 },
    },
  },
});
