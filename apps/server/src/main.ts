import { buildApp } from './app.js';
import { createDbClient } from './infra/db/client.js';
import { loadRootEnv } from './infra/db/env.js';

loadRootEnv();
const client = createDbClient();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const app = buildApp({ logger: true }, { db: client.db });
app.addHook('onClose', () => client.close());
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
app.listen({ port, host }).catch(async () => {
  app.log.error('Server startup failed; verify configuration and database availability');
  await app.close();
  process.exitCode = 1;
});
