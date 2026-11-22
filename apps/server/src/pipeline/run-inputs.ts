/**
 * Pure mapping from stored rows to the inputs the stage functions take. The orchestrator never
 * accepts change evidence from a client: everything comes from the stored change (BR-04).
 * @packageDocumentation
 */
import {
  HTTP_METHODS,
  MigrationMappingSchema,
  parseUnifiedDiff,
  diffFilePath,
  type DeliveryEvidence,
  type HttpMethod,
  type LocateTarget,
  type MigrationMapping,
  type RepairContextInput,
} from '@sma/core';
import type { Attempt, CallSite, Change, MigrationNote } from '../infra/db/index.js';

/** The confirmed mapping of a change, or `null` when it is missing or not a valid mapping. */
export function confirmedMapping(change: Change): MigrationMapping | null {
  if (change.mappingStatus !== 'confirmed' || change.mapping == null) return null;
  const parsed = MigrationMappingSchema.safeParse(change.mapping);
  return parsed.success ? parsed.data : null;
}

/**
 * The operation (and field, as context) Locate searches for. `null` when the change is not tied
 * to one HTTP operation, which the orchestrator reports as `needs_review`, never `not_affected`.
 * @param change - A stored change.
 */
export function locateTarget(change: Change): LocateTarget | null {
  const method = change.method?.toUpperCase();
  if (!method || !(HTTP_METHODS as readonly string[]).includes(method) || !change.path) return null;
  const target: LocateTarget = { method: method as HttpMethod, path: change.path };
  const mapping = confirmedMapping(change);
  const field =
    mapping?.kind === 'field_renamed'
      ? mapping.old
      : mapping?.kind === 'field_type_changed'
        ? mapping.field
        : mapping?.kind === 'required_param_added'
          ? mapping.param
          : undefined;
  if (field) target.field = field;
  return target;
}

/**
 * A stored change in the shape the repair context builder takes. The mapping is the stored,
 * confirmed one; an unconfirmed change keeps `mapping: null`, so repair refuses it (FR-18).
 * @param change - A stored change.
 */
export function repairChange(change: Change): RepairContextInput['change'] {
  const method = change.method?.toUpperCase();
  return {
    difference: {
      id: change.id,
      ruleId: change.oasdiffRuleId,
      level: change.classification === 'breaking' ? 'error' : 'info',
      path: change.path,
      method:
        method && (HTTP_METHODS as readonly string[]).includes(method)
          ? (method as HttpMethod)
          : null,
      jsonPointer: change.jsonPointer,
      description: `${change.category} at ${change.method ?? ''} ${change.path}`.trim(),
      details: {},
      evidenceBefore: change.evidenceBefore ?? null,
      evidenceAfter: change.evidenceAfter ?? null,
    },
    category: change.category,
    classification: change.classification,
    confidence: change.confidence,
    mappingStatus: change.mappingStatus,
    mappingSource: change.mappingSource,
    mapping: confirmedMapping(change),
    reason: `Classified ${change.classification} (confidence ${change.confidence}).`,
  };
}

/** The migration-note entry for repair: the mapping when a note confirmed it, else `null`. */
export function migrationNoteEntry(change: Change): MigrationMapping | null {
  return change.mappingSource === 'migration_note' ? confirmedMapping(change) : null;
}

/**
 * Files a unified diff changes (new path, or old path for a deletion), in diff order.
 * @param patch - A unified diff.
 */
export function affectedFiles(patch: string): string[] {
  const parsed = parseUnifiedDiff(patch);
  if (!parsed.ok) return [];
  return [...new Set(parsed.value.map(diffFilePath).filter(Boolean))];
}

/** A short, human citation for a migration note. */
export function noteCitation(note: MigrationNote): string {
  const parsed = note.parsed as { api?: unknown; from?: unknown; to?: unknown } | null;
  const range =
    parsed && typeof parsed.from === 'string' && typeof parsed.to === 'string'
      ? ` ${String(parsed.api ?? '')} ${parsed.from} → ${parsed.to}`.replace(/\s+/g, ' ')
      : '';
  return `Migration note${range} (id ${note.id})`;
}

/** Everything {@link buildDeliveryEvidence} reads. */
export interface EvidenceSources {
  runId: string;
  isFixture: boolean;
  change: Change;
  note: MigrationNote | null;
  callSites: CallSite[];
  attempts: Attempt[];
  patch: string;
}

/**
 * Pull-request evidence for a validated patch (FR-33), built only from stored records.
 * @throws Error when the change has no confirmed mapping (delivery must never happen then).
 */
export function buildDeliveryEvidence(src: EvidenceSources): DeliveryEvidence {
  const { change } = src;
  const mapping = confirmedMapping(change);
  if (!mapping) throw new Error('Cannot deliver a change without a confirmed mapping (BR-04)');
  let confirmation: DeliveryEvidence['confirmation'];
  if (change.mappingSource === 'migration_note') {
    if (!src.note) throw new Error('The confirming migration note is missing');
    confirmation = { source: 'migration_note', noteRef: noteCitation(src.note), entry: mapping };
  } else {
    if (!change.confirmedBy || !change.confirmedAt)
      throw new Error('A human confirmation must name who confirmed it and when');
    confirmation = {
      source: 'human',
      confirmedBy: change.confirmedBy,
      confirmedAt: change.confirmedAt.toISOString(),
    };
  }
  const last = src.attempts.at(-1);
  return {
    runId: src.runId,
    isFixture: src.isFixture,
    change: {
      category: change.category,
      method: change.method,
      path: change.path,
      jsonPointer: change.jsonPointer,
      before: change.evidenceBefore ?? null,
      after: change.evidenceAfter ?? null,
    },
    confirmation,
    callSites: src.callSites.map((s) => ({
      filePath: s.filePath,
      line: s.line,
      column: s.column,
      pattern: s.pattern,
    })),
    affectedFiles: affectedFiles(src.patch),
    attempts: src.attempts.length,
    tests: {
      passed: last?.testsPassed ?? null,
      total: last?.testsTotal ?? null,
      rawOutput: last?.validationOutput ?? '',
    },
  };
}
