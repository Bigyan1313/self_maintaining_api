import { Buffer } from 'node:buffer';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { HTTP_METHODS, type SpecDifference } from '../detect/types.js';
import type { ChangeCategory } from '../domain/enums.js';
import type { FieldErrors } from '../api/contract.js';
import { err, ok, type Result } from '../result.js';

/** Maximum UTF-8 size of a migration note. */
export const MAX_MIGRATION_NOTE_BYTES = 256 * 1024;
const name = z.string().trim().min(1).max(512);
const endpoint = { method: z.enum(HTTP_METHODS), path: name.regex(/^\//) };
const scalar = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
/** Explicit mapping data; conversion strings are data and are never executed. */
export const MigrationMappingSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('field_renamed'),
      ...endpoint,
      location: z.enum(['response', 'request']),
      old: name,
      new: name,
    })
    .strict()
    .refine((v) => v.old !== v.new, {
      path: ['new'],
      message: 'Replacement must differ from original',
    }),
  z
    .object({
      kind: z.literal('field_type_changed'),
      ...endpoint,
      field: name,
      old_type: name,
      new_type: name,
      conversion: z.string().min(1).max(4096).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('required_param_added'),
      ...endpoint,
      param: name,
      in: z.enum(['path', 'query', 'header', 'cookie']),
      default_value: scalar,
    })
    .strict(),
  z
    .object({
      kind: z.literal('endpoint_removed'),
      ...endpoint,
      replacement: z.object(endpoint).strict().optional(),
    })
    .strict(),
]);
/** One validated note mapping. */
export type MigrationMapping = z.infer<typeof MigrationMappingSchema>;
/** Validated migration-note document. */
export const MigrationNoteDocumentSchema = z
  .object({
    api: name,
    from: name,
    to: name,
    mappings: z.array(MigrationMappingSchema).max(1000),
  })
  .strict()
  .superRefine((note, ctx) => {
    if (note.from === note.to)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Versions must differ' });
    const seen = new Set<string>();
    for (const [i, m] of note.mappings.entries()) {
      const selector = JSON.stringify([
        m.kind,
        m.method,
        m.path,
        m.kind === 'field_renamed'
          ? [m.location, m.old]
          : m.kind === 'field_type_changed'
            ? m.field
            : m.kind === 'required_param_added'
              ? [m.in, m.param]
              : null,
      ]);
      if (seen.has(selector))
        ctx.addIssue({
          code: 'custom',
          path: ['mappings', i],
          message: 'Duplicate mapping selector',
        });
      seen.add(selector);
    }
  });
/** Migration note accepted by the classifier. */
export type MigrationNoteDocument = z.infer<typeof MigrationNoteDocumentSchema>;

/** Parse bounded YAML as data, rejecting tags, aliases, duplicate keys, and invalid fields. */
export function parseMigrationNote(text: string): Result<MigrationNoteDocument, FieldErrors> {
  if (Buffer.byteLength(text, 'utf8') > MAX_MIGRATION_NOTE_BYTES)
    return err([{ field: 'rawYaml', message: 'Migration note exceeds 256 KiB' }]);
  try {
    const core = parseDocument(text, {
      version: '1.2',
      schema: 'core',
      uniqueKeys: true,
      prettyErrors: false,
    });
    if (core.errors.length || core.warnings.length)
      return err([{ field: 'rawYaml', message: 'Invalid YAML or unsupported tag' }]);
    const value: unknown = core.toJS({ maxAliasCount: 0 });
    const parsed = MigrationNoteDocumentSchema.safeParse(value);
    if (!parsed.success)
      return err(
        parsed.error.issues.map((i) => ({
          field: i.path.join('.') || 'rawYaml',
          message: 'Invalid migration-note field',
        })),
      );
    return ok(parsed.data);
  } catch {
    return err([
      {
        field: 'rawYaml',
        message: 'Invalid YAML; aliases and recursive documents are not supported',
      },
    ]);
  }
}

/** Match only explicit kind, operation, and field/parameter identity; ambiguity never confirms. */
export function findMapping(
  note: MigrationNoteDocument,
  d: SpecDifference,
  category: ChangeCategory,
): MigrationMapping | null {
  const field = Array.isArray(d.details.propertyPath)
    ? d.details.propertyPath.join('/')
    : d.details.propertyName;
  const matches = note.mappings.filter((m) => {
    if (m.kind !== category || m.method !== d.method || m.path !== d.path) return false;
    switch (m.kind) {
      case 'field_renamed':
        return m.old === field && d.ruleId.startsWith(`${m.location}-`);
      case 'field_type_changed':
        return (
          m.field === field && m.old_type === d.details.oldType && m.new_type === d.details.newType
        );
      case 'required_param_added':
        return m.param === d.details.paramName && m.in === d.details.paramIn;
      case 'endpoint_removed':
        return true;
    }
  });
  return matches.length === 1 ? matches[0]! : null;
}
