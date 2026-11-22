/**
 * `npm run docs:check` — fails when a diagram in `docs/diagrams/` no longer matches the code, or
 * when a relative link in the architecture, diagram or acceptance documents is broken.
 *
 * @packageDocumentation
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkClassDiagram, checkMarkdownLinks, checkStatecharts, type ReadText } from './lib.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read: ReadText = (p) =>
  existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null;
const exists = (p: string) => existsSync(join(root, p));

const linked = [
  'docs/architecture.md',
  'docs/diagrams/class-diagram.md',
  'docs/diagrams/statecharts.md',
  ...(exists('docs/acceptance')
    ? readdirSync(join(root, 'docs/acceptance'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => `docs/acceptance/${f}`)
    : []),
];

const problems = [
  ...checkClassDiagram(read('docs/diagrams/class-diagram.md') ?? '', read).map(
    (p) => `class-diagram.md: ${p}`,
  ),
  ...checkStatecharts(read('docs/diagrams/statecharts.md') ?? '', read).map(
    (p) => `statecharts.md: ${p}`,
  ),
  ...linked.flatMap((doc) => checkMarkdownLinks(read(doc) ?? '', doc, exists)),
];
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exitCode = 1;
} else
  console.log(`✓ diagrams match the code, and all links resolve in ${linked.length} documents`);
