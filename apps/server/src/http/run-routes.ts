/**
 * Run endpoints (`@implementedIn inc13` in the API contract): start, list, detail, reanalyze,
 * retry delivery, and export (FR-38 to FR-41, DR-05).
 *
 * Starting a run returns `202 Accepted` with the `running` run as soon as its row exists; the
 * stages continue in the background and the client polls `GET /api/runs/:id`. A second start
 * while a run is in flight gets `409` (one run at a time, SRS 2.3).
 * @packageDocumentation
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { desc } from 'drizzle-orm';
import {
  ExportQuerySchema,
  IdParamsSchema,
  RunActionRequestSchema,
  StartRunRequestSchema,
} from '@sma/core';
import type { Db } from '../infra/db/index.js';
import { runs } from '../infra/db/schema.js';
import { basename } from 'node:path';
import {
  DEFAULT_EXPORT_DIR,
  ExportWriteError,
  exportRunJson,
  renderRunHtml,
  writeRunExport,
} from '../pipeline/export.js';
import {
  RunBusyError,
  RunInputError,
  type Orchestrator,
  type RunHandle,
} from '../pipeline/orchestrator.js';
import { knownSecrets, loadRunDetail, serializeRun } from '../pipeline/run-detail.js';

/** Services the run routes need. */
export interface RunRouteDependencies {
  db: Db;
  orchestrator: Orchestrator;
  /** Folder for saved exports. Default {@link DEFAULT_EXPORT_DIR}. */
  exportDir?: string;
  /** Called when a background run could not even record its failure (database down). */
  onBackgroundError?: (error: unknown) => void;
  /** Environment used to find secrets to scrub. Default `process.env`. */
  env?: Record<string, string | undefined>;
}

const HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'";

/** Registers the run endpoints. */
export async function registerRunRoutes(
  app: FastifyInstance,
  deps: RunRouteDependencies,
): Promise<void> {
  const { db, orchestrator } = deps;
  const secrets = () => knownSecrets(deps.env ?? process.env);

  function refused(reply: FastifyReply, error: unknown) {
    if (error instanceof RunBusyError)
      return reply.code(409).send([{ field: 'run', message: error.message }]);
    if (error instanceof RunInputError)
      return reply.code(error.statusCode).send([{ field: error.field, message: error.message }]);
    throw error;
  }
  function background(handle: RunHandle) {
    handle.done.catch((e: unknown) => {
      if (deps.onBackgroundError) deps.onBackgroundError(e);
      else app.log.error('A run could not record its result; check database availability');
    });
  }
  const badId = (reply: FastifyReply) =>
    reply.code(400).send([{ field: 'id', message: 'Expected run UUID' }]);
  const notFound = (reply: FastifyReply) =>
    reply.code(404).send([{ field: 'id', message: 'Run not found' }]);

  app.post('/api/runs', async (request, reply) => {
    const body = StartRunRequestSchema.safeParse(request.body ?? {});
    if (!body.success)
      return reply.code(400).send([
        {
          field: 'body',
          message: 'Expected changeId and repositoryId UUIDs and an optional mode',
        },
      ]);
    try {
      const handle = await orchestrator.startRun(body.data);
      background(handle);
      return reply.code(202).send(serializeRun(handle.run));
    } catch (e) {
      return refused(reply, e);
    }
  });

  app.get('/api/runs', async () =>
    (await db.select().from(runs).orderBy(desc(runs.startedAt), desc(runs.id))).map(serializeRun),
  );

  app.get('/api/runs/:id', async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) return badId(reply);
    const detail = await loadRunDetail(db, params.data.id, secrets());
    return detail ?? notFound(reply);
  });

  app.post('/api/runs/:id/reanalyze', async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) return badId(reply);
    if (!RunActionRequestSchema.safeParse(request.body ?? {}).success)
      return reply.code(400).send([{ field: 'body', message: 'Expected an empty request' }]);
    try {
      const handle = await orchestrator.reanalyze(params.data.id);
      background(handle);
      return reply.code(202).send(serializeRun(handle.run));
    } catch (e) {
      return refused(reply, e);
    }
  });

  app.post('/api/runs/:id/retry-delivery', async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) return badId(reply);
    if (!RunActionRequestSchema.safeParse(request.body ?? {}).success)
      return reply.code(400).send([{ field: 'body', message: 'Expected an empty request' }]);
    try {
      return serializeRun(await orchestrator.retryDelivery(params.data.id));
    } catch (e) {
      return refused(reply, e);
    }
  });

  app.get('/api/runs/:id/export', async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    const query = ExportQuerySchema.safeParse(request.query);
    if (!params.success) return badId(reply);
    if (!query.success)
      return reply.code(400).send([{ field: 'format', message: 'Expected format=json or html' }]);
    const detail = await loadRunDetail(db, params.data.id, secrets());
    if (!detail) return notFound(reply);
    if (query.data.format === 'json')
      return reply.type('application/json; charset=utf-8').send(exportRunJson(detail));
    return reply
      .type('text/html; charset=utf-8')
      .header('content-security-policy', HTML_CSP)
      .send(renderRunHtml(detail));
  });

  app.post('/api/runs/:id/export', async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) return badId(reply);
    if (!RunActionRequestSchema.safeParse(request.body ?? {}).success)
      return reply.code(400).send([{ field: 'body', message: 'Expected an empty request' }]);
    const detail = await loadRunDetail(db, params.data.id, secrets());
    if (!detail) return notFound(reply);
    try {
      const saved = await writeRunExport(detail, deps.exportDir ?? DEFAULT_EXPORT_DIR);
      // File names only: the host's folder layout is not part of the response.
      return reply
        .code(201)
        .send({ saved: true, json: basename(saved.json), html: basename(saved.html) });
    } catch (e) {
      if (e instanceof ExportWriteError)
        return reply.code(500).send([{ field: 'export', message: e.message }]);
      throw e;
    }
  });
}
