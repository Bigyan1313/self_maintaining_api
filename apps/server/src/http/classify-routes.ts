import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import {
  CHANGE_CATEGORY_LABELS,
  CLASSIFICATION_LABELS,
  MAPPING_SOURCE_LABELS,
  MAPPING_STATUS_LABELS,
  ChangesQuerySchema,
  ConfirmMappingRequestSchema,
  IdParamsSchema,
  MigrationMappingSchema,
  MigrationNoteRequestSchema,
  MAX_MIGRATION_NOTE_BYTES,
  mappingMatchesEvidence,
  parseMigrationNote,
} from '@sma/core';
import {
  confirmMapping,
  getApiById,
  insertMigrationNote,
  type Change,
  type Db,
} from '../infra/db/index.js';
import { changes } from '../infra/db/schema.js';
import { changeSpecs, loadVersionPair } from '../pipeline/classify.js';

/** Add explicit text labels to persisted outcomes using the shared wire contract. */
export function labeledChange(c: Change) {
  return {
    ...c,
    category: { value: c.category, label: CHANGE_CATEGORY_LABELS[c.category] },
    classification: { value: c.classification, label: CLASSIFICATION_LABELS[c.classification] },
    mappingStatus: { value: c.mappingStatus, label: MAPPING_STATUS_LABELS[c.mappingStatus] },
    mappingSource: c.mappingSource
      ? { value: c.mappingSource, label: MAPPING_SOURCE_LABELS[c.mappingSource] }
      : null,
  };
}
function version(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object' || !('info' in doc)) return undefined;
  const info = doc.info;
  return info && typeof info === 'object' && 'version' in info ? info.version : undefined;
}

/** Register migration-note upload, labeled changes, and explicit human confirmation. */
export async function registerClassifyRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
): Promise<void> {
  app.post(
    '/api/apis/:id/migration-notes',
    { bodyLimit: MAX_MIGRATION_NOTE_BYTES * 6 + 4096 },
    async (request, reply) => {
      const params = IdParamsSchema.safeParse(request.params);
      const body = MigrationNoteRequestSchema.safeParse(request.body);
      if (!params.success || !body.success)
        return reply
          .code(400)
          .send([{ field: 'request', message: 'Expected API UUID, version UUIDs, and rawYaml' }]);
      if (!(await getApiById(db, params.data.id)))
        return reply.code(404).send([{ field: 'id', message: 'API not found' }]);
      const parsed = parseMigrationNote(body.data.rawYaml);
      if (!parsed.ok) return reply.code(400).send(parsed.error);
      const pair = await loadVersionPair(
        db,
        params.data.id,
        body.data.fromVersionId,
        body.data.toVersionId,
      );
      if (!pair)
        return reply
          .code(400)
          .send([
            { field: 'fromVersionId', message: 'Expected distinct versions belonging to this API' },
          ]);
      if (
        parsed.value.from !== version(pair.before.normalized) ||
        parsed.value.to !== version(pair.after.normalized)
      )
        return reply.code(400).send([
          {
            field: 'rawYaml',
            message: 'Note versions must match the selected specification pair',
          },
        ]);
      return reply.code(201).send(
        await insertMigrationNote(db, {
          ...body.data,
          apiId: params.data.id,
          parsed: parsed.value,
        }),
      );
    },
  );
  app.get('/api/changes', async (request, reply) => {
    const query = ChangesQuerySchema.safeParse(request.query);
    if (!query.success)
      return reply.code(400).send([{ field: 'apiId', message: 'Expected API UUID' }]);
    if (!(await getApiById(db, query.data.apiId)))
      return reply.code(404).send([{ field: 'apiId', message: 'API not found' }]);
    const rows = await db
      .select()
      .from(changes)
      .where(eq(changes.apiId, query.data.apiId))
      .orderBy(asc(changes.createdAt), asc(changes.id));
    return rows.map(labeledChange);
  });
  app.post(
    '/api/changes/:id/confirm-mapping',
    { bodyLimit: MAX_MIGRATION_NOTE_BYTES },
    async (request, reply) => {
      const params = IdParamsSchema.safeParse(request.params);
      const body = ConfirmMappingRequestSchema.safeParse(request.body);
      if (!params.success || !body.success)
        return reply.code(400).send([
          {
            field: 'request',
            message: 'Expected change UUID, mapping, and nonempty confirmedBy',
          },
        ]);
      const mapping = MigrationMappingSchema.safeParse(body.data.mapping);
      if (!mapping.success)
        return reply.code(400).send(
          mapping.error.issues.map((i) => ({
            field: `mapping.${i.path.join('.')}`,
            message: 'Invalid mapping field',
          })),
        );
      const result = await db.transaction(async (tx) => {
        const [change] = await tx
          .select()
          .from(changes)
          .where(eq(changes.id, params.data.id))
          .for('update');
        if (!change) return { status: 404, body: [{ field: 'id', message: 'Change not found' }] };
        if (change.mappingStatus !== 'unconfirmed')
          return {
            status: 409,
            body: [{ field: 'mapping', message: 'Mapping is already confirmed' }],
          };
        const specs = await changeSpecs(tx, change);
        if (!specs || !mappingMatchesEvidence(mapping.data, change, specs.before, specs.after))
          return {
            status: 400,
            body: [
              {
                field: 'mapping',
                message: 'Mapping does not match the change and before/after evidence',
              },
            ],
          };
        const updated = await confirmMapping(tx, change.id, {
          mappingSource: 'human',
          mapping: mapping.data,
          confirmedBy: body.data.confirmedBy,
          confirmedAt: new Date(),
        });
        return { status: 200, body: labeledChange(updated) };
      });
      return reply.code(result.status).send(result.body);
    },
  );
}
