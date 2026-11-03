import { expect, it } from 'vitest';

it('user probe: not running as root', () => {
  console.log(`SMA_UID=${process.getuid?.()} SMA_GID=${process.getgid?.()}`);
  expect(process.getuid?.()).not.toBe(0);
});
