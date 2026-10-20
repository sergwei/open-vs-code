// ESLint flat config (ESLint 10: flat config only).
//
// Block order matters, the last matching block wins per rule:
//   1. ignores, 2. JS recommended, 3. typed TypeScript rules, 4. root config files
//   (not in any tsconfig, so no type information), 5. architecture boundaries,
//   6. eslint-config-prettier last, so it can switch off any formatting rule.
//
// Architecture boundaries, each protects a rule of CLAUDE.md:
//   - `vscode` only inside src/extension/**: the webview never runs in the extension host,
//     and src/shared is imported by both sides (architecture rule 2, shared protocol).
//   - `@opencode/client` only inside src/extension/**: the webview never talks to the opencode
//     server (architecture rule 1).
//   - The v1 SDK (`@opencode-ai/sdk`) is forbidden in src/** and webview-ui/**, src/extension
//     included: v1 is not supported. Root config files (esbuild.mjs, ...) are not covered.
//   - Node built-ins are forbidden in src/shared/** and webview-ui/src/**: the former is code
//     shared with the browser (src/shared/README.md: "No Node-only APIs"), the latter runs in
//     the webview. Tests (`*.test.ts(x)`) are exempt: they run in Node and may read fixtures.
//   - Relative imports that reach into src/extension/** are forbidden from those same places
//     (`../extension/ids`, `../../src/extension/x`): they would drag host code into the webview.
// Coverage: `no-restricted-imports` covers static imports, `import type`, `export ... from` and
// `import x = require()`. Dynamic `import('...')` is covered by `no-restricted-syntax` with an
// `ImportExpression` selector, only for string literals (a computed specifier is not seen).
// Bare `require()` is caught by @typescript-eslint/no-require-imports, not by these rules.
// Both rules are single rules, so a later block REPLACES the options of an earlier one for the
// same file. That is why each block repeats the restrictions it needs. Do not escape the slash
// inside the selector regexes: it breaks esquery's parser, so they match `@opencode` and
// `@opencode-ai.sdk` instead.
// VERIFIED with ESLint's `lintText` on virtual paths (typed rules off, nothing written to disk,
// Windows 11, 2026-10-20): static and dynamic imports of vscode / node: / @opencode in
// src/shared and webview-ui/src are reported, `./extensionHelpers` is not.
// HYPOTHESIS: `webview-ui/src/**` is the layout of the webview code until issue #2 lands.
// UNVERIFIED: that the typed rules keep working for webview-ui/** once its tsconfig exists
// (it must include its own tests, or typed linting fails on them).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

/**
 * Builds the error message for a module that only src/extension/** may import.
 *
 * Single source for the wording so every boundary rule points to the same CLAUDE.md rules.
 */
const outsideHostMessage = (what) =>
  `${what} is only allowed in src/extension/** (CLAUDE.md architecture rules 1 and 2).`;

const v1SdkMessage = 'The v1 SDK (`@opencode-ai/sdk`) is not supported; use `@opencode/client`.';

/** Dynamic-import selector for the v1 SDK, applied in src/extension/** (see header). */
const v1SdkDynamicImport = {
  selector: 'ImportExpression[source.value=/^@opencode-ai.sdk/]',
  message: v1SdkMessage,
};

/** Dynamic-import selectors for the webview-side blocks; `node:` only where built-ins are banned. */
const hostOnlyDynamicImport = {
  selector: 'ImportExpression[source.value=/^(vscode$|@opencode.client)/]',
  message: outsideHostMessage('Host-only modules (vscode, @opencode/client)'),
};
const hostAndNodeDynamicImport = {
  selector: 'ImportExpression[source.value=/^(vscode$|node:|@opencode.client)/]',
  message: outsideHostMessage('Host-only modules (vscode, node:*, @opencode/client)'),
};

const commonPaths = [
  { name: 'vscode', message: outsideHostMessage('The `vscode` module') },
  {
    name: '@opencode/client',
    message: outsideHostMessage('The opencode client'),
  },
];

const v1SdkPattern = {
  group: ['@opencode-ai/sdk', '@opencode-ai/sdk/**'],
  message: v1SdkMessage,
};

const commonPatterns = [
  {
    group: ['@opencode/client/**'],
    message: outsideHostMessage('The opencode client'),
  },
  v1SdkPattern,
  {
    regex: '(^|/)src/extension(/|$)|^(\\.\\./)+extension(/|$)',
    message: outsideHostMessage('Relative imports into src/extension'),
  },
];

const nodeBuiltinMessage =
  'Node built-ins are forbidden in src/shared (src/shared/README.md: "No Node-only APIs") and in the webview, which runs without Node (architecture rule 1).';

// `fs` and `node:fs` are both listed: bare names come from `builtinModules`, the `node:`
// prefix is covered by the pattern below.
const nodeBuiltinPaths = builtinModules
  .filter((name) => !name.startsWith('_'))
  .map((name) => ({
    name,
    message: nodeBuiltinMessage,
  }));

const nodeBuiltinPatterns = [
  {
    group: ['node:*'],
    message: nodeBuiltinMessage,
  },
];

export default defineConfig(
  globalIgnores(['dist/', 'out/', 'coverage/', '.vscode-test/']),

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A leading underscore marks a binding that is unused on purpose, e.g. a field dropped
      // with rest destructuring (`const { field: _removed, ...rest } = message`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['*.{mjs,mts}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['src/extension/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [v1SdkPattern] }],
      'no-restricted-syntax': ['error', v1SdkDynamicImport],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}', 'webview-ui/**/*.{ts,tsx}'],
    ignores: ['src/extension/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: commonPaths, patterns: commonPatterns }],
      'no-restricted-syntax': ['error', hostOnlyDynamicImport, v1SdkDynamicImport],
    },
  },

  {
    files: ['src/shared/**/*.{ts,tsx}', 'webview-ui/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...commonPaths, ...nodeBuiltinPaths],
          patterns: [...commonPatterns, ...nodeBuiltinPatterns],
        },
      ],
      'no-restricted-syntax': ['error', hostAndNodeDynamicImport, v1SdkDynamicImport],
    },
  },

  prettier,
);
