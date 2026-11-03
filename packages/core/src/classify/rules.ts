import type { ChangeCategory, Classification } from '../domain/enums.js';

/** A documented spec-level rule, independent of consumer impact. */
export interface ClassificationRule {
  category: ChangeCategory;
  classification: Classification;
  confidence: number;
}
const removed: ClassificationRule = {
  category: 'endpoint_removed',
  classification: 'breaking',
  confidence: 0.95,
};
const required: ClassificationRule = {
  category: 'required_param_added',
  classification: 'breaking',
  confidence: 0.95,
};
const propertyRemoved: ClassificationRule = {
  category: 'other',
  classification: 'breaking',
  confidence: 0.95,
};
const safe: ClassificationRule = { category: 'other', classification: 'safe', confidence: 0.9 };
/** Supported oasdiff rule IDs; absent IDs are always unknown, regardless of detector severity. */
export const CLASSIFICATION_RULES: Readonly<Record<string, ClassificationRule>> = {
  'response-property-type-changed': {
    category: 'field_type_changed',
    classification: 'breaking',
    confidence: 0.95,
  },
  'request-property-type-changed': {
    category: 'field_type_changed',
    classification: 'breaking',
    confidence: 0.95,
  },
  'request-parameter-became-required': required,
  'new-required-request-parameter': required,
  'api-path-removed-without-deprecation': removed,
  'api-removed-without-deprecation': removed,
  'api-path-removed': removed,
  'api-removed': removed,
  'response-required-property-removed': propertyRemoved,
  'response-optional-property-removed': propertyRemoved,
  'response-optional-property-added': safe,
  'response-required-property-added': safe,
  'endpoint-added': safe,
  'response-property-pattern-added': safe,
  'new-optional-request-parameter': safe,
  'request-parameter-became-optional': safe,
};
