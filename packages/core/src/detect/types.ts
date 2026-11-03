/**
 * Detect-stage types (FR-06, FR-08). Detection only reports *what is different*; it never
 * decides breaking/safe (Increment 06) and never claims consumer code is broken (BR-01).
 */

/** HTTP methods an OpenAPI operation can use. */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
/** One of {@link HTTP_METHODS}. */
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** oasdiff severity level. This is oasdiff's opinion, not our classification. */
export const DIFFERENCE_LEVELS = ['error', 'warning', 'info'] as const;
/** One of {@link DIFFERENCE_LEVELS}. */
export type DifferenceLevel = (typeof DIFFERENCE_LEVELS)[number];

/** One structured difference between two spec versions, with before/after evidence. */
export interface SpecDifference {
  /** Stable: sha256(ruleId|method|path|jsonPointer), first 16 hex chars. */
  id: string;
  /** oasdiff rule id, e.g. `response-property-type-changed`. Unknown ids are kept. */
  ruleId: string;
  /** oasdiff level. */
  level: DifferenceLevel;
  /** OpenAPI path, e.g. `/orders/{id}`; empty when oasdiff gave none. */
  path: string;
  /** HTTP method, or `null` when the difference is not tied to one operation. */
  method: HttpMethod | null;
  /** RFC 6901 pointer into the spec document for the changed item; `""` when unattributed. */
  jsonPointer: string;
  /** oasdiff's text. */
  description: string;
  /** Rule-specific extras parsed from the text (property name, old/new type, parameter name…). */
  details: Record<string, unknown>;
  /** The JSON at `jsonPointer` in the BEFORE spec (`null` if absent). */
  evidenceBefore: unknown | null;
  /** The JSON at the pointer in the AFTER spec (`null` if absent). */
  evidenceAfter: unknown | null;
}

/** The two normalized spec documents a changelog was produced from. Both are optional. */
export interface DetectSpecs {
  /** BEFORE (base) spec. */
  before?: unknown;
  /** AFTER (revision) spec. */
  after?: unknown;
}

/** The parser could not read oasdiff's output at all (as opposed to an unknown rule, which is kept). */
export interface DetectParseError {
  code: 'bad_output';
  message: string;
}
