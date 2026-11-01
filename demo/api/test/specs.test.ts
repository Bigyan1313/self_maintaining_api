import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';
import { loadSpec } from './spec-helpers.js';

describe.each(['v1', 'v2'] as const)('specs/%s.yaml', (version) => {
  const spec = loadSpec(version);

  it('is a valid OpenAPI 3.1 document', async () => {
    const validator = new Validator();
    const result = await validator.validate(
      spec as unknown as Parameters<Validator['validate']>[0],
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(spec.openapi).toMatch(/^3\.1\./);
  });

  it('gives every operation a unique operationId', () => {
    const ids = Object.values(spec.paths).flatMap((item) =>
      Object.values(item).map((op) => op.operationId),
    );
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
