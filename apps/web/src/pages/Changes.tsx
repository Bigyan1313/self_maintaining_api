import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ChangeResponse } from '@sma/core/api/contract';
import { api, ApiError } from '../api';
import { Errors, Evidence, Field, LoadState, Status, useLoad, useMutation } from '../ui';

/** Side-by-side specification evidence reused by changes and run detail. */
export function ChangeEvidence({ change }: { change: ChangeResponse }) {
  return (
    <section>
      <h2>Specification evidence</h2>
      <p>
        <strong>
          {change.method} {change.path}
        </strong>{' '}
        · {change.jsonPointer}
      </p>
      <div className="columns evidence">
        <div>
          <h3>Before</h3>
          <Evidence value={change.evidenceBefore} />
        </div>
        <div>
          <h3>After</h3>
          <Evidence value={change.evidenceAfter} />
        </div>
      </div>
    </section>
  );
}
function ConfirmDialog({
  change,
  close,
  saved,
}: {
  change: ChangeResponse;
  close: () => void;
  saved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const action = useMutation();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!action.pending) close();
      }}
      aria-labelledby="mapping-title"
    >
      <h2 id="mapping-title">Confirm mapping</h2>
      <p className="warning">
        Confirming this mapping allows the system to attempt a repair. Verify the provider's
        meaning; similar names alone are not evidence.
      </p>
      <p>
        {change.method} {change.path} · <Status state={change.category} />
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void action.run(
            async () => {
              let mapping: unknown;
              try {
                mapping = JSON.parse(String(d.get('mapping')));
              } catch {
                throw new ApiError([
                  { field: 'mapping', message: 'Mapping must be a JSON object.' },
                ]);
              }
              if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
                throw new ApiError([
                  { field: 'mapping', message: 'Mapping must be a JSON object.' },
                ]);
              return api.confirm(change.id, {
                mapping: mapping as Record<string, unknown>,
                confirmedBy: String(d.get('confirmedBy')),
              });
            },
            () => {
              saved();
              close();
            },
          );
        }}
      >
        <label className="field">
          Mapping JSON
          <textarea
            name="mapping"
            required
            rows={9}
            placeholder={
              '{"kind":"field_renamed","method":"GET","path":"/customers/{id}","location":"response","old":"customer_name","new":"full_name"}'
            }
            aria-describedby="mapping-help"
          />
        </label>
        <p id="mapping-help" className="muted">
          Supply the migration-note mapping object for this change. The server validates it against
          both specifications.
        </p>
        <Field name="confirmedBy" label="Confirmed by" required errors={action.fields} />
        <Errors error={action.error} />
        <div className="actions">
          <button disabled={action.pending}>Confirm and allow repair</button>
          <button type="button" className="secondary" disabled={action.pending} onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
function ChangeList({ apiId }: { apiId: string }) {
  const changes = useLoad(apiId, () => api.changes(apiId));
  const repos = useLoad('repositories', api.repositories);
  const [selected, setSelected] = useState<ChangeResponse>();
  const [confirm, setConfirm] = useState(false);
  const action = useMutation();
  const navigate = useNavigate();
  return (
    <>
      <LoadState loading={changes.loading} error={changes.error} retry={changes.reload} />
      {changes.data?.length === 0 && <p className="empty">No changes recorded for this API.</p>}
      {!!changes.data?.length && (
        <div className="table-wrap">
          <table>
            <caption>Detected changes</caption>
            <thead>
              <tr>
                <th>Operation</th>
                <th>Category</th>
                <th>Classification</th>
                <th>Confidence</th>
                <th>Mapping</th>
                <th>Source</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {changes.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.method} {c.path}
                  </td>
                  <td>
                    <Status state={c.category} />
                  </td>
                  <td>
                    <Status state={c.classification} />
                  </td>
                  <td>{Math.round(c.confidence * 100)}%</td>
                  <td>
                    <Status state={c.mappingStatus} />
                  </td>
                  <td>
                    {c.mappingSource ? <Status state={c.mappingSource} /> : 'No confirmation'}
                  </td>
                  <td>
                    <button className="secondary" onClick={() => setSelected(c)}>
                      View evidence
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <article className="card">
          <ChangeEvidence change={selected} />
          {selected.mappingStatus.value === 'unconfirmed' && (
            <button onClick={() => setConfirm(true)}>Confirm mapping</button>
          )}
          {selected.confirmedBy && (
            <p>
              Confirmed by {selected.confirmedBy} · {selected.confirmedAt}
            </p>
          )}
          <h3>Start a run</h3>
          <LoadState loading={repos.loading} error={repos.error} retry={repos.reload} />
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void action.run(
                () =>
                  api.start({ changeId: selected.id, repositoryId: String(d.get('repositoryId')) }),
                (run) => navigate(`/runs/${run.id}`),
              );
            }}
          >
            <label className="field">
              Consumer repository
              <select name="repositoryId" required defaultValue="">
                <option value="" disabled>
                  Choose a repository
                </option>
                {repos.data?.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.owner}/{r.name}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={action.pending || !repos.data?.length}>Start run</button>
          </form>
          <Errors error={action.error} />
          <p className="muted">
            Unconfirmed mappings can be analyzed, but the server will not repair them.
          </p>
          {confirm && (
            <ConfirmDialog
              change={selected}
              close={() => setConfirm(false)}
              saved={() => {
                setSelected(undefined);
                changes.reload();
              }}
            />
          )}
        </article>
      )}
    </>
  );
}
/** Review labeled differences per API, inspect evidence, confirm mappings, and start runs. */
export function Changes() {
  const apis = useLoad('apis', api.apis);
  const [params, setParams] = useSearchParams();
  const id = params.get('apiId') ?? '';
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">DETECT & REVIEW</p>
        <h1>Changes</h1>
        <p>Understand the API change before authorizing a repair.</p>
      </header>
      <LoadState loading={apis.loading} error={apis.error} retry={apis.reload} />
      <label className="field selector">
        API
        <select value={id} onChange={(e) => setParams({ apiId: e.target.value })}>
          <option value="">Choose an API</option>
          {apis.data?.map((a) => (
            <option value={a.id} key={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {id ? (
        <ChangeList key={id} apiId={id} />
      ) : (
        <p className="empty">Choose an API to review its changes.</p>
      )}
    </>
  );
}
