import { http, HttpResponse } from 'msw';
import {
  API_CONTRACT as C,
  type ApiResponse,
  type RepositoryResponse,
  type SpecCheckResponse,
  type ChangeResponse,
  type RunDetail,
} from '@sma/core/api/contract';
import { fixtureChange, fixtureDate, fixtureDetail, fixtureId, fixtureResults } from './fixtures';
/** The only unmerged endpoint mocked in normal development. */
export const resultsHandlers = [http.get(C.results.path, () => HttpResponse.json(fixtureResults))];
/** Full workflow fixtures are opt-in for browser tests/demonstration, never a production fallback. */
export function fixtureHandlers() {
  const repos: RepositoryResponse[] = [];
  const apis: ApiResponse[] = [];
  const checks: SpecCheckResponse[] = [];
  let change: ChangeResponse = structuredClone(fixtureChange);
  let detail: RunDetail = structuredClone(fixtureDetail);
  let uploaded = 0;
  const runs: RunDetail['run'][] = [];
  return [
    http.get(C.repositories.path, () => HttpResponse.json(repos)),
    http.post(C.repositories.path, async ({ request }) => {
      const parsed = C.repositories.POST.request.safeParse(await request.json());
      if (!parsed.success)
        return HttpResponse.json(
          parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          { status: 400 },
        );
      if (parsed.data.localPath === 'invalid')
        return HttpResponse.json(
          [{ field: 'localPath', message: 'Repository path is not reachable.' }],
          { status: 400 },
        );
      const repo = {
        ...parsed.data,
        id: fixtureId(1),
        credentialRef: parsed.data.credentialRef ?? null,
        createdAt: fixtureDate,
      };
      repos.push(repo);
      return HttpResponse.json(repo, { status: 201 });
    }),
    http.get(C.apis.path, () => HttpResponse.json(apis)),
    http.post(C.apis.path, async ({ request }) => {
      const parsed = C.apis.POST.request.safeParse(await request.json());
      if (!parsed.success)
        return HttpResponse.json(
          parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          { status: 400 },
        );
      const item = {
        id: fixtureId(2),
        name: parsed.data.name,
        specSourceUrl: parsed.data.specSourceUrl ?? null,
        pollIntervalSeconds: null,
        baselineVersionId: fixtureId(6),
        createdAt: fixtureDate,
      };
      apis.push(item);
      return HttpResponse.json(item, { status: 201 });
    }),
    http.get(C.checks.path, () => HttpResponse.json(checks)),
    http.post(C.specs.path, async ({ request }) => {
      const text = await request.text();
      uploaded++;
      const outcome = text.includes('invalid')
        ? { value: 'failed', label: 'Check failed' }
        : uploaded === 1
          ? { value: 'baseline_established', label: 'Baseline established' }
          : { value: 'changed', label: 'Changed' };
      const check = {
        id: fixtureId(50 + uploaded),
        apiId: fixtureId(2),
        startedAt: fixtureDate,
        finishedAt: fixtureDate,
        outcome,
        specVersionId: fixtureId(uploaded === 1 ? 6 : 7),
        errorDetail: outcome.value === 'failed' ? 'Invalid specification' : null,
      };
      checks.push(C.checks.GET.response.parse([check])[0]!);
      return HttpResponse.json({
        check,
        baselineVersionId: fixtureId(6),
        sourceMode: { value: 'uploaded', label: 'Uploaded' },
      });
    }),
    http.post(C.check.path, () =>
      HttpResponse.json({
        check: {
          id: fixtureId(60),
          apiId: fixtureId(2),
          startedAt: fixtureDate,
          finishedAt: fixtureDate,
          outcome: { value: 'no_change', label: 'No change' },
          specVersionId: fixtureId(7),
          errorDetail: null,
        },
        baselineVersionId: fixtureId(6),
        sourceMode: { value: 'retrieved', label: 'Retrieved from URL' },
      }),
    ),
    http.post(C.migrationNotes.path, async ({ request }) =>
      HttpResponse.json({
        ...C.migrationNotes.POST.request.parse(await request.json()),
        id: fixtureId(8),
        apiId: fixtureId(2),
        parsed: { mappings: [] },
        uploadedAt: fixtureDate,
      }),
    ),
    http.get(C.changes.path, () => HttpResponse.json(uploaded >= 2 ? [change] : [])),
    http.post(C.confirmMapping.path, async ({ request }) => {
      const body = C.confirmMapping.POST.request.parse(await request.json());
      change = {
        ...change,
        mapping: body.mapping,
        mappingStatus: { value: 'confirmed', label: 'Mapping confirmed' },
        mappingSource: { value: 'human', label: 'Confirmed by a human' },
        confirmedBy: body.confirmedBy,
        confirmedAt: fixtureDate,
      };
      return HttpResponse.json(change);
    }),
    http.get(C.runs.path, () => HttpResponse.json(runs)),
    http.post(C.runs.path, async ({ request }) => {
      C.runs.POST.request.parse(await request.json());
      detail = { ...detail, change };
      runs.push(detail.run);
      return HttpResponse.json(detail.run, { status: 202 });
    }),
    http.get(C.run.path, () => HttpResponse.json(detail)),
    http.post(C.reanalyze.path, () => {
      detail = { ...detail, run: { ...detail.run, id: fixtureId(5), parentRunId: detail.run.id } };
      runs.push(detail.run);
      return HttpResponse.json(detail.run, { status: 202 });
    }),
    http.post(C.retryDelivery.path, () => HttpResponse.json(detail.run)),
    http.get(C.export.path, ({ request }) =>
      new URL(request.url).searchParams.get('format') === 'html'
        ? HttpResponse.html(
            '<!doctype html><html><title>Fixture run report</title><body><h1>Fixture run report</h1><p>Repaired (awaiting review)</p></body></html>',
          )
        : HttpResponse.json(detail),
    ),
    ...resultsHandlers,
  ];
}
