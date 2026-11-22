import { describe, expect, it } from 'vitest';
import { MAX_VALUE_LINES, Recorder, formatValue, scrub } from './record.js';

const info = { id: 'AT-99', title: 'Demo', requirements: 'FR-00', inputs: [] };

describe('Recorder verdicts', () => {
  it('is FAIL when nothing ran', () => {
    expect(new Recorder(info).verdict()).toBe('FAIL');
  });
  it('is PASS only when every assertion passed and nothing was skipped', () => {
    const r = new Recorder(info);
    r.check('a', true);
    r.check('b', true, 3);
    expect(r.verdict()).toBe('PASS');
    expect(r.reason()).toBe('All 2 assertions passed.');
  });
  it('is PARTIAL when a required part could not run', () => {
    const r = new Recorder(info);
    r.check('a', true);
    r.skip('delivery', 'needs inc 12');
    expect(r.verdict()).toBe('PARTIAL');
    expect(r.reason()).toContain('delivery (needs inc 12)');
  });
  it('is FAIL when any assertion failed, even with skipped parts', () => {
    const r = new Recorder(info);
    r.check('a', true);
    r.check('b', false, 'got 3');
    r.skip('x', 'later');
    expect(r.verdict()).toBe('FAIL');
    expect(r.reason()).toBe('1 of 2 assertions failed: b.');
  });
  it('is FAIL when blocked or when an unexpected error happened', () => {
    const blocked = new Recorder(info);
    blocked.check('a', true);
    blocked.block('Docker is not running');
    expect(blocked.verdict()).toBe('FAIL');
    const errored = new Recorder(info);
    errored.error(new Error('boom'));
    expect(errored.verdict()).toBe('FAIL');
    expect(errored.transcript()).toContain('✗ no unexpected error  → Error: boom');
  });
  it('writes a shell-like transcript with steps and results', () => {
    const r = new Recorder(info);
    r.step('POST /api/apis');
    r.show('status', 201);
    r.check('created', true, { id: 1 });
    expect(r.steps).toEqual(['POST /api/apis']);
    expect(r.transcript()).toBe(
      [
        '# AT-99 Demo  (FR-00)',
        '',
        '$ POST /api/apis',
        'status: 201',
        '  ✓ created  → {   "id": 1 }',
        '',
        'RESULT AT-99: PASS — All 1 assertions passed.',
        '',
      ].join('\n'),
    );
  });
});

describe('formatValue and scrub', () => {
  it('cuts long values', () => {
    const long = Array.from({ length: MAX_VALUE_LINES + 5 }, (_, i) => `line ${i}`).join('\n');
    expect(formatValue(long).split('\n')).toHaveLength(MAX_VALUE_LINES + 1);
    expect(formatValue(long)).toContain('… (5 more lines)');
    expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
  it('redacts secrets, ignores short values, and shortens paths (longest first)', () => {
    const out = scrub(
      'key=sk-ant-SECRET123 short=abc in /tmp/x/y and /tmp/x',
      ['sk-ant-SECRET123', 'abc'],
      {
        '/tmp/x': '<tmp>',
        '/tmp/x/y': '<repo>',
      },
    );
    expect(out).toEqual({ text: 'key=[REDACTED] short=abc in <repo> and <tmp>', secretsFound: 1 });
  });
});
