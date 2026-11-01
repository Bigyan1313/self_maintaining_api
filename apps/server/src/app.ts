/**
 * HTTP application factory for the Self-Maintaining APIs server.
 *
 * @packageDocumentation
 */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

/** Body returned by `GET /health`. */
export interface HealthResponse {
  status: 'ok';
}

/**
 * Builds the Fastify application without opening a port, so tests can call
 * `app.inject()` directly.
 *
 * @param opts - Fastify server options (for example `{ logger: true }`).
 * @returns A configured, not-yet-listening Fastify instance.
 */
export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(opts);

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  return app;
}
