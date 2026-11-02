// CLI: npm run db:reset:test — drop, recreate and migrate the `sma_test` database.
import { loadRootEnv } from './env.js';
import { resetTestDatabase, testDatabaseUrl } from './test-db.js';

loadRootEnv();
await resetTestDatabase(testDatabaseUrl());
console.log('Test database reset and migrated.');
