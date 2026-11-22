/**
 * Checks that the Mermaid diagrams in `docs/diagrams/` match the code (Increment 17a).
 *
 * Every function here is pure: file access is passed in as {@link ReadText}, so the checks can
 * be unit-tested without touching the repository.
 *
 * @packageDocumentation
 */

/** Reads a repository file as text, or returns `null` when it does not exist. */
export type ReadText = (repoRelativePath: string) => string | null;

/** One row of a "node → symbols → file" table under a diagram. */
export interface NodeRow {
  node: string;
  kind: string;
  symbols: string[];
  file: string;
}

/** A Mermaid block plus the PNG file named by the image link just above it. */
export interface MermaidBlock {
  source: string;
  /** Path from the `![..](png/NAME.png)` link before the block, if there is one. */
  png: string | null;
}

const FENCE = /```mermaid\n([\s\S]*?)\n```/g;

/**
 * Returns every ```` ```mermaid ```` block in a Markdown document, in order, with the PNG path of
 * the closest preceding image link.
 * @param markdown - The Markdown text.
 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const out: MermaidBlock[] = [];
  for (const m of markdown.matchAll(FENCE)) {
    const before = markdown.slice(0, m.index);
    const images = [...before.matchAll(/!\[[^\]]*\]\((png\/[^)]+\.png)\)/g)];
    out.push({ source: m[1]!, png: images.at(-1)?.[1] ?? null });
  }
  return out;
}

/** Text between backticks in a table cell, e.g. "`a` `b c`" → ["a", "b c"]. */
export function backticked(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

/**
 * Parses the class-diagram table: `| Node | Kind | Symbols checked | File |`.
 * @param markdown - The Markdown text.
 */
export function parseNodeTable(markdown: string): NodeRow[] {
  const rows: NodeRow[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').slice(1, -1);
    if (cells.length !== 4) continue;
    const [node, kind, symbols, file] = cells as [string, string, string, string];
    const name = backticked(node)[0];
    const path = backticked(file)[0];
    if (!name || !path) continue;
    rows.push({ node: name, kind: kind.trim(), symbols: backticked(symbols), file: path });
  }
  return rows;
}

/**
 * Class names declared in a Mermaid `classDiagram` block (`class Name {` or `class Name`).
 * @param source - The Mermaid source.
 */
export function classNodes(source: string): string[] {
  return [...source.matchAll(/^\s*class\s+([A-Za-z_][\w]*)/gm)].map((m) => m[1]!);
}

/**
 * Whether `symbol` occurs in `text` as a whole token (not as part of a longer identifier).
 * @param text - File contents.
 * @param symbol - Identifier or short phrase, e.g. `class CheckQueue`.
 */
export function containsSymbol(text: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}

/**
 * Checks the class diagram: every node has a table row, every row names a diagram node, every
 * file exists, and every listed symbol is in its file.
 * @param markdown - Contents of `class-diagram.md`.
 * @param read - File reader.
 * @returns Problems found; empty when the diagram matches the code.
 */
export function checkClassDiagram(markdown: string, read: ReadText): string[] {
  const problems: string[] = [];
  const blocks = extractMermaidBlocks(markdown);
  if (blocks.length !== 1) problems.push(`expected 1 mermaid block, found ${blocks.length}`);
  const nodes = new Set(blocks.flatMap((b) => classNodes(b.source)));
  const rows = parseNodeTable(markdown);
  const listed = new Set(rows.map((r) => r.node));
  for (const n of nodes) if (!listed.has(n)) problems.push(`node ${n} has no table row`);
  for (const r of rows) {
    if (!nodes.has(r.node)) problems.push(`table row ${r.node} is not in the diagram`);
    const text = read(r.file);
    if (text === null) {
      problems.push(`${r.node}: file ${r.file} does not exist`);
      continue;
    }
    for (const s of r.symbols)
      if (!containsSymbol(text, s)) problems.push(`${r.node}: \`${s}\` not found in ${r.file}`);
  }
  return problems;
}

/**
 * Values of an exported `as const` string array, e.g. `RUN_STATUSES` in `enums.ts`.
 * @param source - TypeScript source text.
 * @param name - The constant's name.
 * @returns The values in order, or `null` when the constant is not found.
 */
export function parseConstArray(source: string, name: string): string[] | null {
  const m = new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!m) return null;
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((v) => v[1]!);
}

