/**
 * HTTP application factory for the Self-Maintaining APIs server.
 *
 * @packageDocumentation
 */
import { registerIngestRoutes, type IngestDependencies } from './http/ingest-routes.js';
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
 * @param deps - Optional Ingest services; omitted for health-only tests.
 * @returns A configured, not-yet-listening Fastify instance.
 */
export function buildApp(
  opts: FastifyServerOptions = {},
  deps?: IngestDependencies,
): FastifyInstance {
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

  if (deps) void app.register(registerIngestRoutes, deps);
  return app;
}
