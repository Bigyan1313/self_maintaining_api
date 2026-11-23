import { expect, it } from 'vitest';
import { readValue } from '../src/consumer.js';
it('preserves the caller-visible value', async () => {
  expect(await readValue()).toEqual("2023-11-14T22:13:20.000Z");
});
it('unrelated health operation remains available', async () => {
  const response = await fetch('https://api.example.test/health');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
