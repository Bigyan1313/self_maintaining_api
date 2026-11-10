/**
 * Path rules for the cheat guards. Paths are repository-relative with `/` or `\` separators.
 * Every rule matches at any depth and ignores case, so monorepo layouts are covered too.
 */

const segments = (path: string): string[] =>
  path
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
const base = (path: string): string => segments(path).at(-1) ?? '';

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'fixtures', '__snapshots__']);
const TEST_FILE = /\.(test|spec)\.[^/]+$|\.snap$/;
const TEST_SETUP = /^(vitest\.setup|jest\.setup|setuptests)\.[^.]+$/;

/**
 * Why a path counts as a test file or test fixture (FR-27), or `null` if it does not: a
 * `test/`, `tests/`, `__tests__/`, `fixtures/` or `__snapshots__/` directory, a `*.test.*` /
 * `*.spec.*` / `*.snap` file, or a test setup file.
 * @param path - Repository-relative path.
 */
export function testPathReason(path: string): string | null {
  const parts = segments(path);
  const dir = parts.slice(0, -1).find((p) => TEST_DIRS.has(p));
  if (dir) return `inside a "${dir}/" directory`;
  const name = parts.at(-1) ?? '';
  if (TEST_FILE.test(name)) return 'test file name';
  if (TEST_SETUP.test(name)) return 'test setup file';
  return null;
}

const CONFIG_EXACT = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.npmrc',
  '.nvmrc',
  '.node-version',
  '.swcrc',
]);
const CONFIG_PATTERNS: readonly RegExp[] = [
  /^tsconfig.*\.json$/,
  /^jsconfig.*\.json$/,
  /^(vitest|vite|jest)\.config\.[^.]+$/,
  /^(vitest|vite|jest)\.config\.[^.]+\.[^.]+$/, // e.g. vitest.config.e2e.ts
  /^vitest\.workspace\.[^.]+$/,
  /^\.eslintrc(\..+)?$/,
  /^eslint\.config\.[^.]+$/,
  /^\.eslintignore$/,
  /^\.prettierrc(\..+)?$/,
  /^prettier\.config\.[^.]+$/,
  /^\.prettierignore$/,
  /^\.babelrc(\..+)?$/,
  /^babel\.config\.[^.]+$/,
];

/**
 * Why a path counts as compiler, test-runner, package or CI configuration (FR-30), or `null`
 * if it does not.
 * @param path - Repository-relative path.
 */
export function configPathReason(path: string): string | null {
  const parts = segments(path);
  if (parts.includes('.github')) return 'inside ".github/"';
  const name = base(path);
  if (CONFIG_EXACT.has(name) || CONFIG_PATTERNS.some((p) => p.test(name)))
    return 'configuration file';
  return null;
}

const TS_FILE = /\.(ts|tsx|mts|cts)$/i;

/**
 * Whether the type-suppression guard (FR-29) checks this file.
 * @param path - Repository-relative path.
 */
export function isTypeScriptPath(path: string): boolean {
  return TS_FILE.test(path);
}
