import { expect, it } from 'vitest';

// Must FAIL inside the validate container (--network none).
it('network probe: fetch https://example.com', async () => {
  const res = await fetch('https://example.com', { signal: AbortSignal.timeout(10_000) });
  expect(res.status).toBeGreaterThan(0);
});

// Must FAIL too: no route even without DNS.
it('network probe: fetch by IP http://1.1.1.1', async () => {
  const res = await fetch('http://1.1.1.1', { signal: AbortSignal.timeout(10_000) });
  expect(res.status).toBeGreaterThan(0);
});
