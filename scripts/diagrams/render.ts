/**
 * `npm run diagrams` — renders every Mermaid block in `docs/diagrams/*.md` to the PNG named by the
 * image link above it, using the pinned `@mermaid-js/mermaid-cli` (C-07).
 *
 * @packageDocumentation
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMermaidBlocks } from './lib.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = join(root, 'docs/diagrams');
const mmdc = join(root, 'node_modules/.bin/mmdc');
const tmp = mkdtempSync(join(tmpdir(), 'sma-diagrams-'));
mkdirSync(join(dir, 'png'), { recursive: true });
try {
  for (const file of ['class-diagram.md', 'statecharts.md', 'reverse-engineered.md']) {
    for (const block of extractMermaidBlocks(readFileSync(join(dir, file), 'utf8'))) {
      if (!block.png) throw new Error(`${file}: a mermaid block has no PNG image link above it`);
      const input = join(tmp, 'diagram.mmd');
      writeFileSync(input, block.source);
      const size = block.source.trimStart().startsWith('classDiagram') ? '3500' : '1600';
      execFileSync(
        mmdc,
        // The class diagram is wide: give it a wider page so the PNG stays readable when zoomed.
        ['-i', input, '-o', join(dir, block.png), '-b', 'white', '-s', '2', '--size', size, '-q'],
        { stdio: 'inherit' },
      );
      console.log(`rendered docs/diagrams/${block.png}`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
