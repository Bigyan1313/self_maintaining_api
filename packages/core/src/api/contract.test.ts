import { expect, it } from 'vitest';
import {
  API_CONTRACT,
  RegisterApiSchema,
  RegisterRepositorySchema,
  SpecCheckSchema,
} from './contract.js';
it('declares every planned route without installing future capabilities', () => {
  expect(Object.values(API_CONTRACT).map((v) => v.path)).toEqual([
    '/api/repositories',
    '/api/apis',
    '/api/apis/:id/specs',
    '/api/apis/:id/check',
    '/api/apis/:id/checks',
    '/api/apis/:id/migration-notes',
    '/api/changes',
    '/api/changes/:id/confirm-mapping',
    '/api/runs',
    '/api/runs/:id',
    '/api/runs/:id/reanalyze',
    '/api/runs/:id/retry-delivery',
    '/api/runs/:id/export',
    '/api/results',
  ]);
});
it('requires credential names, complete configuration, and a minimum polling interval', () => {
  const repo = { owner: 'acme', name: 'app', defaultBranch: 'main', localPath: '/repo' };
  expect(
    RegisterRepositorySchema.safeParse({ ...repo, credentialRef: 'GITHUB_TOKEN' }).success,
  ).toBe(true);
  expect(
    RegisterRepositorySchema.safeParse({ ...repo, credentialRef: 'ghp_FAKE123' }).success,
  ).toBe(false);
  expect(RegisterApiSchema.safeParse({ name: 'shop' }).success).toBe(false);
  expect(
    RegisterApiSchema.safeParse({
      name: 'shop',
      specSourceUrl: 'https://example.com',
      pollIntervalSeconds: 59,
    }).success,
  ).toBe(false);
  expect(
    RegisterApiSchema.safeParse({
      name: 'shop',
      specSourceUrl: 'https://example.com',
      pollIntervalSeconds: 60,
    }).success,
  ).toBe(true);
});
it('requires an accurate text label for a check outcome', () => {
  const check = {
    id: 'f930e8e3-b188-4a05-8981-f2c0a53afe6c',
    apiId: 'f930e8e3-b188-4a05-8981-f2c0a53afe6c',
    startedAt: '2026-11-02T00:00:00Z',
    finishedAt: null,
    specVersionId: null,
    errorDetail: 'timeout',
    outcome: { value: 'failed', label: 'No change' },
  };
  expect(SpecCheckSchema.safeParse(check).success).toBe(false);
});
