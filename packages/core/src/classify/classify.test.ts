import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseOasdiffChangelog } from '../detect/parse.js';
import {
  parseMigrationNote,
  findMapping,
  MAX_MIGRATION_NOTE_BYTES,
} from '../migration-note/parse.js';
import { mappingMatchesEvidence } from '../migration-note/validate.js';
import { classify, NO_REPLACEMENT_REASON } from './classify.js';
import { CLASSIFICATION_RULES } from './rules.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const before: unknown = parse(read('../../../../demo/api/specs/v1.yaml'));
const after: unknown = parse(read('../../../../demo/api/specs/v2.yaml'));
const rawNote = read('../../../../demo/api/migration-notes/v1-to-v2.yaml');
const noteResult = parseMigrationNote(rawNote);
if (!noteResult.ok) throw new Error('Invalid fixture note');
const note = noteResult.value;
const parsed = parseOasdiffChangelog(read('../../test/fixtures/oasdiff-demo-v1-v2.json'), {
  before,
  after,
});
if (!parsed.ok) throw new Error('Invalid detection fixture');
const diffs = parsed.value;

// Labels were authored before the classifier, not derived from its output.
const labels = parse(read('../../test/fixtures/demo-v1-v2.labels.yaml')) as {
  rule: string;
  path: string;
  method: string;
  category: string;
  classification: string;
  mappingStatus: string;
}[];

