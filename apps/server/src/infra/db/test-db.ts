import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** Name of the dedicated test database. Tests never touch the dev database. */
export const TEST_DATABASE_NAME = 'sma_test';

/** Folder with the drizzle-kit SQL migrations. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

const SAFE_TEST_DB_NAME = /^[a-z0-9_]+_test$/;

/**
 * Connection URL for the test database.
 *
 * Uses `TEST_DATABASE_URL` when set; otherwise `DATABASE_URL` with the database name replaced by
 * `sma_test`. Refuses any database whose name does not end in `_test`, so a misconfiguration can
 * never reset the dev database.
 *
 * @param env - Environment to read (defaults to `process.env`).
 * @throws Error when no URL is configured or the target is not a `_test` database.
 */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.TEST_DATABASE_URL ?? env.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) to run database tests');
  const url = new URL(base);
  if (!env.TEST_DATABASE_URL) url.pathname = `/${TEST_DATABASE_NAME}`;
  assertTestDatabase(url);
  return url.toString();
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function assertTestDatabase(url: URL): void {
  const name = databaseName(url);
  if (!SAFE_TEST_DB_NAME.test(name)) {
    throw new Error(
      `Refusing to use database "${name}" for tests: name must match ${SAFE_TEST_DB_NAME}`,
    );
  }
}

/**
 * Drops and recreates the test database, then applies every migration, so each test suite starts
 * from a fresh schema. Creates the database when it does not exist yet.
 *
 * @param url - Test database URL (see {@link testDatabaseUrl}).
 */
export async function resetTestDatabase(url: string): Promise<void> {
  const target = new URL(url);
  assertTestDatabase(target);
  const name = databaseName(target);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const adminClient = new pg.Client({ connectionString: admin.toString() });
  await adminClient.connect();
  try {
    // `name` is validated against SAFE_TEST_DB_NAME above, so quoting it is safe.
    await adminClient.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE "${name}"`);
  } finally {
    await adminClient.end();
  }

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