/**
 * State names used in a `stateDiagram-v2` block: endpoints of transitions and `state x`
 * declarations. `[*]` and notes are ignored.
 * @param source - The Mermaid source.
 * @returns Each state once, in order of first appearance.
 */
export function stateNames(source: string): string[] {
  const seen: string[] = [];
  const add = (s: string) => {
    if (s !== '[*]' && !seen.includes(s)) seen.push(s);
  };
  let inNote = false;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('note ')) {
      inNote = !line.includes(':');
      continue;
    }
    if (inNote) {
      if (line === 'end note') inNote = false;
      continue;
    }
    const decl = /^state\s+([A-Za-z_]\w*)/.exec(line);
    if (decl) {
      add(decl[1]!);
      continue;
    }
    const t = /^(\[\*\]|[A-Za-z_]\w*)\s*-->\s*(\[\*\]|[A-Za-z_]\w*)/.exec(line);
    if (t) {
      add(t[1]!);
      add(t[2]!);
    }
  }
  return seen;
}

/** One statechart and the enum its states must equal. */
export interface StatechartSpec {
  /** Heading text that starts the section, e.g. `## 1. Run lifecycle`. */
  heading: string;
  /** Enum constant in `packages/core/src/domain/enums.ts`. */
  enumName: string;
  /** Table "Kind" of the enum's states; every other kind is a helper (pseudo/guard/activity). */
  enumKind: string;
}

/** The three statecharts in `statecharts.md`. */
export const STATECHARTS: readonly StatechartSpec[] = [
  { heading: '## 1. Run lifecycle', enumName: 'RUN_STATUSES', enumKind: 'RunStatus' },
  { heading: '## 2. Spec check', enumName: 'SPEC_CHECK_OUTCOMES', enumKind: 'SpecCheckOutcome' },
  {
    heading: '## 3. Repair attempt loop',
    enumName: 'ATTEMPT_OUTCOMES',
    enumKind: 'AttemptOutcome',
  },
];

/** Path of the shared enums file. */
export const ENUMS_FILE = 'packages/core/src/domain/enums.ts';
/** Path of the guard-order file. */
export const VERDICT_FILE = 'packages/core/src/guards/verdict.ts';

/**
 * Parses a statechart table: `| State | Kind | Where it lives in the code |`.
 * @param section - Markdown of one statechart section.
 */
export function parseStateTable(section: string): { state: string; kind: string; where: string }[] {
  const rows: { state: string; kind: string; where: string }[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').slice(1, -1);
    if (cells.length !== 3) continue;
    const state = backticked(cells[0]!)[0];
    if (state) rows.push({ state, kind: cells[1]!.trim(), where: cells[2]! });
  }
  return rows;
}

/**
 * The full guard order: `STATIC_GUARD_ORDER` followed by the names appended in `GUARD_ORDER`.
 * @param verdictSource - Source of `packages/core/src/guards/verdict.ts`.
 */
export function parseGuardOrder(verdictSource: string): string[] | null {
  const statics = parseConstArray(verdictSource, 'STATIC_GUARD_ORDER');
  const tail = /GUARD_ORDER[^=]*=\s*\[\.\.\.STATIC_GUARD_ORDER,([^\]]*)\]/.exec(verdictSource);
  if (!statics || !tail) return null;
  return [...statics, ...[...tail[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)];
}

/**
 * Checks the statecharts: each chart's enum states are exactly the enum, helper states are listed
 * in the table, every "`symbol` in `file`" reference in a table resolves, and the attempt chart
 * shows the guards in `GUARD_ORDER`.
 * @param markdown - Contents of `statecharts.md`.
 * @param read - File reader.
 * @returns Problems found; empty when the charts match the code.
 */
