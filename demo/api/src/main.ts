import { buildDemoApp } from './app.js';
import type { DemoVersion } from './data.js';

const arg = process.argv[2];
if (arg !== 'v1' && arg !== 'v2') {
  console.error('Usage: tsx src/main.ts <v1|v2>');
  process.exit(1);
}
const version: DemoVersion = arg;
const port = Number(process.env.PORT ?? (version === 'v1' ? 4001 : 4002));
const host = process.env.HOST ?? '127.0.0.1';

buildDemoApp(version)
  .listen({ port, host })
  .then((address) => console.log(`Demo Shop ${version} listening on ${address}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
