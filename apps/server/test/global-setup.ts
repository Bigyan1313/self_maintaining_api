import { loadRootEnv } from '../src/infra/db/env.js';
import { resetTestDatabase, testDatabaseUrl } from '../src/infra/db/test-db.js';

/** Vitest global setup: fresh `sma_test` database (never the dev DB). */
export default async function setup(): Promise<void> {
  loadRootEnv();
  await resetTestDatabase(testDatabaseUrl());
}
