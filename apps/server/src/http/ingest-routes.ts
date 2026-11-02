import type { FastifyInstance } from 'fastify';
import { asc } from 'drizzle-orm';
import {
  CheckRequestSchema,
  IdParamsSchema,
  MAX_SPEC_BYTES,
  SPEC_CHECK_OUTCOME_LABELS,
  type FieldErrors,
} from '@sma/core';
import {
  type Db,
  insertApi,
  insertRepository,
  getApiById,
  listSpecChecks,
} from '../infra/db/index.js';
import { apis, repositories } from '../infra/db/schema.js';
import { ingest, ApiNotFoundError } from '../pipeline/ingest.js';
import {
  validateApi,
  validateRepository,
  type RepositoryProbe,
} from '../pipeline/config-validate.js';
import { CheckQueue, SpecPoller } from '../pipeline/poller.js';
import { type SpecRetriever } from '../infra/spec-source/retrieve.js';

/** Explicit service dependencies; tests inject a dedicated database and network adapters. */
export interface IngestDependencies {
  db: Db;
  retrieve?: SpecRetriever;
  probeRepository?: RepositoryProbe;
  polling?: boolean;
}

/** Register only Increment 04 HTTP endpoints. Later contract endpoints remain unimplemented. */
export async function registerIngestRoutes(
  app: FastifyInstance,
  deps: IngestDependencies,
): Promise<void> {
  const { db } = deps;
  const queue = new CheckQueue();
  const check = (id: string) => ingest(db, id, { mode: 'retrieved' }, deps.retrieve);
  const poller = new SpecPoller(queue, () => db.select().from(apis), check);
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling: Promise<void> = Promise.resolve();
  let pollInFlight = false;
  app.addHook('onReady', async () => {
    if (deps.polling === false) return;
    await poller.tick();
    timer = setInterval(() => {
      if (pollInFlight) return;
      pollInFlight = true;
      polling = poller
        .tick()
        .catch(() => {
          app.log.error('Specification polling failed; check database availability');
        })
        .finally(() => {
          pollInFlight = false;
        });
    }, 1000);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await polling;
    await queue.drain();
  });
  app.setErrorHandler(async (error, request, reply) => {
    const code = (error as { code?: string }).code;
    const idMatch = /^\/api\/apis\/([^/?]+)\/specs(?:\?|$)/.exec(request.url);
    const params = IdParamsSchema.safeParse({ id: idMatch?.[1] });
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE' && params.success) {
      try {
        const result = await queue.run(() =>
          ingest(db, params.data.id, {
            mode: 'failed',
            error: { code: 'too_large', message: 'Specification exceeds 5 MiB' },
          }),
        );
        return reply.code(413).send(result);
      } catch {
        return reply
          .code(400)
          .send([{ field: 'id', message: 'Cannot record failed upload for this API' }]);
      }
    }
    if (error instanceof ApiNotFoundError)
      return reply.code(404).send([{ field: 'id', message: 'API not found' }]);
    let cause: unknown = error;
    for (let i = 0; i < 4 && cause && typeof cause === 'object'; i++) {
      if ('code' in cause && cause.code === '23505')
        return reply
          .code(409)
          .send([{ field: 'configuration', message: 'Repository or API already registered' }]);
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply
        .code(status)
        .send([{ field: 'body', message: 'Invalid or oversized request body' }]);
    app.log.error('Ingest request failed; no success reported');
    return reply
      .code(500)
      .send([{ field: 'ingest', message: 'Ingest storage or service unavailable; retry later' }]);
  });
  app.get('/api/repositories', () =>
    db.select().from(repositories).orderBy(asc(repositories.createdAt), asc(repositories.id)),
  );
  app.post('/api/repositories', async (request, reply) => {
    const validation = await validateRepository(request.body, deps.probeRepository);
    if (!validation.ok) return reply.code(400).send(validation.error);
    return reply.code(201).send(await insertRepository(db, validation.value));
  });
  app.get('/api/apis', () => db.select().from(apis).orderBy(asc(apis.createdAt), asc(apis.id)));
  app.post('/api/apis', { bodyLimit: MAX_SPEC_BYTES * 2 + 4096 }, async (request, reply) => {
    const validation = await validateApi(request.body);
    if (!validation.ok) return reply.code(400).send(validation.error);
    const { name, specSourceUrl, pollIntervalSeconds, specText, filename } = validation.value;
    const api = await queue.run(() =>
      db.transaction(async (tx) => {
        const created = await insertApi(tx, { name, specSourceUrl, pollIntervalSeconds });
        if (specText !== undefined) {
          const result = await ingest(tx, created.id, {
            mode: 'uploaded',
            text: specText,
            filename,
          });
          if (result.check.outcome.value === 'failed')
            throw new Error('Previously validated upload failed');
        }
        return await getApiById(tx, created.id);
      }),
    );
    return reply.code(201).send(api);
  });
  app.get<{ Params: { id: string } }>('/api/apis/:id/checks', async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send([{ field: 'id', message: 'Expected API UUID' }]);
    if (!(await getApiById(db, params.data.id))) throw new ApiNotFoundError();
    const checks = await listSpecChecks(db, params.data.id);
    return checks.map((c) => ({
      ...c,
      outcome: { value: c.outcome, label: SPEC_CHECK_OUTCOME_LABELS[c.outcome] },
    }));
  });
  app.post<{ Params: { id: string } }>('/api/apis/:id/check', async (request, reply) => {
    const errors: FieldErrors = [];
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) errors.push({ field: 'id', message: 'Expected API UUID' });
    if (!CheckRequestSchema.safeParse(request.body ?? {}).success)
      errors.push({ field: 'body', message: 'Expected empty check request' });
    if (!params.success || errors.length) return reply.code(400).send(errors);
    const result = await queue.run(() => check(params.data.id));
    return reply.code(result.check.outcome.value === 'failed' ? 422 : 200).send(result);
  });
  // Isolate the raw-body parser: configuration POSTs retain normal JSON parsing.
  await app.register(async (upload) => {
    upload.removeContentTypeParser('application/json');
    upload.removeContentTypeParser('text/plain');
    upload.addContentTypeParser(
      [
        'application/json',
        'application/yaml',
        'application/x-yaml',
        'text/yaml',
        'text/plain',
        'application/octet-stream',
      ],
      { parseAs: 'string', bodyLimit: MAX_SPEC_BYTES },
      (_request, body, done) => done(null, body),
    );
    upload.post<{ Params: { id: string } }>(
      '/api/apis/:id/specs',
      { bodyLimit: MAX_SPEC_BYTES },
      async (request, reply) => {
        const params = IdParamsSchema.safeParse(request.params);
        if (!params.success)
          return reply.code(400).send([{ field: 'id', message: 'Expected API UUID' }]);
        if (typeof request.body !== 'string')
          return reply
            .code(400)
            .send([{ field: 'body', message: 'Upload a raw JSON or YAML document' }]);
        const result = await queue.run(() =>
          ingest(db, params.data.id, { mode: 'uploaded', text: request.body as string }),
        );
        return reply.code(result.check.outcome.value === 'failed' ? 422 : 200).send(result);
      },
    );
  });
}
