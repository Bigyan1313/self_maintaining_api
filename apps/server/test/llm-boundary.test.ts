import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('ESLint blocks SDK imports, subpaths, reexports, dynamic imports and require outside the adapter', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const lint = new ESLint({ cwd: root });
  for (const code of [
    'import SDK from "@anthropic-ai/sdk"; void SDK;',
    'import SDK from "@anthropic-ai/sdk/resources"; void SDK;',
    'export {default} from "@anthropic-ai/sdk";',
    'void import("@anthropic-ai/sdk");',
    'require("@anthropic-ai/sdk");',
  ]) {
    const [result] = await lint.lintText(code, {
      filePath: root + 'apps/server/src/infra/llm/forbidden.ts',
    });
    expect(
      result?.messages.some((m) =>
        ['no-restricted-imports', 'no-restricted-syntax'].includes(m.ruleId ?? ''),
      ),
    ).toBe(true);
  }
  const [allowed] = await lint.lintText('import SDK from "@anthropic-ai/sdk"; void SDK;', {
    filePath: root + 'apps/server/src/infra/llm/adapter.ts',
  });
  expect(allowed?.errorCount).toBe(0);
});
