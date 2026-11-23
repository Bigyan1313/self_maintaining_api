import { BASELINE_LABELS, CHANGE_CATEGORY_LABELS, GUARD_NAME_LABELS } from '@sma/core/domain/enums';
import { api, ApiError } from '../api';
import { LoadState, Status, money, useLoad } from '../ui';
const rate = (value: number | null) =>
  value === null ? 'Not reported' : `${(value * 100).toFixed(1)}%`;
const duration = (value: number | null) =>
  value === null ? 'Not reported' : `${(value / 1000).toFixed(2)} s`;
/** Present server-computed evaluation metrics; absence is never interpreted as zero. */
export function Results() {
  const data = useLoad('results', api.results);
  const d = data.data;
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">EVALUATION</p>
        <h1>Results</h1>
        <p>Compare the same frozen scenarios across all three baselines.</p>
      </header>
      {data.error instanceof ApiError && data.error.status === 404 ? (
        <p className="notice">Evaluation results are not available yet. Waiting on Increment 16.</p>
      ) : (
        <LoadState loading={data.loading} error={data.error} retry={data.reload} />
      )}
      {d && (!d.label || d.results.length === 0) ? (
        <p className="empty">No evaluation results yet.</p>
      ) : (
        d && (
          <>
            <h2>{d.label}</h2>
            {d.results.some((r) => r.isPartial) && (
              <p className="warning">Partial results — some scenarios have not completed.</p>
            )}
            {!d.summaries?.length && (
              <p className="notice">Summary metrics have not been reported by the server.</p>
            )}
            {d.summaries?.map((s) => (
              <section className="card" key={s.baseline}>
                <h2>{BASELINE_LABELS[s.baseline]}</h2>
                <dl className="facts metrics">
                  <div>
                    <dt>Detection precision</dt>
                    <dd>{rate(s.detectionPrecision)}</dd>
                  </div>
                  <div>
                    <dt>Detection recall</dt>
                    <dd>{rate(s.detectionRecall)}</dd>
                  </div>
                  <div>
                    <dt>Overall repair rate</dt>
                    <dd>{rate(s.repairRate)}</dd>
                  </div>
                  <div>
                    <dt>Refusal correctness</dt>
                    <dd>{rate(s.refusalCorrectness)}</dd>
                  </div>
                  <div>
                    <dt>False confidence</dt>
                    <dd>{rate(s.falseConfidence)}</dd>
                  </div>
                  <div>
                    <dt>Cost per repair</dt>
                    <dd>{money(s.costPerRepairUsd)}</dd>
                  </div>
                  <div>
                    <dt>Time per repair</dt>
                    <dd>{duration(s.timePerRepairMs)}</dd>
                  </div>
                  <div>
                    <dt>Model time per repair</dt>
                    <dd>{duration(s.modelTimePerRepairMs)}</dd>
                  </div>
                  <div>
                    <dt>Container time per repair</dt>
                    <dd>{duration(s.containerTimePerRepairMs)}</dd>
                  </div>
                </dl>
                <div className="columns">
                  <table>
                    <caption>Repair rate by change category</caption>
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Repair rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.repairRateByCategory.map((c) => (
                        <tr key={c.category}>
                          <td>{CHANGE_CATEGORY_LABELS[c.category]}</td>
                          <td>{rate(c.rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div>
                    <table>
                      <caption>Attempts distribution</caption>
                      <thead>
                        <tr>
                          <th>Attempts</th>
                          <th>Scenarios</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.attemptsDistribution.map((a) => (
                          <tr key={a.attempts}>
                            <td>{a.attempts}</td>
                            <td>{a.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <table>
                      <caption>Cheat rejections by guard</caption>
                      <thead>
                        <tr>
                          <th>Guard</th>
                          <th>Rejected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.cheatRejections.map((g) => (
                          <tr key={g.guard}>
                            <td>{GUARD_NAME_LABELS[g.guard]}</td>
                            <td>{g.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ))}
            <section className="card">
              <h2>Failed scenarios</h2>
              {d.failures === undefined ? (
                <p>Failure scoring has not been reported by the server.</p>
              ) : d.failures.length === 0 ? (
                <p>No failed scenarios reported.</p>
              ) : (
                <ul>
                  {d.failures.map((f, i) => (
                    <li key={i}>
                      <strong>{f.scenarioId}</strong> · {BASELINE_LABELS[f.baseline]}: {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <h2>Scenario outcomes and failures</h2>
              <p>Excluded and unreviewed outcomes remain visible.</p>
              <div className="table-wrap">
                <table>
                  <caption>All scenario outcomes, including failed scenarios</caption>
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Baseline</th>
                      <th>Outcome</th>
                      <th>Human review</th>
                      <th>Attempts</th>
                      <th>Cost / time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.results.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.scenarioId}
                          {r.isPartial && <small>Partial results</small>}
                          {r.excluded && (
                            <small className="warning">
                              Excluded: {r.exclusionReason ?? 'Reason not reported'}
                            </small>
                          )}
                        </td>
                        <td>
                          <Status state={r.baseline} />
                        </td>
                        <td>
                          <Status state={r.outcome} />
                        </td>
                        <td>
                          <Status state={r.reviewVerdict} />
                        </td>
                        <td>{r.attemptsUsed}</td>
                        <td>
                          {money(r.costUsd)} / {duration(r.durationMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      )}
    </>
  );
}
