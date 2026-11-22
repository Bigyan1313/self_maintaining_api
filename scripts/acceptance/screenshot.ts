/**
 * Renders acceptance transcripts as terminal-window PNGs with the pinned headless browser that
 * `@mermaid-js/mermaid-cli` already needs (puppeteer). The image shows the real transcript text;
 * nothing is typed by hand.
 *
 * @packageDocumentation
 */
import { join } from 'node:path';

/**
 * HTML for one terminal window showing `text`.
 * @param title - Window title.
 * @param text - Transcript text.
 */
export function terminalHtml(title: string, text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = esc(text)
    .split('\n')
    .map((line) =>
      line.startsWith('$ ')
        ? `<span class="cmd">${line}</span>`
        : /^\s+✓/.test(line)
          ? `<span class="ok">${line}</span>`
          : /^\s+(✗|– NOT RUN)/.test(line)
            ? `<span class="${line.includes('✗') ? 'bad' : 'skip'}">${line}</span>`
            : line.startsWith('RESULT ')
              ? `<span class="result">${line}</span>`
              : line,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#e5e7eb;padding:16px;font-family:Menlo,Consolas,monospace}
.win{background:#111827;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);overflow:hidden}
.bar{background:#374151;color:#d1d5db;font:12px -apple-system,Segoe UI,sans-serif;padding:6px 12px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
pre{margin:0;padding:12px 14px;color:#e5e7eb;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.cmd{color:#93c5fd}.ok{color:#86efac}.bad{color:#fca5a5}.skip{color:#fcd34d}.result{color:#fff;font-weight:bold}
</style></head><body><div class="win"><div class="bar"><span class="dot" style="background:#ef4444"></span><span class="dot" style="background:#f59e0b"></span><span class="dot" style="background:#22c55e"></span>${esc(title)}</div><pre>${body}</pre></div></body></html>`;
}

/**
 * Writes `<outDir>/<id>.png` for each transcript.
 * @param items - Check id and transcript text.
 * @param outDir - Folder for the PNGs.
 * @returns The ids that got a screenshot (empty when no headless browser is available).
 */
export async function renderTerminalScreenshots(
  items: readonly { id: string; text: string }[],
  outDir: string,
): Promise<string[]> {
  let puppeteer: typeof import('puppeteer');
  try {
    puppeteer = await import('puppeteer');
  } catch {
    console.warn('puppeteer is not installed; no terminal screenshots.');
    return [];
  }
  let browser;
  try {
    browser = await puppeteer.default.launch({ headless: true });
  } catch (e) {
    console.warn(`Cannot start the headless browser; no terminal screenshots (${String(e)}).`);
    return [];
  }
  const done: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 600, deviceScaleFactor: 1 });
    for (const { id, text } of items) {
      await page.setContent(terminalHtml(`npm run acceptance — ${id}`, text));
      await page.screenshot({ path: join(outDir, `${id}.png`) as `${string}.png`, fullPage: true });
      done.push(id);
    }
  } finally {
    await browser.close();
  }
  return done;
}
