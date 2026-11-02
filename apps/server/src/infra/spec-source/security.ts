/** Redact configured credentials and recognizable tokens without ever returning their values. */
export function redact(text: string): string {
  let safe = text;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && /TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL/i.test(key))
      safe = safe.split(value).join('[REDACTED]');
  }
  return safe.replace(
    /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9_-]+)\b/g,
    '[REDACTED]',
  );
}
/** Reject credential-bearing input before persistence, not just before serialization. */
export function containsCredential(value: string): boolean {
  return redact(value) !== value;
}
/** Supported source URL; credentials/fragments are never accepted. Redirects use the same policy. */
export function allowedSpecUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      !containsCredential(value) &&
      ![...url.searchParams.keys()].some((k) =>
        /token|secret|password|api[-_]?key|authorization/i.test(k),
      ) &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
