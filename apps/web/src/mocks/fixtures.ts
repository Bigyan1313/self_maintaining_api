import { ChangeSchema, RunDetailSchema, ResultsSchema } from '@sma/core/api/contract';
import { BASELINES, BASELINE_LABELS, CHANGE_CATEGORIES, GUARD_NAMES } from '@sma/core/domain/enums';
/** Stable fixture UUIDs, deliberately distinct from live records. */
export const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const fixtureDate = '2026-11-23T12:00:00.000Z';
/** Contract-validated unconfirmed change used only in explicit fixture mode/tests. */
export const fixtureChange = ChangeSchema.parse({
  id: fixtureId(3),
  apiId: fixtureId(2),
  fromVersionId: fixtureId(6),
  toVersionId: fixtureId(7),
  category: { value: 'field_renamed', label: 'Field renamed' },
  oasdiffRuleId: 'response-required-property-removed',
  classification: { value: 'breaking', label: 'Breaking' },
  confidence: 0.6,
  path: '/customers/{id}',
  method: 'GET',
  jsonPointer: '/paths/~1customers~1{id}/get',
  evidenceBefore: { customer_name: { type: 'string', example: 'Ada' } },
  evidenceAfter: { full_name: { type: 'string', example: 'Ada' } },
  mappingStatus: { value: 'unconfirmed', label: 'Mapping unconfirmed' },
  mappingSource: null,
  mapping: null,
  migrationNoteId: null,
  confirmedBy: null,
  confirmedAt: null,
  createdAt: fixtureDate,
});
/** Recorded successful fixture run includes every UI-03 evidence group. */
export const fixtureDetail = RunDetailSchema.parse({
  run: {
    id: fixtureId(4),
    changeId: fixtureId(3),
    repositoryId: fixtureId(1),
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    parentRunId: null,
    stageReached: { value: 'deliver', label: 'Deliver' },
    status: { value: 'repaired', label: 'Repaired (awaiting review)' },
    failureStage: null,
    failureDetail: null,
    flaggedReason: null,
    attemptCount: 1,
    tokensIn: 1200,
    tokensOut: 320,
    costUsd: '0.0144',
    modelId: 'fixture-adapter',
    isFixture: true,
    prUrl: 'https://github.com/example/consumer/pull/1',
    startedAt: fixtureDate,
    finishedAt: '2026-11-23T12:00:18.000Z',
  },
  change: {
    ...fixtureChange,
    mappingStatus: { value: 'confirmed', label: 'Mapping confirmed' },
    mappingSource: { value: 'human', label: 'Confirmed by a human' },
    mapping: {
      kind: 'field_renamed',
      method: 'GET',
      path: '/customers/{id}',
      location: 'response',
      old: 'customer_name',
      new: 'full_name',
    },
    confirmedBy: 'Fixture reviewer',
    confirmedAt: fixtureDate,
  },
  migrationNote: null,
  stageResults: [
    {
      id: fixtureId(10),
      runId: fixtureId(4),
      stage: { value: 'locate', label: 'Locate' },
      status: { value: 'ok', label: 'OK' },
      result: { outcome: 'affected', supportedCallSites: 1 },
      startedAt: fixtureDate,
      finishedAt: fixtureDate,
    },
  ],
  callSites: [
    {
      id: fixtureId(11),
      runId: fixtureId(4),
      filePath: 'src/customer.ts',
      line: 12,
      column: 3,
      pattern: { value: 'fetch', label: 'fetch' },
      excerpt: 'const response = await fetch(`/customers/${id}`);\nreturn customer.customer_name;',
    },
  ],
  coverage: [
    {
      id: fixtureId(12),
      runId: fixtureId(4),
      filePath: 'src/customer.ts',
      inspected: true,
      skipReason: null,
    },
    {
      id: fixtureId(13),
      runId: fixtureId(4),
      filePath: 'vendor/client.ts',
      inspected: false,
      skipReason: 'Excluded dependency directory',
    },
  ],
  attempts: [
    {
      id: fixtureId(14),
      runId: fixtureId(4),
      attemptNumber: 1,
      patch:
        '--- a/src/customer.ts\n+++ b/src/customer.ts\n@@ -13 +13 @@\n-return customer.customer_name;\n+return customer.full_name;',
      validationOutput:
        'Typecheck passed.\nTests: 12 passed / 12 total.\nNetwork disabled; non-root container.',
      compileErrors: 0,
      testsPassed: 12,
      testsTotal: 12,
      outcome: { value: 'pass', label: 'Passed validation' },
      guardName: null,
      tokensIn: 1200,
      tokensOut: 320,
      costUsd: '0.0144',
      modelId: 'fixture-adapter',
      durationMs: 18000,
      createdAt: fixtureDate,
    },
  ],
});
/** Illustrative evaluation numbers, explicitly marked partial fixture data; not experimental results. */
export const fixtureResults = ResultsSchema.parse({
  label: 'Fixture demonstration — not study results',
  failures: [
    {
      scenarioId: 'rename-shop-flat',
      baseline: 'B1',
      reason: 'Original consumer failed after the API change.',
    },
  ],
  results: BASELINES.map((baseline, i) => ({
    id: fixtureId(30 + i),
    evalLabel: 'fixture',
    scenarioId: 'rename-shop-flat',
    baseline: { value: baseline, label: BASELINE_LABELS[baseline] },
    outcome:
      i === 2
        ? { value: 'repaired', label: 'Repaired (awaiting review)' }
        : { value: 'failed', label: 'Repair failed' },
    attemptsUsed: i,
    costUsd: String(i * 0.01),
    durationMs: i * 12000,
    modelMs: i * 2000,
    containerMs: i * 10000,
    reviewVerdict: { value: 'not_reviewed', label: 'Not reviewed' },
    excluded: i === 1,
    exclusionReason: i === 1 ? 'Example: interrupted model request' : null,
    isPartial: true,
    createdAt: fixtureDate,
  })),
  summaries: BASELINES.map((baseline, i) => ({
    baseline,
    detectionPrecision: 1,
    detectionRecall: 1,
    repairRate: i / 2,
    repairCounts: { repaired: i * 2, eligible: 4 },
    repairRateByCategory: CHANGE_CATEGORIES.filter((c) => c !== 'other').map((category) => ({
      category,
      rate: i / 2,
      repaired: i,
      eligible: 2,
    })),
    refusalCorrectness: i === 0 ? null : i === 2 ? 1 : 0,
    refusalCounts: i === 0 ? null : { correct: i === 2 ? 1 : 0, total: 1 },
    wrongActions: i === 1 ? 1 : 0,
    attemptsDistribution: [{ attempts: i, count: 5 }],
    cheatRejections: GUARD_NAMES.map((guard) => ({
      guard,
      count: guard === 'test_file_changed' && i === 2 ? 1 : 0,
    })),
    cheatRejectionsByCategory: GUARD_NAMES.map((guard) => ({
      category: 'field_renamed' as const,
      guard,
      count: guard === 'test_file_changed' && i === 2 ? 1 : 0,
    })),
    falseConfidence: null,
    costPerRepairUsd: i === 0 ? null : 0.0144,
    timePerRepairMs: i === 0 ? null : 18000,
    modelTimePerRepairMs: i === 0 ? null : 3000,
    containerTimePerRepairMs: i === 0 ? null : 15000,
  })),
});
