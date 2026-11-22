import { redactRepairSecrets } from '../repair/context.js';

/** What replaces every redacted value. */
export const REDACTED = '[REDACTED]';

const AUTH_HEADER = /\b(authorization\s*[:=]\s*["']?)(?:token|bearer|basic)\s+[^\s"',;}]+/gi;
const URL_CREDENTIALS = /\b(https?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi;

/**
 * Removes credentials from text that leaves the system: PR titles and bodies, delivery errors,
 * and stored failure details (NFR-04).
 *
 * Redacts every exact `knownSecrets` value (for example the token actually in use), then
 * recognisable token shapes (`ghp_…`, `github_pat_…`, `sk-ant-…`, `AKIA…`, private keys,
 * `password=`), `Authorization: token …` headers, and `user:pass@` in URLs. Pure: no
 * environment or filesystem access.
 * @param text - Text to clean.
 * @param knownSecrets - Exact secret values to remove wherever they appear. Values shorter than
 *   four characters are ignored, so an empty or tiny value cannot blank the whole text.
 * @returns The cleaned text.
 */
export function redactForDelivery(text: string, knownSecrets: readonly string[] = []): string {
  let safe = text;
  const exact = [...new Set(knownSecrets.filter((s) => s.length >= 4))].sort(
    (a, b) => b.length - a.length,
  );
  for (const secret of exact) safe = safe.split(secret).join(REDACTED);
  safe = safe.replace(AUTH_HEADER, (_m, prefix: string) => `${prefix}${REDACTED}`);
  safe = safe.replace(URL_CREDENTIALS, (_m, scheme: string) => `${scheme}${REDACTED}@`);
  return redactRepairSecrets(safe).text;
}
