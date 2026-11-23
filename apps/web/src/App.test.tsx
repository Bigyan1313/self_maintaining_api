import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DOMAIN_ENUMS } from '@sma/core/domain/enums';
import { API_CONTRACT } from '@sma/core/api/contract';
import { api, ApiError, request, downloadReport } from './api';
import { Field, Status } from './ui';
import { RunDetailPage, safeLink } from './pages/Runs';
import { Results } from './pages/Results';
import { fixtureDetail, fixtureResults } from './mocks/fixtures';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('text labels for every shared enum (UI-02)', () => {
  for (const [name, group] of Object.entries(DOMAIN_ENUMS))
    for (const value of group.values) {
      const label = (group.labels as Record<string, string>)[value]!;
      it(`${name}.${value} has visible text`, () => {
        render(<Status state={{ value, label }} />);
        expect(screen.getByText(label)).toBeTruthy();
      });
    }
});
it('binds a field-level error to its input', () => {
  render(
    <Field
      name="localPath"
      label="Local path"
      errors={[{ field: 'localPath', message: 'Path is unreachable' }]}
    />,
  );
  const input = screen.getByLabelText('Local path');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
    'Path is unreachable',
  );
});
it('rejects a successful HTTP response with invalid contract data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  await expect(request('/api/runs', API_CONTRACT.runs.GET.response)).rejects.toThrow(
    'does not match',
  );
});
it('preserves server field errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([{ field: 'name', message: 'Missing name' }]), { status: 400 }),
      ),
  );
  await expect(api.registerApi({ name: '' })).rejects.toMatchObject({
    fields: [{ field: 'name', message: 'Missing name' }],
  });
});
it('reports connection failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(api.runs()).rejects.toThrow('Cannot reach');
});
it('never navigates to script URLs from evidence', () => {
  expect(safeLink('javascript:alert(1)')).toBeUndefined();
  expect(safeLink('data:text/html,bad')).toBeUndefined();
  expect(safeLink('https://github.com/a/b/pull/1')).toBe('https://github.com/a/b/pull/1');
});
function runPage() {
  return render(
    <MemoryRouter initialEntries={['/runs/test']}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
it('renders all run evidence and hides retry after successful delivery', async () => {
  vi.spyOn(api, 'detail').mockResolvedValue(structuredClone(fixtureDetail));
  runPage();
  expect(await screen.findByText('Mapping confirmation')).toBeTruthy();
  expect(screen.getByText('src/customer.ts:12:3')).toBeTruthy();
  expect(screen.getByText('Excluded dependency directory')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open pull request' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry delivery' })).toBeNull();
  expect(screen.getByText('Validation output — attempt 1')).toBeTruthy();
});
it.each(['deliver', 'validate'] as const)(
  'only allows delivery retry for delivery failure (%s)',
  async (stage) => {
    const d = structuredClone(fixtureDetail);
    d.run.status = { value: 'stage_failure', label: 'Stage failure' };
    d.run.failureStage = { value: stage, label: stage === 'deliver' ? 'Deliver' : 'Validate' };
    d.run.prUrl = null;
    d.run.failureDetail = 'Fixture failure';
    vi.spyOn(api, 'detail').mockResolvedValue(d);
    runPage();
    await screen.findByText('Mapping confirmation');
    expect(Boolean(screen.queryByRole('button', { name: 'Retry delivery' }))).toBe(
      stage === 'deliver',
    );
    expect(screen.getByText(/No pull request:/)).toBeTruthy();
  },
);
it('renders server summaries, exclusions, failures and partial labels', async () => {
  vi.spyOn(api, 'results').mockResolvedValue(fixtureResults);
  render(<Results />);
  expect(await screen.findByText('Failed scenarios')).toBeTruthy();
  expect(screen.getAllByText('Repair rate by change category')).toHaveLength(3);
  expect(screen.getByText(/Excluded: Example/)).toBeTruthy();
  expect(screen.getAllByText('False confidence')).toHaveLength(3);
});
it('shows no-results state without inventing metrics', async () => {
  vi.spyOn(api, 'results').mockResolvedValue({ label: null, results: [] });
  render(<Results />);
  expect(await screen.findByText('No evaluation results yet.')).toBeTruthy();
});
it('distinguishes the unimplemented results route from a network failure', async () => {
  vi.spyOn(api, 'results').mockRejectedValue(
    new ApiError([{ field: 'route', message: 'Route not found' }], 404),
  );
  render(<Results />);
  expect(await screen.findByText(/Waiting on Increment 16/)).toBeTruthy();
});

it('shows a failed export instead of saving an error page', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
  await expect(downloadReport('id', 'html')).rejects.toThrow('Export failed (503)');
});
it('does not treat a failed spec check as no change', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            check: {
              id: '00000000-0000-4000-8000-000000000001',
              apiId: '00000000-0000-4000-8000-000000000002',
              startedAt: '2026-11-23T12:00:00Z',
              finishedAt: null,
              outcome: { value: 'failed', label: 'Check failed' },
              specVersionId: null,
              errorDetail: 'Invalid OpenAPI',
            },
            baselineVersionId: null,
            sourceMode: { value: 'uploaded', label: 'Uploaded' },
          }),
          { status: 422 },
        ),
      ),
  );
  await expect(api.upload('id', 'invalid')).rejects.toThrow('Check failed: Invalid OpenAPI');
});
