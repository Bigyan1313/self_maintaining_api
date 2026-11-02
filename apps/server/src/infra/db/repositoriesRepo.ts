import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { one } from './rows.js';
import { repositories } from './schema.js';
import type { NewRepository, Repository } from './types.js';

/**
 * Inserts a repository. `credentialRef` must be an env var NAME (the DB rejects anything else).
 * @param db - Database handle.
 * @param values - Repository values.
 */
export async function insertRepository(db: Db, values: NewRepository): Promise<Repository> {
  return one(await db.insert(repositories).values(values).returning(), 'repository');
}

/**
 * Finds a repository by id.
 * @param db - Database handle.
 * @param id - Repository id.
 */
export async function getRepositoryById(db: Db, id: string): Promise<Repository | undefined> {
  return (await db.select().from(repositories).where(eq(repositories.id, id)))[0];
}

/**
 * Finds a repository by owner and name.
 * @param db - Database handle.
 * @param owner - Repository owner.
 * @param name - Repository name.
 */
export async function findRepository(
  db: Db,
  owner: string,
  name: string,
): Promise<Repository | undefined> {
  return (
    await db
      .select()
      .from(repositories)
      .where(and(eq(repositories.owner, owner), eq(repositories.name, name)))
  )[0];
}
