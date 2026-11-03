import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('fs probe: cannot write /etc/hosts', () => {
  expect(() => writeFileSync('/etc/hosts', '127.0.0.1 sma-probe\n', { flag: 'a' })).toThrow();
});

it('fs probe: cannot write outside /work and /tmp', () => {
  expect(() => writeFileSync('/sma-probe.txt', 'x')).toThrow();
  expect(() => mkdirSync('/usr/local/sma-probe')).toThrow();
  expect(() => writeFileSync('/work/../sma-probe.txt', 'x')).toThrow();
});

it('fs probe: can write inside /work', () => {
  writeFileSync('/work/probe-wrote-this.txt', 'ok\n');
});
