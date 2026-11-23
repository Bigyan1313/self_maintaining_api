import { randomUUID } from 'node:crypto';
import type { EvaluationStudy, EvaluationTrial } from '@sma/core';
/** Minimal valid study for failure-path tests; no model, DB or container. */
export function sampleStudy(): EvaluationStudy {
  return {
    schemaVersion: 1,
    label: 'test',
    startedAt: '2026-11-23T00:00:00.000Z',
    updatedAt: '2026-11-23T00:00:00.000Z',
    status: 'partial',
    stopReason: null,
    fake: true,
    config: { baselines: ['B1', 'B2', 'B3'], scenarioIds: ['x'], repeat: 1, maxCost: 5 },
    environment: {
      gitCommit: 'sha',
      modelId: 'fake',
      image: 'digest',
      oasdiff: '1.35.0',
      node: '22',
      platform: 'linux',
      arch: 'x64',
      cpuCores: 2,
      ramBytes: 1024,
      pricing: { input: 2, output: 10 },
      maxOutputTokens: 4096,
    },
    manifest: [{ id: 'x', sha256: 'a'.repeat(64), repoCommit: 'b'.repeat(40) }],
    admissions: [],
    trials: [],
    inFlight: null,
    spentUsd: 0,
    reservedUsd: 0,
  };
}
/** One completed failure is genuine evidence, not an outage. */
export function sampleTrial(overrides: Partial<EvaluationTrial> = {}): EvaluationTrial {
  return {
    id: randomUUID(),
    scenarioId: 'x',
    baseline: 'B1',
    repeat: 1,
    category: 'field_renamed',
    expected: 'repair',
    outcome: 'failed',
    reason: 'Tests failed',
    attemptsUsed: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    durationMs: 0,
    modelMs: 0,
    containerMs: 0,
    guard: null,
    patch: '',
    migrationNote: '',
    runId: null,
    detection: null,
    detected: [],
    labels: [],
    review: null,
    completed: true,
    createdAt: '2026-11-23T00:00:00.000Z',
    ...overrides,
  };
}