describe('classification acceptance', () => {
  it('matches every hand label with the note, preserving all evidence and differences', () => {
    const results = classify(diffs, note);
    expect(results).toHaveLength(labels.length);
    for (const label of labels) {
      const result = results.find(
        (r) =>
          r.difference.ruleId === label.rule &&
          r.difference.path === label.path &&
          r.difference.method === label.method,
      )!;
      expect(result).toMatchObject({
        category: label.category,
        classification: label.classification,
        mappingStatus: label.mappingStatus,
      });
      expect(result.difference).toEqual(diffs.find((d) => d.id === result.difference.id));
      expect(result.reason.length).toBeGreaterThan(0);
    }
    expect(results.filter((r) => r.mappingSource === 'migration_note')).toHaveLength(4);
    expect(results.find((r) => r.difference.method === 'DELETE')?.reason).toBe(
      NO_REPLACEMENT_REASON,
    );
  });
  it('isolates all five breaking differences without a note; rename resemblance never confirms', () => {
    const results = classify(diffs, null);
    const breaking = results.filter((r) => r.classification === 'breaking');
    expect(breaking).toHaveLength(5);
    expect(breaking.every((r) => r.mappingStatus === 'unconfirmed' && r.mapping === null)).toBe(
      true,
    );
    expect(breaking.find((r) => r.category === 'field_renamed')?.confidence).toBe(0.6);
  });
  it('keeps a lone removed property breaking without claiming a rename', () => {
    const removed = diffs.find((d) => d.ruleId === 'response-required-property-removed')!;
    expect(classify([removed], note)[0]).toMatchObject({
      category: 'other',
      classification: 'breaking',
      mappingStatus: 'unconfirmed',
    });
  });
  it('requires exact field, parameter location, method, path and type identities', () => {
    const unrelated = {
      ...note,
      mappings: note.mappings.map((m) => ({ ...m, path: '/unrelated' })),
    };
    expect(classify(diffs, unrelated).every((r) => r.mappingStatus === 'unconfirmed')).toBe(true);
    const changed = diffs.find((d) => d.ruleId === 'response-property-type-changed')!;
    expect(
      findMapping(
        note,
        { ...changed, details: { ...changed.details, oldType: 'boolean' } },
        'field_type_changed',
      ),
    ).toBeNull();
    const required = diffs.find((d) => d.ruleId === 'request-parameter-became-required')!;
    expect(
      findMapping(
        note,
        { ...required, details: { ...required.details, paramIn: 'header' } },
        'required_param_added',
      ),
    ).toBeNull();
    const rename = note.mappings.find((m) => m.kind === 'field_renamed')!;
    expect(
      classify(diffs, { ...note, mappings: [{ ...rename, new: 'missing' }] }).every(
        (r) => r.mappingStatus === 'unconfirmed',
      ),
    ).toBe(true);
  });
  it('refuses an endpoint mapping with no replacement', () => {
    const d = diffs.find((d) => d.method === 'DELETE')!;
    const results = classify([d], {
      ...note,
      mappings: [{ kind: 'endpoint_removed', method: 'DELETE', path: d.path }],
    });
    expect(results[0]).toMatchObject({
      mappingStatus: 'unconfirmed',
      reason: NO_REPLACEMENT_REASON,
    });
  });
  it('keeps unknown/unattributed differences unknown even with an apparently matching note', () => {
    const d = diffs[0]!;
    for (const unknown of [
      { ...d, ruleId: 'unseen-rule' },
      { ...d, ruleId: 'toString' },
      { ...d, details: { ...d.details, unattributed: true } },
    ]) {
      expect(classify([unknown], note)[0]).toMatchObject({
        classification: 'unknown',
        confidence: 0.5,
        mappingStatus: 'unconfirmed',
      });
    }
  });
  it('confidence is bounded and every randomized difference survives (fixed seed)', () => {
    let seed = 4398;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const rules = [...Object.keys(CLASSIFICATION_RULES), 'unknown'];
    const generated = Array.from({ length: 1000 }, (_, i) => ({
      ...diffs[i % diffs.length]!,
      id: String(i),
      ruleId: rules[Math.floor(random() * rules.length)]!,
      details: { unattributed: random() < 0.2 },
    }));
    const results = classify(generated, note);
    expect(results.map((r) => r.difference.id)).toEqual(generated.map((d) => d.id));
    for (const result of results) {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('untrusted migration-note parsing', () => {
  it('accepts the demo schema and exposes field-level errors', () => {
    expect(note.mappings).toHaveLength(4);
    const invalid = parseMigrationNote(rawNote.replace('old: customer_name', 'old: 123'));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.some((e) => e.field === 'mappings.0.old')).toBe(true);
  });
  it.each([
    'x: [',
    '!!js/function function() {}',
    'x: !custom secret',
    'x: &a [*a]',
    'api: one\napi: two',
    'x: .inf',
    '',
  ])('rejects unsafe or invalid YAML: %s', (text) => {
    expect(parseMigrationNote(text).ok).toBe(false);
  });
  it('enforces a UTF-8 size cap', () => {
    expect(parseMigrationNote('é'.repeat(MAX_MIGRATION_NOTE_BYTES / 2 + 1))).toMatchObject({
      ok: false,
    });
  });
  it('rejects duplicate/conflicting selectors', () => {
    expect(
      parseMigrationNote(
        JSON.stringify({ ...note, mappings: [...note.mappings, note.mappings[0]] }),
      ),
    ).toMatchObject({ ok: false });
  });
});

describe('human mapping evidence validation', () => {
  it('accepts all four explicit demo mappings using real spec evidence', () => {
    for (const result of classify(diffs, note).filter((r) => r.mapping)) {
      expect(
        mappingMatchesEvidence(
          result.mapping!,
          { ...result.difference, category: result.category },
          before,
          after,
        ),
      ).toBe(true);
    }
  });
  it('rejects missing fields, wrong operations, incorrect types and missing replacement endpoints', () => {
    for (const result of classify(diffs, note).filter((r) => r.mapping)) {
      const m = result.mapping!;
      const invalid =
        m.kind === 'field_renamed'
          ? { ...m, new: 'does_not_exist' }
          : m.kind === 'field_type_changed'
            ? { ...m, new_type: 'boolean' }
            : m.kind === 'required_param_added'
              ? { ...m, param: 'missing' }
              : { ...m, replacement: { method: 'GET' as const, path: '/missing' } };
      const evidence = { ...result.difference, category: result.category };
      expect(mappingMatchesEvidence(invalid, evidence, before, after)).toBe(false);
      expect(mappingMatchesEvidence({ ...m, method: 'PATCH' }, evidence, before, after)).toBe(
        false,
      );
    }
  });
});

it('human confirmation cannot borrow a replacement from a different media type', () => {
  const make = (
    jsonProperties: Record<string, unknown>,
    xmlProperties: Record<string, unknown>,
  ) => ({
    paths: {
      '/x': {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': { schema: { properties: jsonProperties } },
                'application/xml': { schema: { properties: xmlProperties } },
              },
            },
          },
        },
      },
    },
  });
  const before = make({ old: { type: 'string' } }, {});
  const after = make({}, { replacement: { type: 'string' } });
  expect(
    mappingMatchesEvidence(
      {
        kind: 'field_renamed',
        method: 'GET',
        path: '/x',
        location: 'response',
        old: 'old',
        new: 'replacement',
      },
      {
        category: 'field_renamed',
        method: 'GET',
        path: '/x',
        jsonPointer: '/paths/~1x/get/responses/200/content/application~1json/schema/properties/old',
        evidenceBefore: { type: 'string' },
        evidenceAfter: null,
      },
      before,
      after,
    ),
  ).toBe(false);
});

it('the documented rule table matches the executable rules', () => {
  const doc = read('../../../../docs/classification-rules.md');
  for (const [id, rule] of Object.entries(CLASSIFICATION_RULES)) {
    const row = doc.split('\n').find((line) => line.split('|')[1]?.trim() === id);
    expect(row, id).toBeDefined();
    const cells = row!.split('|').map((s) => s.trim());
    expect(cells.slice(2, 4)).toEqual([rule.category, rule.classification]);
    expect(Number(cells[4])).toBe(rule.confidence);
  }
});
