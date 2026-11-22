import { describe, expect, it } from 'vitest';
import {
  checkClassDiagram,
  checkMarkdownLinks,
  checkStatecharts,
  classNodes,
  containsSymbol,
  extractMermaidBlocks,
  parseConstArray,
  parseGuardOrder,
  parseNodeTable,
  stateNames,
  type ReadText,
} from './lib.js';

const files: Record<string, string> = {
  'src/a.ts': 'export class Alpha {}\nexport function beta() {}\n',
  'packages/core/src/domain/enums.ts': [
    "export const RUN_STATUSES = ['running', 'done'] as const;",
    "export const SPEC_CHECK_OUTCOMES = ['ok'] as const;",
    "export const ATTEMPT_OUTCOMES = ['pass', 'cheating'] as const;",
  ].join('\n'),
  'packages/core/src/guards/verdict.ts':
    "export const STATIC_GUARD_ORDER = [\n  'g1',\n  'g2',\n] as const;\nexport const GUARD_ORDER: readonly GuardName[] = [...STATIC_GUARD_ORDER, 'g3'];",
};
const read: ReadText = (p) => files[p] ?? null;

const classMd = (extraRow = '') => `
![x](png/class.png)

\`\`\`mermaid
classDiagram
  class Alpha {
    +go()
  }
  class beta {
    <<module>>
  }
\`\`\`

| Node | Kind | Symbols checked | File |
| ---- | ---- | --------------- | ---- |
| \`Alpha\` | class | \`class Alpha\` | \`src/a.ts\` |
| \`beta\` | module | \`beta\` | \`src/a.ts\` |
${extraRow}`;

const chart = (states: string, rows: string) => `
\`\`\`mermaid
stateDiagram-v2
${states}
\`\`\`

| State | Kind | Where |
| ----- | ---- | ----- |
${rows}
`;
const statesMd = (attempt: string) =>
  [
    '## 1. Run lifecycle',
    chart(
      '  [*] --> running : start\n  running --> done\n  note right of running\n    hello --> world\n  end note',
      '| `running` | RunStatus | `packages/core/src/domain/enums.ts` |\n| `done` | RunStatus | x |',
    ),
    '## 2. Spec check',
    chart(
      '  state c <<choice>>\n  [*] --> c\n  c --> ok',
      '| `ok` | SpecCheckOutcome | x |\n| `c` | pseudo-state | `beta` in `src/a.ts` |',
    ),
    '## 3. Repair attempt loop',
    chart(
      attempt,
      '| `pass` | AttemptOutcome | x |\n| `cheating` | AttemptOutcome | x |\n| `g1` | guard step | x |\n| `g2` | guard step | x |\n| `g3` | guard step | x |',
    ),
  ].join('\n');
const goodAttempt = '  [*] --> g1\n  g1 --> g2\n  g2 --> g3\n  g3 --> pass\n  g1 --> cheating';

describe('diagram parsing helpers', () => {
  it('extracts mermaid blocks with the PNG link above each', () => {
    const blocks = extractMermaidBlocks('![a](png/a.png)\n```mermaid\nA\n```\n```mermaid\nB\n```');
    expect(blocks).toEqual([
      { source: 'A', png: 'png/a.png' },
      { source: 'B', png: 'png/a.png' },
    ]);
  });
  it('reads class nodes, node tables, const arrays and the guard order', () => {
    expect(classNodes('classDiagram\n  class A {\n  }\n  class B\n')).toEqual(['A', 'B']);
    expect(parseNodeTable(classMd())).toEqual([
      { node: 'Alpha', kind: 'class', symbols: ['class Alpha'], file: 'src/a.ts' },
      { node: 'beta', kind: 'module', symbols: ['beta'], file: 'src/a.ts' },
    ]);
    expect(parseConstArray(files['packages/core/src/domain/enums.ts']!, 'RUN_STATUSES')).toEqual([
      'running',
      'done',
    ]);
    expect(parseConstArray('', 'X')).toBeNull();
    expect(parseGuardOrder(files['packages/core/src/guards/verdict.ts']!)).toEqual([
      'g1',
      'g2',
      'g3',
    ]);
  });
  it('matches whole symbols only', () => {
    expect(containsSymbol('export function locate(', 'locate')).toBe(true);
    expect(containsSymbol('export function locateCallSites(', 'locate')).toBe(false);
    expect(containsSymbol("x = 'running'", "'running'")).toBe(true);
  });
  it('collects state names from transitions and declarations, skipping notes', () => {
    expect(
      stateNames(
        '  state c <<choice>>\n  [*] --> a : x\n  a --> c\n  note left of a\n    q --> r\n  end note\n  note right of a : z --> y',
      ),
    ).toEqual(['c', 'a']);
  });
});

describe('checkClassDiagram', () => {
  it('passes when every node is listed and every symbol exists', () => {
    expect(checkClassDiagram(classMd(), read)).toEqual([]);
  });
  it('reports unlisted nodes, stray rows, missing files and missing symbols', () => {
    const md = classMd(
      '| `ghost` | module | `nope` | `src/missing.ts` |\n| `Alpha` | class | `gamma` | `src/a.ts` |',
    );
    expect(checkClassDiagram(md, read)).toEqual([
      'table row ghost is not in the diagram',
      'ghost: file src/missing.ts does not exist',
      'Alpha: `gamma` not found in src/a.ts',
    ]);
    expect(
      checkClassDiagram(classMd().replace('| `beta` | module | `beta` | `src/a.ts` |', ''), read),
    ).toEqual(['node beta has no table row']);
  });
});

describe('checkStatecharts', () => {
  it('passes when states equal the enums and guards follow GUARD_ORDER', () => {
    expect(checkStatecharts(statesMd(goodAttempt), read)).toEqual([]);
  });
  it('reports a wrong guard order, a missing enum state and an unknown state', () => {
    const bad = '  [*] --> g2\n  g2 --> g1\n  g1 --> g3\n  g3 --> pass\n  g3 --> invented';
    expect(checkStatecharts(statesMd(bad), read)).toEqual([
      '## 3. Repair attempt loop: ATTEMPT_OUTCOMES value cheating is not a state',
      '## 3. Repair attempt loop: state invented is neither in ATTEMPT_OUTCOMES nor a listed helper',
      '## 3. Repair attempt loop: table row cheating is not in the chart',
      '## 3. Repair attempt loop: guard order g2 → g1 → g3 ≠ GUARD_ORDER g1 → g2 → g3',
    ]);
  });
});

describe('checkMarkdownLinks', () => {
  const exists = (p: string) => ['docs/a.md', 'src', 'src/x.ts', 'README.md'].includes(p);
  it('accepts relative files, folders, anchors and web links', () => {
    const md =
      '[a](a.md#top) [s](../src) [x](../src/x.ts) [r](../README.md) [w](https://e.x) [h](#here) ![i](./a.md)';
    expect(checkMarkdownLinks(md, 'docs/arch.md', exists)).toEqual([]);
  });
  it('reports missing targets and links that leave the repository', () => {
    expect(
      checkMarkdownLinks('[m](missing.md) [o](../../outside.md)', 'docs/arch.md', exists),
    ).toEqual([
      'docs/arch.md: broken link missing.md',
      'docs/arch.md: broken link ../../outside.md',
    ]);
  });
});
