import { defineConfig } from 'vitest/config';
/** Offline adapter tests can run without the database or Docker global setup. */
export default defineConfig({ test: { environment: 'node', include: ['test/llm*.test.ts'] } });
