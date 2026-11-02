import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repo-root `.env` into `process.env` when the file exists (local development).
 * In CI the variables come from the environment instead. Values are never printed.
 */
export function loadRootEnv(): void {
  const envFile = fileURLToPath(new URL('../../../../../.env', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
