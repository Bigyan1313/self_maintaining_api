import {
  API_CONTRACT as C,
  FieldErrorsSchema,
  IngestResponseSchema,
  type FieldErrors,
  type RegisterRepository,
  type RegisterApi,
  type MigrationNoteRequest,
  type ConfirmMappingRequest,
  type StartRunRequest,
} from '@sma/core/api/contract';

/** Safe field-level API failures for form rendering. */
export class ApiError extends Error {
  constructor(
    public fields: FieldErrors,
    public status = 0,
  ) {
    super(fields.map((f) => f.message).join('; '));
  }
}
/** Validate all responses at the shared contract boundary; never accept a failed HTTP request as success. */
export async function request<T>(
  url: string,
  schema: { parse(value: unknown): T },
  body?: unknown,
  raw = false,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      url,
      body === undefined
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': raw ? 'text/plain' : 'application/json' },
            body: raw ? String(body) : JSON.stringify(body),
          },
    );
  } catch {
    throw new ApiError([
      { field: 'connection', message: 'Cannot reach the server. Check the connection and retry.' },
    ]);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiError(
      [
        {
          field: 'response',
          message: `Server returned an unreadable response (${response.status}).`,
        },
      ],
      response.status,
    );
  }
  if (!response.ok) {
    const check = IngestResponseSchema.safeParse(value);
    if (check.success)
      throw new ApiError(
        [
          {
            field: 'check',
            message: `${check.data.check.outcome.label}: ${check.data.check.errorDetail ?? 'Specification check failed'}`,
          },
        ],
        response.status,
      );
    const errors = FieldErrorsSchema.safeParse(value);
    throw new ApiError(
      errors.success
        ? errors.data
        : [{ field: 'request', message: `Request failed (${response.status}).` }],
      response.status,
    );
  }
  try {
    return schema.parse(value);
  } catch {
    throw new ApiError(
      [{ field: 'response', message: 'Server response does not match the API contract.' }],
      response.status,
    );
  }
}
const path = (template: string, id: string) => template.replace(':id', encodeURIComponent(id));
/** Dashboard API: paths, payloads, and responses come from the shared contract. */
export const api = {
  repositories: () => request(C.repositories.path, C.repositories.GET.response),
  registerRepository: (body: RegisterRepository) =>
    request(C.repositories.path, C.repositories.POST.response, body),
  apis: () => request(C.apis.path, C.apis.GET.response),
  registerApi: (body: RegisterApi) => request(C.apis.path, C.apis.POST.response, body),
  upload: (id: string, text: string) =>
    request(path(C.specs.path, id), C.specs.POST.response, text, true),
  check: (id: string) => request(path(C.check.path, id), C.check.POST.response, {}),
  checks: (id: string) => request(path(C.checks.path, id), C.checks.GET.response),
  note: (id: string, body: MigrationNoteRequest) =>
    request(path(C.migrationNotes.path, id), C.migrationNotes.POST.response, body),
  changes: (id: string) =>
    request(`${C.changes.path}?apiId=${encodeURIComponent(id)}`, C.changes.GET.response),
  confirm: (id: string, body: ConfirmMappingRequest) =>
    request(path(C.confirmMapping.path, id), C.confirmMapping.POST.response, body),
  runs: () => request(C.runs.path, C.runs.GET.response),
  start: (body: StartRunRequest) => request(C.runs.path, C.runs.POST.response, body),
  detail: (id: string) => request(path(C.run.path, id), C.run.GET.response),
  reanalyze: (id: string) => request(path(C.reanalyze.path, id), C.reanalyze.POST.response, {}),
  retry: (id: string) => request(path(C.retryDelivery.path, id), C.retryDelivery.POST.response, {}),
  exportUrl: (id: string, format: 'json' | 'html') => `${path(C.export.path, id)}?format=${format}`,
  results: () => request(C.results.path, C.results.GET.response),
};

/** Fetch a contract-valid export before saving it, so failed downloads stay visible in the UI. */
export async function downloadReport(id: string, format: 'json' | 'html'): Promise<void> {
  let response: Response;
  try {
    response = await fetch(api.exportUrl(id, format));
  } catch {
    throw new ApiError([{ field: 'export', message: 'Cannot reach the export endpoint.' }]);
  }
  if (!response.ok)
    throw new ApiError(
      [{ field: 'export', message: `Export failed (${response.status}).` }],
      response.status,
    );
  const content =
    format === 'json'
      ? JSON.stringify(C.run.GET.response.parse(await response.json()), null, 2)
      : C.export.GET.response.parse(await response.text());
  const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content)], {
    type: format === 'json' ? 'application/json' : 'text/html',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `run-${id}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
