import { setupWorker } from 'msw/browser';
import { fixtureHandlers, resultsHandlers } from './handlers';
/** Only explicit E2E fixture mode intercepts implemented API routes. */
export const worker = setupWorker(
  ...(import.meta.env.VITE_E2E_FIXTURES === 'true' ? fixtureHandlers() : resultsHandlers),
);
