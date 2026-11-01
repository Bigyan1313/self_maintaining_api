import { useEffect, useState } from 'react';

/** Server reachability as shown on the page. Always rendered as text (FR-42). */
export type HealthState = 'checking' | 'ok' | 'unreachable';

const LABELS: Record<HealthState, string> = {
  checking: 'Checking server…',
  ok: 'Server: OK',
  unreachable: 'Server: unreachable',
};

/** Landing page: shows the project name and the result of `GET /health`. */
export function App() {
  const [health, setHealth] = useState<HealthState>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch('/health')
      .then(async (res) => {
        const body: unknown = res.ok ? await res.json() : null;
        const isOk =
          typeof body === 'object' &&
          body !== null &&
          (body as { status?: unknown }).status === 'ok';
        if (!cancelled) setHealth(isOk ? 'ok' : 'unreachable');
      })
      .catch(() => {
        if (!cancelled) setHealth('unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>Self-Maintaining APIs</h1>
      <p role="status">{LABELS[health]}</p>
    </main>
  );
}
