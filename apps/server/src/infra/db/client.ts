import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

/** Typed Drizzle database handle used by every repository module. */
export type Db = NodePgDatabase<typeof schema>;

/** A database handle together with the pool that backs it. */
export interface DbClient {
  db: Db;
  pool: pg.Pool;
  /** Closes every pooled connection. */
  close(): Promise<void>;
}

/**
 * Creates a pooled PostgreSQL client. The connection string is never logged (NFR-04).
 *
 * @param connectionString - Postgres URL; defaults to `process.env.DATABASE_URL`.
 * @throws Error when no connection string is available.
 */
export function createDbClient(connectionString = process.env.DATABASE_URL): DbClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
