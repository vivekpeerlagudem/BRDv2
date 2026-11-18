import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'server', include: ['src/**/*.test.ts'], environment: 'node', fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
});
