import type { SpecDifference } from '../detect/types.js';
import type { ChangeCategory, Classification } from '../domain/enums.js';
import {
  findMapping,
  type MigrationMapping,
  type MigrationNoteDocument,
} from '../migration-note/parse.js';
import { CLASSIFICATION_RULES } from './rules.js';

/** One spec verdict; it makes no claim about whether consumer code is broken. */
export interface ClassifiedChange {
  difference: SpecDifference;
  category: ChangeCategory;
  classification: Classification;
  confidence: number;
  mappingStatus: 'confirmed' | 'unconfirmed';
  mappingSource: 'migration_note' | null;
  mapping: MigrationMapping | null;
  reason: string;
}
/** Required refusal reason for an endpoint without an explicit replacement. */
export const NO_REPLACEMENT_REASON =
  'Removed with no documented replacement; reported as affected, no migration proposed.';

function additions(d: SpecDifference, differences: readonly SpecDifference[]): SpecDifference[] {
  return differences.filter(
    (other) =>
      other.path === d.path &&
      other.method === d.method &&
      ['response-required-property-added', 'response-optional-property-added'].includes(
        other.ruleId,
      ) &&
      other.details.status === d.details.status &&
      other.details.mediaType === d.details.mediaType,
  );
}

/** Classify every difference; only a matching migration note can confirm a mapping here. */
export function classify(
  differences: readonly SpecDifference[],
  note: MigrationNoteDocument | null,
): ClassifiedChange[] {
  return differences.map((d) => {
    const rule = Object.prototype.hasOwnProperty.call(CLASSIFICATION_RULES, d.ruleId)
      ? CLASSIFICATION_RULES[d.ruleId]
      : undefined;
    const unknown = !rule || d.details.unattributed === true || d.details.unknownLevel === true;
    let category: ChangeCategory = unknown ? 'other' : rule.category;
    const classification: Classification = unknown ? 'unknown' : rule.classification;
    let confidence = unknown ? 0.5 : rule.confidence;
    const siblings = additions(d, differences);
    if (
      !unknown &&
      ['response-required-property-removed', 'response-optional-property-removed'].includes(
        d.ruleId,
      ) &&
      siblings.length
    ) {
      category = 'field_renamed';
      confidence = 0.6;
    }
    let mapping = !unknown && note ? findMapping(note, d, category) : null;
    if (mapping?.kind === 'field_renamed') {
      const target = mapping.new;
      if (
        !siblings.some(
          (s) =>
            (Array.isArray(s.details.propertyPath)
              ? s.details.propertyPath.join('/')
              : s.details.propertyName) === target,
        )
      )
        mapping = null;
    }
    if (
      mapping?.kind === 'endpoint_removed' &&
      (!mapping.replacement ||
        (mapping.replacement.method === mapping.method &&
          mapping.replacement.path === mapping.path))
    )
      mapping = null;
    if (mapping && category === 'field_renamed') confidence = 0.95;
    const reason =
      category === 'endpoint_removed' && !mapping
        ? NO_REPLACEMENT_REASON
        : mapping
          ? 'The specification change has an explicit migration-note mapping.'
          : classification === 'unknown'
            ? 'The specification difference is unknown; reported, not repaired.'
            : category === 'field_renamed'
              ? 'The specification has a possible rename without a confirmed mapping; reported, not repaired.'
              : `The specification change is ${classification} without a confirmed mapping; reported, not repaired.`;
    return {
      difference: d,
      category,
      classification,
      confidence,
      mappingStatus: mapping ? 'confirmed' : 'unconfirmed',
      mappingSource: mapping ? 'migration_note' : null,
      mapping,
      reason,
    };
  });
}
