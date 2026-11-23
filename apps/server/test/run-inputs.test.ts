/** Pure mapping from stored rows to stage inputs (no database). */
import { describe, expect, it } from 'vitest';
import { repairPreconditionReason } from '@sma/core';
import type { Attempt, CallSite, Change, MigrationNote } from '../src/infra/db/index.js';
import {
  affectedFiles,
  buildDeliveryEvidence,
  confirmedMapping,
  locateTarget,
  migrationNoteEntry,
  noteCitation,
  repairChange,
} from '../src/pipeline/run-inputs.js';
import { CORRECT_PATCH } from './repair-helpers.js';

const ID = 'f930e8e3-b188-4a05-8981-f2c0a53afe6c';
const mapping = {
  kind: 'field_renamed',
  method: 'GET',
  path: '/customers/{id}',
  location: 'response',
  old: 'customer_name',
  new: 'full_name',
};

function change(over: Partial<Change> = {}): Change {
  return {
    id: ID,
    apiId: ID,
    fromVersionId: ID,
    toVersionId: ID,
    category: 'field_renamed',
    oasdiffRuleId: 'response-required-property-removed',
    classification: 'breaking',
    confidence: 0.6,
    path: '/customers/{id}',
    method: 'GET',
    jsonPointer: '/paths/~1customers~1{id}/get',
    evidenceBefore: { customer_name: { type: 'string' } },
    evidenceAfter: { full_name: { type: 'string' } },
    mappingStatus: 'confirmed',
    mappingSource: 'migration_note',
    mapping,
    migrationNoteId: ID,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: new Date('2026-11-22T00:00:00Z'),
    ...over,
  };
}
const note: MigrationNote = {
  id: ID,
  apiId: ID,
  fromVersionId: ID,
  toVersionId: ID,
  rawYaml: 'x',
  parsed: { api: 'demo-shop', from: '1.0.0', to: '2.0.0', mappings: [] },
  uploadedAt: new Date(),
};
const site = {
  id: ID,
  runId: ID,
  filePath: 'src/customers.ts',
  line: 12,
  column: 21,
  pattern: 'fetch',
  excerpt: 'fetch()',
} as CallSite;
const attempt = {
  testsPassed: 12,
  testsTotal: 12,
  validationOutput: 'Tests 12 passed (12)',
} as Attempt;

describe('locateTarget', () => {
  it('uses the operation, and the mapped field as context', () => {
    expect(locateTarget(change())).toEqual({
      method: 'GET',
      path: '/customers/{id}',
      field: 'customer_name',
    });
    expect(
      locateTarget(change({ category: 'endpoint_removed', method: 'delete', mapping: null })),
    ).toEqual({ method: 'DELETE', path: '/customers/{id}' });
  });
  it('returns null when the change is not tied to one operation', () => {
    expect(locateTarget(change({ method: null }))).toBeNull();
    expect(locateTarget(change({ method: 'TRACE' }))).toBeNull();
  });
});

describe('repairChange / confirmedMapping', () => {
  it('passes a confirmed mapping through, so repair may run', () => {
    const c = repairChange(change());
    expect(c.mapping).toEqual(mapping);
    expect(repairPreconditionReason(c, { callSites: [site] })).toBeNull();
    expect(migrationNoteEntry(change())).toEqual(mapping);
  });
  it('an unconfirmed or malformed mapping becomes null, so repair refuses (BR-04)', () => {
    const unconfirmed = change({ mappingStatus: 'unconfirmed', mappingSource: null });
    expect(confirmedMapping(unconfirmed)).toBeNull();
    expect(repairPreconditionReason(repairChange(unconfirmed), { callSites: [site] })).toMatch(
      /No confirmed mapping/,
    );
    expect(confirmedMapping(change({ mapping: { kind: 'field_renamed' } }))).toBeNull();
  });
  it('a human confirmation is not passed as a migration-note entry', () => {
    expect(
      migrationNoteEntry(
        change({ mappingSource: 'human', confirmedBy: 'Ada', confirmedAt: new Date() }),
      ),
    ).toBeNull();
  });
});

describe('delivery evidence', () => {
  it('cites the note, lists call sites, affected files, attempts and tests', () => {
    const ev = buildDeliveryEvidence({
      runId: ID,
      isFixture: true,
      change: change(),
      note,
      callSites: [site],
      attempts: [attempt],
      patch: CORRECT_PATCH,
    });
    expect(ev.confirmation).toEqual({
      source: 'migration_note',
      noteRef: `Migration note demo-shop 1.0.0 → 2.0.0 (id ${ID})`,
      entry: mapping,
    });
    expect(ev.affectedFiles).toEqual(['src/customers.ts']);
    expect(ev.tests).toEqual({ passed: 12, total: 12, rawOutput: 'Tests 12 passed (12)' });
    expect(ev).toMatchObject({ attempts: 1, isFixture: true });
  });
  it('names the human who confirmed', () => {
    const at = new Date('2026-11-20T00:00:00Z');
    const ev = buildDeliveryEvidence({
      runId: ID,
      isFixture: false,
      change: change({ mappingSource: 'human', confirmedBy: 'Ada', confirmedAt: at }),
      note: null,
      callSites: [],
      attempts: [attempt],
      patch: CORRECT_PATCH,
    });
    expect(ev.confirmation).toEqual({
      source: 'human',
      confirmedBy: 'Ada',
      confirmedAt: at.toISOString(),
    });
  });
  it('refuses a change without a confirmed mapping', () => {
    expect(() =>
      buildDeliveryEvidence({
        runId: ID,
        isFixture: false,
        change: change({ mappingStatus: 'unconfirmed', mappingSource: null, mapping: null }),
        note: null,
        callSites: [],
        attempts: [],
        patch: '',
      }),
    ).toThrow(/confirmed mapping/);
  });
  it('affectedFiles is empty for an unparsable patch; noteCitation tolerates odd notes', () => {
    expect(affectedFiles('not a diff')).toEqual([]);
    expect(noteCitation({ ...note, parsed: null })).toBe(`Migration note (id ${ID})`);
  });
});
