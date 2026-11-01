import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, ok, version, type Result } from './index.js';

describe('@sma/core smoke', () => {
  it('exports a semver version string', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('builds and narrows Ok results', () => {
    const r: Result<number, string> = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it('builds and narrows Err results', () => {
    const r: Result<number, string> = err('boom');
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    if (isErr(r)) expect(r.error).toBe('boom');
  });
});
