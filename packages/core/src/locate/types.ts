import type { HttpMethod } from '../detect/types.js';
import type { CallPattern } from '../domain/enums.js';

/** Changed operation to find; field is context, not proof of field-level data flow. */
export interface LocateTarget {
  method: HttpMethod;
  path: string;
  operationId?: string;
  field?: string;
}
/** A supported operation call, with one-based positions and a five-line excerpt. */
export interface CallSite {
  filePath: string;
  line: number;
  column: number;
  pattern: CallPattern;
  excerpt: string;
}
/** Source selection and inspection evidence. */
export interface CoverageEntry {
  filePath: string;
  inspected: boolean;
  skipReason?: string;
}
/** An unresolved usage which prevents a claim of compatibility. */
export interface UnsupportedUsage {
  filePath: string;
  line: number;
  kind: 'dynamic_url' | 'wrapper' | 'reexported_alias' | 'unknown_client';
  excerpt: string;
}
/** Locator verdict and the evidence needed to interpret it. */
export interface LocateResult {
  outcome: 'affected' | 'not_affected' | 'needs_review';
  callSites: CallSite[];
  coverage: CoverageEntry[];
  unsupported: UnsupportedUsage[];
  limitsExceeded?: { files: number; lines: number; message: string };
  reason: string;
}
