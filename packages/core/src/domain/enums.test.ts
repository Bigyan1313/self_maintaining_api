import { describe, expect, it } from 'vitest';
import { DOMAIN_ENUMS, labelOf, RUN_STATUS_LABELS, type DomainEnumName } from './enums.js';

const entries = Object.entries(DOMAIN_ENUMS) as [
  DomainEnumName,
  { values: readonly string[]; labels: Record<string, string> },
][];

describe('domain enums', () => {
  it.each(entries)('%s: every value has a non-empty text label', (_name, { values, labels }) => {
    for (const value of values) {
      expect(labels[value], `missing label for "${value}"`).toBeTypeOf('string');
      expect(labels[value]?.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(entries)('%s: no labels for unknown values', (_name, { values, labels }) => {
    expect(Object.keys(labels).sort()).toEqual([...values].sort());
  });

  it.each(entries)('%s: values are unique snake_case identifiers', (_name, { values }) => {
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
  });

  it('labelOf returns the text label', () => {
    expect(labelOf('RunStatus', 'cheating_rejected')).toBe('Cheating rejected');
    expect(labelOf('GuardName', 'type_suppression')).toBe('Type check suppressed');
    expect(RUN_STATUS_LABELS.not_affected).toBe('Not affected within supported scope');
  });

  it('covers the enums required by increment 03', () => {
    expect(Object.keys(DOMAIN_ENUMS).sort()).toEqual(
      [
        'AttemptOutcome',
        'Baseline',
        'CallPattern',
        'ChangeCategory',
        'Classification',
        'GuardName',
        'MappingSource',
        'MappingStatus',
        'ReviewVerdict',
        'RunStatus',
        'SourceMode',
        'SpecCheckOutcome',
        'Stage',
        'StageResultStatus',
      ].sort(),
    );
  });
});
