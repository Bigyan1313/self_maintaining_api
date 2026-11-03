import { extractEvidence, resolveAnchor, type DifferenceAnchor } from '../detect/pointer.js';
import type { ChangeCategory } from '../domain/enums.js';
import type { MigrationMapping } from './parse.js';

/** Persisted evidence needed to validate a proposed human mapping. */
export interface MappingEvidence {
  category: ChangeCategory;
  method: string | null;
  path: string;
  jsonPointer: string;
  evidenceBefore: unknown;
  evidenceAfter: unknown;
}
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate explicit mapping targets in immutable before/after specs and the change evidence. */
export function mappingMatchesEvidence(
  mapping: MigrationMapping,
  change: MappingEvidence,
  before: unknown,
  after: unknown,
): boolean {
  if (
    mapping.kind !== change.category ||
    mapping.path !== change.path ||
    mapping.method !== change.method
  )
    return false;
  const locate = (spec: unknown, anchor: DifferenceAnchor) =>
    resolveAnchor(spec, mapping.path, mapping.method, anchor);
  const at = (spec: unknown, pointer: string | null) =>
    pointer === null ? null : extractEvidence(spec, pointer);
  switch (mapping.kind) {
    case 'endpoint_removed': {
      if (!mapping.replacement || !change.evidenceBefore || change.evidenceAfter !== null)
        return false;
      const old = locate(before, { kind: 'operation' });
      const remaining = locate(after, { kind: 'operation' });
      const target = resolveAnchor(after, mapping.replacement.path, mapping.replacement.method, {
        kind: 'operation',
      });
      return old === change.jsonPointer && remaining === null && target !== null;
    }
    case 'required_param_added': {
      const anchor: DifferenceAnchor = { kind: 'parameter', name: mapping.param, in: mapping.in };
      const old = locate(before, anchor);
      const next = locate(after, anchor);
      const param = at(after, next);
      return (
        (old ?? next) === change.jsonPointer &&
        record(param) &&
        param.required === true &&
        record(change.evidenceAfter) &&
        change.evidenceAfter.name === mapping.param &&
        change.evidenceAfter.in === mapping.in
      );
    }
    case 'field_type_changed':
    case 'field_renamed': {
      const field = mapping.kind === 'field_renamed' ? mapping.old : mapping.field;
      const target = mapping.kind === 'field_renamed' ? mapping.new : mapping.field;
      const locations =
        mapping.kind === 'field_renamed' ? [mapping.location] : ['response', 'request'];
      // Try each response status explicitly; never choose a property from a different response.
      const opPointer = resolveAnchor(before, mapping.path, mapping.method, { kind: 'operation' });
      const op = at(before, opPointer);
      const statuses = record(op) && record(op.responses) ? Object.keys(op.responses) : [];
      for (const location of locations) {
        for (const status of location === 'response' ? statuses : [null]) {
          const holder = at(
            before,
            locate(
              before,
              location === 'response' ? { kind: 'response', status } : { kind: 'request-body' },
            ),
          );
          const mediaTypes =
            record(holder) && record(holder.content) ? Object.keys(holder.content) : [];
          for (const mediaType of mediaTypes) {
            const anchor: DifferenceAnchor =
              location === 'response'
                ? { kind: 'response-property', status, mediaType, propertyPath: field.split('/') }
                : { kind: 'request-property', mediaType, propertyPath: field.split('/') };
            const old = locate(before, anchor);
            if (old !== change.jsonPointer) continue;
            const next = locate(after, { ...anchor, propertyPath: target.split('/') });
            const oldValue = at(before, old);
            const newValue = at(after, next);
            if (!record(oldValue) || !record(newValue)) continue;
            if (mapping.kind === 'field_renamed')
              return locate(after, anchor) === null && change.evidenceAfter === null;
            return (
              oldValue.type === mapping.old_type &&
              newValue.type === mapping.new_type &&
              record(change.evidenceBefore) &&
              record(change.evidenceAfter) &&
              change.evidenceBefore.type === mapping.old_type &&
              change.evidenceAfter.type === mapping.new_type
            );
          }
        }
      }
      return false;
    }
  }
}
