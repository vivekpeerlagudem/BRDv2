import { defineConfig } from 'vitest/config';

// One test run for the whole workspace; each app/package contributes its own project config.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
});
