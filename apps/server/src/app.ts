import { registerResultsRoutes } from './http/results-routes.js';
import { registerClassifyRoutes } from './http/classify-routes.js';
/**
 * HTTP application factory for the Self-Maintaining APIs server.
 *
 * @packageDocumentation
 */
import { registerIngestRoutes, type IngestDependencies } from './http/ingest-routes.js';
import { registerRunRoutes, type RunRouteDependencies } from './http/run-routes.js';
import type { Orchestrator } from './pipeline/orchestrator.js';

/** Services for the whole API. Without `orchestrator`, only Increment 04/06 routes exist. */
export type AppDependencies = IngestDependencies & {
  orchestrator?: Orchestrator;
  exportDir?: RunRouteDependencies['exportDir'];
  env?: RunRouteDependencies['env'];
};
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';

/** Body returned by `GET /health`. */
export interface HealthResponse {
  status: 'ok';
}

/**
 * Builds the Fastify application without opening a port, so tests can call
 * `app.inject()` directly.
 *
 * @param opts - Fastify server options (for example `{ logger: true }`).
 * @param deps - Optional services; omitted for health-only tests. With an `orchestrator`,
 *   spec checks run the full spec-check flow and the run endpoints are registered.
 * @returns A configured, not-yet-listening Fastify instance.
 */
export function buildApp(opts: FastifyServerOptions = {}, deps?: AppDependencies): FastifyInstance {
  const app = Fastify({
    ...opts,
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send([{ field: 'route', message: 'Route not found' }]),
  );
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    return reply
      .code(status && status >= 400 && status < 500 ? status : 500)
      .send([{ field: 'request', message: 'Request could not be processed' }]);
  });

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  if (deps) {
    const { orchestrator } = deps;
    void app.register(registerResultsRoutes, { db: deps.db });
    void app.register(registerIngestRoutes, {
      ...deps,
      ...(orchestrator && !deps.checkSpec
        ? { checkSpec: (id: string, source) => orchestrator.checkSpec(id, source) }
        : {}),
    } satisfies IngestDependencies);
    void app.register(registerClassifyRoutes, { db: deps.db });
    if (orchestrator)
      void app.register(registerRunRoutes, {
        db: deps.db,
        orchestrator,
        ...(deps.exportDir ? { exportDir: deps.exportDir } : {}),
        ...(deps.env ? { env: deps.env } : {}),
      });
  }
  return app;
}
