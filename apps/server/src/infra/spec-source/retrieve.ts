import { MAX_SPEC_BYTES, err, ok, type Result, type SpecError } from '@sma/core';
import { allowedSpecUrl } from './security.js';

/** Retrieval result is text only: fetched documents are never executed or dereferenced. */
export type SpecRetriever = (url: string) => Promise<Result<string, SpecError>>;
/** Bounded retrieval, including the entire streamed body and all redirects in the deadline. */
export async function retrieveSpec(
  url: string,
  options: { timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<Result<string, SpecError>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    let current = url;
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!allowedSpecUrl(current))
        return err({
          code: 'unreachable',
          message: 'Source URL must use HTTPS or local demo HTTP, without credentials',
        });
      const response = await (options.fetch ?? fetch)(current, {
        signal: controller.signal,
        redirect: 'manual',
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) break;
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return err({ code: 'unreachable', message: `Source returned HTTP ${response.status}` });
      }
      if (Number(response.headers.get('content-length')) > MAX_SPEC_BYTES) {
        await response.body?.cancel();
        return err({ code: 'too_large', message: 'Specification exceeds 5 MiB' });
      }
      if (!response.body) return ok('');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_SPEC_BYTES) {
          await reader.cancel();
          return err({ code: 'too_large', message: 'Specification exceeds 5 MiB' });
        }
        chunks.push(chunk.value);
      }
      return ok(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    }
    return err({
      code: 'unreachable',
      message: 'Source redirect limit exceeded or invalid redirect',
    });
  } catch {
    return err({
      code: controller.signal.aborted ? 'timeout' : 'unreachable',
      message: controller.signal.aborted
        ? 'Specification retrieval timed out'
        : 'Cannot retrieve specification',
    });
  } finally {
    clearTimeout(timer);
  }
}
