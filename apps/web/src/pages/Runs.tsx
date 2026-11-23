import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, downloadReport } from '../api';
import { Errors, Evidence, LoadState, Status, money, useLoad, useMutation } from '../ui';
import { ChangeEvidence } from './Changes';

/** Run history is server state, including explicit fixture and failure labels. */
export function Runs() {
  const runs = useLoad('runs', api.runs);
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">PIPELINE HISTORY</p>
        <h1>Runs</h1>
        <p>Every attempt, result, and delivery remains recorded.</p>
        <button className="secondary" onClick={runs.reload}>
          Refresh runs
        </button>
      </header>
      <LoadState loading={runs.loading} error={runs.error} retry={runs.reload} />
      {runs.data?.length === 0 && <p className="empty">No runs yet. Start one from Changes.</p>}
      {!!runs.data?.length && (
        <div className="table-wrap">
          <table>
            <caption>Recorded runs</caption>
            <thead>
              <tr>
                <th>Run / change / repository</th>
                <th>Status</th>
                <th>Stage reached</th>
                <th>Attempts</th>
                <th>Cost</th>
                <th>Started / finished</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/runs/${r.id}`}>{r.id}</Link>
                    {r.isFixture && <span className="fixture">FIXTURE</span>}
                    <small>Change: {r.changeId}</small>
                    <small>Repository: {r.repositoryId}</small>
                  </td>
                  <td>
                    <Status state={r.status} />
                  </td>
                  <td>
                    <Status state={r.stageReached} />
                  </td>
                  <td>{r.attemptCount}/4</td>
                  <td>{money(r.costUsd)}</td>
                  <td>
                    {r.startedAt}
                    <small>{r.finishedAt ?? 'In progress'}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
/** Only HTTP(S) links may navigate out of recorded, potentially untrusted evidence. */
export function safeLink(value: string | null): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) return url.href;
  } catch {
    return;
  }
  return;
}
/** Complete UI-03 evidence, bounded retries, exports, and running-state polling. */
export function RunDetailPage() {
  const { id = '' } = useParams();
  const detail = useLoad(id, () => api.detail(id));
  const action = useMutation();
  const navigate = useNavigate();
  const d = detail.data;
  // Poll only while this run is active, without replacing recorded data with invented progress.
  // A separate effect is avoided by the refresh component below.
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">RECORDED EVIDENCE</p>
        <h1>Run detail</h1>
        <Link to="/runs">← All runs</Link>
      </header>
      <LoadState loading={detail.loading} error={detail.error} retry={detail.reload} />
      {d && (
        <>
          {d.run.status.value === 'running' && <Poll refresh={detail.reload} />}
          <section className="card">
            <div className="actions">
              <Status state={d.run.status} />
              {d.run.isFixture && <span className="fixture">FIXTURE — demonstration run</span>}
              <span>
                Stage reached: <Status state={d.run.stageReached} />
              </span>
            </div>
            <p>
              <code>{d.run.id}</code>
            </p>
            <dl className="facts">
              <div>
                <dt>Commit</dt>
                <dd>{d.run.commitSha}</dd>
              </div>
              <div>
                <dt>Attempts</dt>
                <dd>{d.run.attemptCount}/4</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>{money(d.run.costUsd)}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{d.run.modelId ?? 'Not used'}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{d.run.startedAt}</dd>
              </div>
              <div>
                <dt>Finished</dt>
                <dd>{d.run.finishedAt ?? 'In progress'}</dd>
              </div>
            </dl>
            {d.run.failureDetail && (
              <p role="alert">
                {d.run.failureStage?.label}: {d.run.failureDetail}
              </p>
            )}
            {safeLink(d.run.prUrl) ? (
              <p>
                <a href={safeLink(d.run.prUrl)} target="_blank" rel="noreferrer">
                  Open pull request
                </a>{' '}
                · Awaiting human review
              </p>
            ) : (
              <p className="notice">
                No pull request:{' '}
                {d.run.flaggedReason ??
                  d.run.failureDetail ??
                  (d.run.status.value === 'running'
                    ? 'Run is still in progress.'
                    : d.run.prUrl
                      ? 'Recorded PR URL is not a safe HTTP link.'
                      : 'No delivery recorded for this run.')}
              </p>
            )}
            <div className="actions">
              <button
                disabled={action.pending || d.run.status.value === 'running'}
                onClick={() =>
                  void action.run(
                    () => api.reanalyze(id),
                    (r) => navigate(`/runs/${r.id}`),
                  )
                }
              >
                Reanalyze
              </button>
              {d.run.failureStage?.value === 'deliver' &&
                d.run.status.value === 'stage_failure' && (
                  <button
                    disabled={action.pending}
                    onClick={() =>
                      void action.run(
                        () => api.retry(id),
                        () => detail.reload(),
                      )
                    }
                  >
                    Retry delivery
                  </button>
                )}
              <button
                className="secondary"
                disabled={action.pending}
                onClick={() => void action.run(() => downloadReport(id, 'json'))}
              >
                Export JSON
              </button>
              <button
                className="secondary"
                disabled={action.pending}
                onClick={() => void action.run(() => downloadReport(id, 'html'))}
              >
                Export HTML
              </button>
            </div>
            <Errors error={action.error} />
          </section>
          <article className="card">
            <ChangeEvidence change={d.change} />
            <h2>Mapping confirmation</h2>
            <Status state={d.change.mappingStatus} />
            {d.change.mappingSource && <Status state={d.change.mappingSource} />}
            <Evidence value={d.change.mapping} />
            {d.migrationNote ? (
              <>
                <p>
                  Migration note {d.migrationNote.id} · uploaded {d.migrationNote.uploadedAt}
                </p>
                <p>
                  Versions: {d.migrationNote.fromVersionId} → {d.migrationNote.toVersionId}
                </p>
                <Evidence value={d.migrationNote.rawYaml} />
              </>
            ) : d.change.confirmedBy ? (
              <p>
                Confirmed by {d.change.confirmedBy} at {d.change.confirmedAt}
              </p>
            ) : (
              <p>No mapping confirmation recorded.</p>
            )}
          </article>
          <section className="card">
            <h2>Call sites</h2>
            {d.callSites.length === 0 && <p>No supported call sites recorded.</p>}
            {d.callSites.map((c) => (
              <div key={c.id}>
                <h3>
                  {c.filePath}:{c.line}:{c.column}
                </h3>
                <Status state={c.pattern} />
                <Evidence value={c.excerpt} />
              </div>
            ))}
            <h2>Coverage</h2>
            <div className="table-wrap">
              <table>
                <caption>Inspected and skipped files</caption>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Inspection</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {d.coverage.map((c) => (
                    <tr key={c.id}>
                      <td>{c.filePath}</td>
                      <td>{c.inspected ? 'Inspected' : 'Skipped'}</td>
                      <td>{c.skipReason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h2>Attempts</h2>
            {d.attempts.length === 0 ? (
              <p>No repair attempts recorded.</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <caption>Validation and model usage</caption>
                    <thead>
                      <tr>
                        <th>Attempt</th>
                        <th>Outcome / guard</th>
                        <th>Tests passed / total</th>
                        <th>Compile errors</th>
                        <th>Tokens in / out</th>
                        <th>Cost</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.attempts.map((a) => (
                        <tr key={a.id}>
                          <td>{a.attemptNumber}</td>
                          <td>
                            <Status state={a.outcome} />
                            {a.guardName && <Status state={a.guardName} />}
                          </td>
                          <td>
                            {a.testsPassed ?? '—'} / {a.testsTotal ?? '—'}
                          </td>
                          <td>{a.compileErrors ?? '—'}</td>
                          <td>
                            {a.tokensIn} / {a.tokensOut}
                          </td>
                          <td>{money(a.costUsd)}</td>
                          <td>{a.durationMs} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.attempts.map((a) => (
                  <div key={a.id}>
                    <h3>Attempt {a.attemptNumber}: patch</h3>
                    <Diff patch={a.patch} />
                    <details>
                      <summary>Validation output — attempt {a.attemptNumber}</summary>
                      <Evidence value={a.validationOutput ?? 'No validation output recorded'} />
                    </details>
                  </div>
                ))}
              </>
            )}
          </section>
          <section className="card">
            <h2>Recorded stages</h2>
            {d.stageResults.map((s) => (
              <details key={s.id}>
                <summary>
                  {s.stage.label} · {s.status.label}
                </summary>
                <p>
                  {s.startedAt} → {s.finishedAt}
                </p>
                <Evidence value={s.result} />
              </details>
            ))}
          </section>
        </>
      )}
    </>
  );
}
import { useEffect, useRef } from 'react';
function Poll({ refresh }: { refresh: () => void }) {
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    const timer = setTimeout(() => callback.current(), 3000);
    return () => clearTimeout(timer);
  }, []);
  return <p role="status">Run in progress. Refreshing recorded evidence automatically…</p>;
}
function Diff({ patch }: { patch: string }) {
  return (
    <pre className="diff" aria-label="Unified patch">
      {patch
        ? patch.split('\n').map((line, i) => (
            <span
              key={i}
              className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}
            >
              {line}
              {'\n'}
            </span>
          ))
        : 'No patch recorded'}
    </pre>
  );
}
