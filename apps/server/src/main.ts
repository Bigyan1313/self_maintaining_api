import { buildApp } from './app.js';
import { createDbClient } from './infra/db/client.js';
import { loadRootEnv } from './infra/db/env.js';
import { AnthropicLlmAdapter } from './infra/llm/adapter.js';
import { DEFAULT_TOKEN_CEILING, Orchestrator } from './pipeline/orchestrator.js';

loadRootEnv();
const client = createDbClient();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const ceiling = Number(process.env.RUN_TOKEN_CEILING ?? DEFAULT_TOKEN_CEILING);
const apiVersion = process.env.SMA_VALIDATOR_API_VERSION?.trim();
const orchestrator = new Orchestrator(
  { db: client.db, llm: new AnthropicLlmAdapter() },
  {
    tokenCeiling: Number.isSafeInteger(ceiling) && ceiling > 0 ? ceiling : DEFAULT_TOKEN_CEILING,
    ...(apiVersion ? { sandboxEnv: { API_VERSION: apiVersion } } : {}),
  },
);
const app = buildApp({ logger: true }, { db: client.db, orchestrator });
app.addHook('onReady', async () => {
  const recovered = await orchestrator.recoverInterruptedRuns();
  if (recovered.length)
    app.log.warn(`${recovered.length} interrupted run(s) recorded as stage failures`);
});
app.addHook('onClose', async () => {
  await orchestrator.idle();
  await client.close();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
app.listen({ port, host }).catch(async () => {
  app.log.error('Server startup failed; verify configuration and database availability');
  await app.close();
  process.exitCode = 1;
});
