import { expect, it } from 'vitest';

it('env probe: prints the container environment', () => {
  console.log(`SMA_ENV_DUMP ${JSON.stringify(process.env)}`);
  expect(process.env.API_VERSION).toBe('probe');
});