export function checkStatecharts(markdown: string, read: ReadText): string[] {
  const problems: string[] = [];
  const enums = read(ENUMS_FILE);
  if (enums === null) return [`${ENUMS_FILE} does not exist`];
  for (const [i, spec] of STATECHARTS.entries()) {
    const start = markdown.indexOf(spec.heading);
    if (start < 0) {
      problems.push(`missing section "${spec.heading}"`);
      continue;
    }
    const next = STATECHARTS[i + 1] ? markdown.indexOf(STATECHARTS[i + 1]!.heading) : -1;
    const section = markdown.slice(start, next < 0 ? undefined : next);
    const blocks = extractMermaidBlocks(section);
    if (blocks.length !== 1) {
      problems.push(`${spec.heading}: expected 1 mermaid block, found ${blocks.length}`);
      continue;
    }
    const values = parseConstArray(enums, spec.enumName);
    if (!values) {
      problems.push(`${spec.enumName} not found in ${ENUMS_FILE}`);
      continue;
    }
    const states = stateNames(blocks[0]!.source);
    const table = parseStateTable(section);
    const helpers = new Set(table.filter((r) => r.kind !== spec.enumKind).map((r) => r.state));
    const enumRows = new Set(table.filter((r) => r.kind === spec.enumKind).map((r) => r.state));
    for (const v of values) {
      if (!states.includes(v))
        problems.push(`${spec.heading}: ${spec.enumName} value ${v} is not a state`);
      if (!enumRows.has(v)) problems.push(`${spec.heading}: ${v} has no table row`);
    }
    for (const s of states)
      if (!values.includes(s) && !helpers.has(s))
        problems.push(
          `${spec.heading}: state ${s} is neither in ${spec.enumName} nor a listed helper`,
        );
    for (const r of table) {
      if (!states.includes(r.state))
        problems.push(`${spec.heading}: table row ${r.state} is not in the chart`);
      if (r.kind === spec.enumKind && !containsSymbol(enums, `'${r.state}'`))
        problems.push(`${spec.heading}: '${r.state}' not found in ${ENUMS_FILE}`);
      for (const m of r.where.matchAll(/`([^`]+)` in `([^`]+)`/g)) {
        const text = read(m[2]!);
        if (text === null) problems.push(`${spec.heading}: file ${m[2]} does not exist`);
        else if (!containsSymbol(text, m[1]!))
          problems.push(`${spec.heading}: \`${m[1]}\` not found in ${m[2]}`);
      }
      for (const path of backticked(r.where).filter((p) => /\.(ts|tsx)$/.test(p)))
        if (read(path) === null) problems.push(`${spec.heading}: file ${path} does not exist`);
    }
    if (spec.enumName === 'ATTEMPT_OUTCOMES') {
      const verdict = read(VERDICT_FILE);
      const order = verdict ? parseGuardOrder(verdict) : null;
      if (!order) problems.push(`GUARD_ORDER not found in ${VERDICT_FILE}`);
      else {
        const shown = states.filter((s) => order.includes(s));
        if (shown.join(',') !== order.join(','))
          problems.push(
            `${spec.heading}: guard order ${shown.join(' → ')} ≠ GUARD_ORDER ${order.join(' → ')}`,
          );
      }
    }
  }
  return problems;
}

/** Whether a repository path (file or folder) exists. */
export type PathExists = (repoRelativePath: string) => boolean;

/**
 * Checks every relative Markdown link and image in a document. Web links (`http:`, `https:`,
 * `mailto:`) and in-page anchors are skipped; `#fragment` and `?query` parts are ignored.
 * @param markdown - The document text.
 * @param docPath - The document's repository-relative path, e.g. `docs/architecture.md`.
 * @param exists - File-system probe.
 * @returns One problem per broken link.
 */
export function checkMarkdownLinks(
  markdown: string,
  docPath: string,
  exists: PathExists,
): string[] {
  const problems: string[] = [];
  const dir = docPath.split('/').slice(0, -1);
  for (const m of markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1]!;
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const parts = [...dir];
    for (const seg of target.split(/[?#]/)[0]!.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (!parts.length) {
          parts.push('..');
          break;
        }
        parts.pop();
      } else parts.push(seg);
    }
    const resolved = parts.join('/');
    if (parts.includes('..') || !exists(resolved))
      problems.push(`${docPath}: broken link ${target}`);
  }
  return problems;
}
