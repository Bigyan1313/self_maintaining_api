import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Errors, Field, LoadState, Status, fileText, useLoad, useMutation } from '../ui';
import type { ApiResponse, IngestResponse } from '@sma/core/api/contract';

function ApiActions({ item }: { item: ApiResponse }) {
  const action = useMutation();
  const history = useLoad(item.id, () => api.checks(item.id));
  const [result, setResult] = useState<IngestResponse>();
  const finish = (value: IngestResponse) => {
    setResult(value);
    history.reload();
  };
  return (
    <article className="card">
      <h3>{item.name}</h3>
      <p className="muted">{item.specSourceUrl ?? 'Uploaded specifications'}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void action.run(
            async () => api.upload(item.id, (await fileText(data, 'spec'))!.text),
            finish,
          );
        }}
      >
        <Field
          label={`Specification for ${item.name}`}
          name="spec"
          type="file"
          accept=".yaml,.yml,.json"
          errors={action.fields}
        />
        <button disabled={action.pending}>Upload spec</button>
        <button
          type="button"
          disabled={action.pending || !item.specSourceUrl}
          onClick={() => void action.run(() => api.check(item.id), finish)}
        >
          Check for changes
        </button>
      </form>
      <Errors error={action.error} />
      {result && (
        <p role="status">
          <Status state={result.check.outcome} />
          {result.check.errorDetail && `: ${result.check.errorDetail}`}
        </p>
      )}
      <Link to={`/changes?apiId=${item.id}`}>View changes</Link>
      <details>
        <summary>Check history and version IDs</summary>
        <LoadState loading={history.loading} error={history.error} retry={history.reload} />
        {history.data?.length === 0 && <p>No checks yet.</p>}
        <ul>
          {history.data?.map((check) => (
            <li key={check.id}>
              <Status state={check.outcome} /> · {check.startedAt}
              <br />
              <code>{check.specVersionId ?? 'No version recorded'}</code>
              {check.errorDetail && <p>{check.errorDetail}</p>}
            </li>
          ))}
        </ul>
      </details>
      <NoteForm apiId={item.id} />
    </article>
  );
}
function NoteForm({ apiId }: { apiId: string }) {
  const action = useMutation();
  return (
    <details>
      <summary>Attach migration note</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void action.run(
            async () =>
              api.note(apiId, {
                fromVersionId: String(d.get('fromVersionId')),
                toVersionId: String(d.get('toVersionId')),
                rawYaml: (await fileText(d, 'rawYaml'))!.text,
              }),
            () => action.setMessage('Migration note attached.'),
          );
        }}
      >
        <Field name="fromVersionId" label="Before version ID" required errors={action.fields} />
        <Field name="toVersionId" label="After version ID" required errors={action.fields} />
        <Field
          name="rawYaml"
          label="Migration note YAML"
          type="file"
          accept=".yaml,.yml"
          errors={action.fields}
        />
        <button disabled={action.pending}>Attach note</button>
        <Errors error={action.error} />
        <p role="status">{action.message}</p>
      </form>
    </details>
  );
}
/** Register repositories/APIs and manage specification checks through the shared contract. */
export function Configuration() {
  const repos = useLoad('repositories', api.repositories);
  const apis = useLoad('apis', api.apis);
  const repoAction = useMutation();
  const apiAction = useMutation();
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">WORKSPACE</p>
        <h1>Configuration</h1>
        <p>Connect a consumer repository and track the APIs it depends on.</p>
      </header>
      <div className="columns">
        <section className="card">
          <h2>Register repository</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void repoAction.run(
                () =>
                  api.registerRepository({
                    owner: String(d.get('owner')),
                    name: String(d.get('name')),
                    defaultBranch: String(d.get('defaultBranch')),
                    localPath: String(d.get('localPath')),
                    credentialRef: String(d.get('credentialRef')) || null,
                  }),
                () => {
                  repoAction.setMessage('Repository registered.');
                  repos.reload();
                },
              );
            }}
          >
            <Field name="owner" label="Owner" required errors={repoAction.fields} />
            <Field name="name" label="Repository name" required errors={repoAction.fields} />
            <Field
              name="defaultBranch"
              label="Default branch"
              defaultValue="main"
              required
              errors={repoAction.fields}
            />
            <Field
              name="localPath"
              label="Local repository path on server"
              required
              errors={repoAction.fields}
            />
            <Field
              name="credentialRef"
              label="Credential environment variable name"
              placeholder="GITHUB_TOKEN"
              errors={repoAction.fields}
            />
            <p className="muted">
              Enter the variable name only. Configure its secret value on the server.
            </p>
            <button disabled={repoAction.pending}>Register repository</button>
            <Errors error={repoAction.error} />
            <p role="status">{repoAction.message}</p>
          </form>
        </section>
        <section className="card">
          <h2>Register API</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void apiAction.run(
                async () => {
                  const file = await fileText(d, 'specText', false);
                  return api.registerApi({
                    name: String(d.get('name')),
                    specSourceUrl: String(d.get('specSourceUrl')) || null,
                    ...(file ? { specText: file.text, filename: file.filename } : {}),
                  });
                },
                () => {
                  apiAction.setMessage('API registered.');
                  apis.reload();
                },
              );
            }}
          >
            <Field name="name" label="API name" required errors={apiAction.fields} />
            <Field
              name="specSourceUrl"
              label="Specification URL"
              type="url"
              errors={apiAction.fields}
            />
            <p>Or upload an OpenAPI specification:</p>
            <Field
              name="specText"
              label="Initial specification file"
              type="file"
              accept=".yaml,.yml,.json"
              errors={apiAction.fields}
            />
            <button disabled={apiAction.pending}>Register API</button>
            <Errors error={apiAction.error} />
            <p role="status">{apiAction.message}</p>
          </form>
        </section>
      </div>
      <section>
        <h2>Repositories</h2>
        <LoadState loading={repos.loading} error={repos.error} retry={repos.reload} />
        {repos.data?.length === 0 && <p>No repositories registered yet.</p>}
        <ul className="repo-list">
          {repos.data?.map((r) => (
            <li key={r.id}>
              <strong>
                {r.owner}/{r.name}
              </strong>
              <span>
                {r.defaultBranch} · {r.localPath}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Tracked APIs</h2>
        <LoadState loading={apis.loading} error={apis.error} retry={apis.reload} />
        {apis.data?.length === 0 && <p>No APIs registered yet.</p>}
        <div className="cards">
          {apis.data?.map((item) => (
            <ApiActions key={item.id} item={item} />
          ))}
        </div>
      </section>
    </>
  );
}
