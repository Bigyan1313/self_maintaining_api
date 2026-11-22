import { describe, expect, it } from 'vitest';
import {
  DELIVERY_BRANCH_PREFIX,
  DELIVERY_LABELS,
  deliveryBranchName,
  unsafeBranchReason,
} from './branch.js';
import {
  MAX_PR_BODY_CHARS,
  NEVER_MERGE_NOTE,
  buildPrBody,
  buildPrTitle,
  type DeliveryEvidence,
} from './pr-body.js';
import { REDACTED, redactForDelivery } from './redact.js';

const evidence = (over: Partial<DeliveryEvidence> = {}): DeliveryEvidence => ({
  runId: '11111111-2222-3333-4444-555555555555',
  isFixture: false,
  change: {
    category: 'field_renamed',
    method: 'get',
    path: '/customers/{id}',
    jsonPointer: '/paths/~1customers~1{id}/get/responses/200',
    before: { customer_name: { type: 'string' } },
    after: { full_name: { type: 'string' } },
  },
  confirmation: {
    source: 'migration_note',
    noteRef: 'demo/api/migration-notes/v1-to-v2.yaml',
    entry: { kind: 'field_renamed', old: 'customer_name', new: 'full_name' },
  },
  callSites: [{ filePath: 'src/customers.ts', line: 12, column: 21, pattern: 'fetch' }],
  affectedFiles: ['src/customers.ts'],
  attempts: 2,
  tests: { passed: 12, total: 12, rawOutput: 'Test Files 3 passed (3)\nTests 12 passed (12)' },
  ...over,
});

describe('redactForDelivery', () => {
  it('removes exact known secrets and token shapes', () => {
    const out = redactForDelivery(
      'token=SuperSecretValue ghp_FAKE123 github_pat_ABC_def123 sk-ant-xyz AKIAEXAMPLE',
      ['SuperSecretValue'],
    );
    expect(out).not.toMatch(/SuperSecretValue|ghp_FAKE123|github_pat_|sk-ant-|AKIA/);
    expect(out.split(REDACTED).length - 1).toBe(5);
  });

  it('removes authorization headers and URL credentials', () => {
    const out = redactForDelivery(
      'authorization: token abc123def\nAuthorization: Bearer xyz.789\nhttps://x-access-token:s3cr3t@github.com/a/b.git',
    );
    expect(out).not.toMatch(/abc123def|xyz\.789|s3cr3t|x-access-token/);
    expect(out).toContain('https://[REDACTED]@github.com/a/b.git');
  });

  it('ignores empty or tiny known values instead of blanking the text', () => {
    expect(redactForDelivery('abc', ['', 'a'])).toBe('abc');
  });
});

describe('branch names', () => {
  it('builds sma/run-<id>-<category>', () => {
    expect(deliveryBranchName('r1', 'field_type_changed')).toBe('sma/run-r1-field_type_changed');
    expect(deliveryBranchName('r1', 'endpoint_removed').startsWith(DELIVERY_BRANCH_PREFIX)).toBe(
      true,
    );
  });

  it('accepts a normal sma/ branch', () => {
    expect(unsafeBranchReason('sma/run-abc-field_renamed', ['main'])).toBeNull();
    expect(unsafeBranchReason('refs/heads/sma/run-abc', ['main'])).toBeNull();
  });

  it.each([
    ['main', 'default branch'],
    ['refs/heads/main', 'default branch'],
    ['feature/x', 'must start with'],
    ['sma/../main', 'valid git ref'],
    ['sma//x', 'valid git ref'],
    ['sma/x.lock', 'valid git ref'],
    ['sma/-x', 'valid git ref'],
    ['sma/x y', 'unsupported characters'],
    ['sma/x~1', 'unsupported characters'],
  ])('rejects %s', (name, reason) => {
    expect(unsafeBranchReason(name, ['main'])).toContain(reason);
  });

  it('rejects a protected branch even when it starts with sma/', () => {
    expect(unsafeBranchReason('sma/trunk', ['sma/trunk'])).toContain('default branch');
  });

  it('labels are machine-generated and awaiting-human-review (FR-35)', () => {
    expect(DELIVERY_LABELS.map((l) => l.name)).toEqual([
      'machine-generated',
      'awaiting-human-review',
    ]);
  });
});

