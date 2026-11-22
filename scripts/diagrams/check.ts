/**
 * `npm run diagrams:check` — fails when a diagram in `docs/diagrams/` no longer matches the code.
 *
 * @packageDocumentation
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkClassDiagram, checkStatecharts, type ReadText } from './lib.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read: ReadText = (p) =>
  existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null;

const problems = [
  ...checkClassDiagram(read('docs/diagrams/class-diagram.md') ?? '', read).map(
    (p) => `class-diagram.md: ${p}`,
  ),
  ...checkStatecharts(read('docs/diagrams/statecharts.md') ?? '', read).map(
    (p) => `statecharts.md: ${p}`,
  ),
];
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exitCode = 1;
} else
  console.log('✓ diagrams match the code (class diagram nodes, statechart states, guard order)');
