import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { ApiError } from './api';
import type { FieldErrors } from '@sma/core/api/contract';

/** Text is always present; colour is supplementary (FR-42). */
export function Status({ state }: { state: { value: string; label: string } }) {
  return <span className={`status status-${state.value}`}>{state.label}</span>;
}
/** Present arbitrary server evidence as escaped text, never HTML. */
export function Evidence({ value }: { value: unknown }) {
  return (
    <pre>
      {typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? 'Not recorded')}
    </pre>
  );
}
/** Labelled form field with server errors bound by aria-describedby. */
export function Field({
  label,
  errors = [],
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; errors?: FieldErrors }) {
  const id = useId();
  const error = errors.filter((e) => e.field === props.name);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        aria-invalid={error.length > 0}
        aria-describedby={error.length ? `${id}-error` : undefined}
      />
      {error.length > 0 && (
        <span className="field-error" id={`${id}-error`}>
          {error.map((e) => e.message).join('; ')}
        </span>
      )}
    </div>
  );
}
/** Request errors remain visible and actionable. */
export function Errors({ error }: { error: Error | null }) {
  return error ? (
    <div role="alert" className="error">
      {error.message}
    </div>
  ) : null;
}
/** Loading, error, empty, and ready are separate visible states. */
export function LoadState({
  loading,
  error,
  retry,
  children,
}: {
  loading: boolean;
  error: Error | null;
  retry: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      {loading && <p role="status">Loading…</p>}
      <Errors error={error} />
      {error && <button onClick={retry}>Retry loading</button>}
      {children}
    </>
  );
}
/** Load server state with stale-request protection and optional polling. */
export function useLoad<T>(key: string, loader: () => Promise<T>, poll = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const fn = useRef(loader);
  fn.current = loader;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setData(undefined);
    fn.current()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e: Error) => {
        if (active) setError(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key, revision]);
  useEffect(() => {
    if (!poll) return;
    const timer = setInterval(() => setRevision((n) => n + 1), poll);
    return () => clearInterval(timer);
  }, [poll]);
  return { data, error, loading, reload: () => setRevision((n) => n + 1) };
}
/** Keep mutation feedback separate from background loading; prevent duplicate submissions. */
export function useMutation() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  async function run<T>(task: () => Promise<T>, done?: (value: T) => void) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setMessage('');
    try {
      const value = await task();
      done?.(value);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Request failed'));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    pending,
    error,
    message,
    setMessage,
    run,
    fields: error instanceof ApiError ? error.fields : [],
  };
}
/** Read an uploaded UTF-8 document with a bounded browser-side size check. */
export async function fileText(
  data: FormData,
  name: string,
  required = true,
): Promise<{ text: string; filename: string } | undefined> {
  const file = data.get(name);
  if (!(file instanceof File) || !file.size) {
    if (required) throw new ApiError([{ field: name, message: 'Choose a non-empty file.' }]);
    return;
  }
  if (file.size > 5 * 1024 * 1024)
    throw new ApiError([{ field: name, message: 'File exceeds 5 MiB.' }]);
  return { text: await file.text(), filename: file.name };
}
/** Display monetary values without modifying their server-provided meaning. */
export const money = (value: string | number | null) =>
  value === null ? 'Not reported' : `$${Number(value).toFixed(4)}`;
