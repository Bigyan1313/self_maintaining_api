import { isRepairSourcePath } from './context.js';

/** Parsed model response, before adapter usage/cost metadata is attached. */
export type RepairOutput =
  | { kind: 'patch'; patch: string }
  | { kind: 'refusal'; reason: string }
  | { kind: 'invalid_output'; message: string };
const invalid = (): RepairOutput => ({
  kind: 'invalid_output',
  message: 'Expected a complete unified diff modifying only listed source files, or REFUSE: reason',
});

/** Strict text-only unified-diff parser. It does not apply or execute patches. */
export function parseRepairOutput(text: string, includedFiles: readonly string[]): RepairOutput {
  let output = text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
  if (output.startsWith('REFUSE:')) {
    const reason = output.slice(7).trim();
    return reason ? { kind: 'refusal', reason } : invalid();
  }
  if (output.startsWith('```')) {
    const fence = /^```(?:diff|patch)?\n([\s\S]*)\n```$/.exec(output);
    if (!fence) return invalid();
    output = fence[1]!.replace(/\n+$/g, '');
  }
  const allowed = new Set(includedFiles.filter(isRepairSourcePath));
  const lines = output.split('\n');
  const seen = new Set<string>();
  let i = 0;
  let changes = 0;
  while (i < lines.length) {
    let gitPath: string | undefined;
    if (lines[i]!.startsWith('diff --git ')) {
      const header = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[i++]!);
      if (!header || header[1] !== header[2]) return invalid();
      gitPath = header[1];
      if (lines[i]?.startsWith('index ')) {
        if (!/^index [a-f0-9]+\.\.[a-f0-9]+(?: 100644)?$/.test(lines[i++]!)) return invalid();
      }
    }
    const old = /^--- a\/(.+)$/.exec(lines[i++] ?? '');
    const next = /^\+\+\+ b\/(.+)$/.exec(lines[i++] ?? '');
    const path = old?.[1];
    if (
      !path ||
      next?.[1] !== path ||
      (gitPath && gitPath !== path) ||
      !allowed.has(path) ||
      seen.has(path)
    )
      return invalid();
    seen.add(path);
    let hunks = 0;
    while (lines[i]?.startsWith('@@ ')) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(lines[i++]!);
      if (!hunk) return invalid();
      let before = Number(hunk[2] ?? 1);
      let after = Number(hunk[4] ?? 1);
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before + after === 0)
        return invalid();
      hunks++;
      while (before > 0 || after > 0) {
        const line = lines[i++];
        if (line === undefined) return invalid();
        if (line === '\\ No newline at end of file') continue;
        if (line.startsWith(' ')) {
          before--;
          after--;
        } else if (line.startsWith('-')) {
          before--;
          changes++;
        } else if (line.startsWith('+')) {
          after--;
          changes++;
        } else return invalid();
        if (before < 0 || after < 0) return invalid();
      }
      if (lines[i] === '\\ No newline at end of file') i++;
    }
    if (!hunks) return invalid();
  }
  return seen.size && changes ? { kind: 'patch', patch: output + '\n' } : invalid();
}