describe('PR title and body', () => {
  it('title is [SMA] <category>: <METHOD> <path>', () => {
    expect(buildPrTitle(evidence())).toBe('[SMA] field_renamed: GET /customers/{id}');
    expect(buildPrTitle(evidence({ change: { ...evidence().change, method: null } }))).toBe(
      '[SMA] field_renamed: /customers/{id}',
    );
  });

  it('body has the evidence, note citation, files, call sites, attempts, tests and the note', () => {
    const body = buildPrBody(evidence());
    expect(body).toContain(NEVER_MERGE_NOTE);
    expect(body).toContain('"customer_name"');
    expect(body).toContain('"full_name"');
    expect(body).toContain('/paths/~1customers~1{id}/get/responses/200');
    expect(body).toContain('`demo/api/migration-notes/v1-to-v2.yaml`');
    expect(body).toContain('`src/customers.ts`');
    expect(body).toContain('`src/customers.ts:12:21` (fetch)');
    expect(body).toContain('Repair attempts: 2');
    expect(body).toContain('12/12 tests passed');
    expect(body).toMatch(/<details>[\s\S]*Tests 12 passed \(12\)[\s\S]*<\/details>/);
    expect(body).not.toContain('fixture / demonstration');
  });

  it('names a human confirmer and labels fixture runs (BR-06)', () => {
    const body = buildPrBody(
      evidence({
        isFixture: true,
        confirmation: {
          source: 'human',
          confirmedBy: 'bigyan',
          confirmedAt: '2026-11-22T10:00:00.000Z',
        },
      }),
    );
    expect(body).toContain('Mapping confirmed by bigyan at 2026-11-22T10:00:00.000Z.');
    expect(body).toContain('fixture / demonstration run');
  });

  it('trims long evidence and raw output, keeping the tail of the output', () => {
    const long = 'x'.repeat(10_000);
    const body = buildPrBody(
      evidence({
        change: { ...evidence().change, before: { long } },
        tests: { passed: 1, total: 2, rawOutput: `${'y'.repeat(20_000)}FINAL SUMMARY` },
      }),
    );
    expect(body).toContain('(trimmed,');
    expect(body).toContain('FINAL SUMMARY');
    expect(body).toContain('1/2 tests passed');
    expect(body.length).toBeLessThan(MAX_PR_BODY_CHARS);
  });

  it('says counts are unavailable when they are null', () => {
    expect(
      buildPrBody(evidence({ tests: { passed: null, total: null, rawOutput: '' } })),
    ).toContain('test counts unavailable');
  });

  it('content with backticks cannot break out of its code fence', () => {
    const body = buildPrBody(
      evidence({ tests: { passed: 1, total: 1, rawOutput: '```\n## injected\n````' } }),
    );
    expect(body).toContain('`````text\n```\n## injected\n````\n`````');
  });

  it('redacts token-looking strings and the known token everywhere (NFR-04)', () => {
    const ev = evidence({
      change: { ...evidence().change, path: '/x/ghp_FAKE123' },
      tests: { passed: 1, total: 1, rawOutput: 'GITHUB_TOKEN=ghp_FAKE123 and MyRealTokenValue' },
      confirmation: { source: 'human', confirmedBy: 'ghp_FAKE123', confirmedAt: 'now' },
    });
    const body = buildPrBody(ev, ['MyRealTokenValue']);
    const title = buildPrTitle(ev, ['MyRealTokenValue']);
    for (const text of [body, title]) {
      expect(text).not.toContain('ghp_FAKE123');
      expect(text).not.toContain('MyRealTokenValue');
    }
    expect(body).toContain(REDACTED);
  });
});
