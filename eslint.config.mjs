// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'docs/api/**',
      '.work/**',
      'apps/server/drizzle/**',
      // Standalone consumer repo (stands in for a developer's own project); it has its own tooling.
      'demo/consumer/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Our own source must never silence the type checker (mirrors cheat guard FR-29).
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true, 'ts-check': false },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    ignores: ['apps/server/src/infra/llm/adapter.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/*'],
              message: 'Provider SDK access belongs only in infra/llm/adapter.ts (C-06).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/^@anthropic-ai\\/sdk/]',
          message: 'Dynamic provider imports are restricted to the adapter.',
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^@anthropic-ai\\/sdk/]",
          message: 'Provider requires are restricted to the adapter.',
        },
      ],
    },
  },
  prettier,
);
