import { defineConfig } from 'vitest/config';

// Unit tests for the repository tooling in scripts/ (diagram checks, acceptance helpers).
export default defineConfig({
  test: { environment: 'node', include: ['**/*.test.ts'] },
});
