/** Authored scenario inputs; examples are the sole source of response fixtures. */
export interface Definition {
  id: string;
  category: 'field_renamed' | 'field_type_changed' | 'required_param_added' | 'endpoint_removed';
  difficulty: 'low' | 'moderate' | 'high';
  description: string;
  callPatterns: ('fetch' | 'axios_static' | 'axios_instance' | 'generated_client')[];
  path: string;
  operationId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  schemaBefore: Record<string, unknown>;
  schemaAfter: Record<string, unknown>;
  mapping?: Record<string, unknown>;
  parameter?: { name: string; in: 'query' | 'header'; value: string; enum?: string[] };
  replacement?: string;
  source: Record<string, string>;
  expectedValue: unknown;
  /** Explicit request/response examples for caller-dependent cases. */
  cases?: {
    id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    parameters: Record<string, string>;
  }[];
}

/** Frozen manifest entry; repoCommit is a deterministic Git commit of repo/ alone. */
export interface ManifestEntry {
  id: string;
  sha256: string;
  repoCommit: string;
}
/** Versioned set used by all evaluation baselines. */
export interface Manifest {
  schemaVersion: 1;
  scenarios: ManifestEntry[];
}
