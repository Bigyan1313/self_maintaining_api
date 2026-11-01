import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the title and a healthy server label', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' })));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Self-Maintaining APIs' })).toBeTruthy();
    expect(await screen.findByText('Server: OK')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/health');
  });

  it('shows an unreachable label when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('down'))),
    );

    render(<App />);

    expect(await screen.findByText('Server: unreachable')).toBeTruthy();
  });
});
