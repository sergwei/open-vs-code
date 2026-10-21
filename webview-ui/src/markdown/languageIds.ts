/**
 * Maps the label of a Markdown fence (` ```ts `) to the two ids the UI needs (issue #15): the
 * VS Code language id, sent with `editor.newFile`, and the highlight.js language name used to
 * colour the block. PURE.
 */

/** One language: `vscode` is a VS Code language id; `hljs` is absent when we do not register it. */
interface Language {
  vscode: string;
  hljs?: string;
}

const TYPESCRIPT: Language = { vscode: 'typescript', hljs: 'typescript' };
const JAVASCRIPT: Language = { vscode: 'javascript', hljs: 'javascript' };
const SHELL: Language = { vscode: 'shellscript', hljs: 'bash' };
const POWERSHELL: Language = { vscode: 'powershell', hljs: 'powershell' };
const PYTHON: Language = { vscode: 'python', hljs: 'python' };
const YAML: Language = { vscode: 'yaml', hljs: 'yaml' };
const MARKDOWN: Language = { vscode: 'markdown', hljs: 'markdown' };
const CSHARP: Language = { vscode: 'csharp', hljs: 'csharp' };
const RUST: Language = { vscode: 'rust', hljs: 'rust' };
const HTML: Language = { vscode: 'html', hljs: 'xml' };
const JSON_LANGUAGE: Language = { vscode: 'json', hljs: 'json' };

/**
 * Fence label (lower case) -> language. The ids on the `vscode` side are the built-in ones of VS
 * Code; the host double-checks them with `languages.getLanguages()` before using them, so a wrong
 * entry degrades to an untitled file with no language, never to an error. Languages without a
 * `hljs` entry (c, cpp, ruby, php...) are shown as plain text but still open with the right mode.
 */
const LANGUAGES: Readonly<Record<string, Language>> = {
  ts: TYPESCRIPT,
  typescript: TYPESCRIPT,
  tsx: { vscode: 'typescriptreact', hljs: 'typescript' },
  js: JAVASCRIPT,
  javascript: JAVASCRIPT,
  mjs: JAVASCRIPT,
  cjs: JAVASCRIPT,
  jsx: { vscode: 'javascriptreact', hljs: 'javascript' },
  json: JSON_LANGUAGE,
  jsonc: { vscode: 'jsonc', hljs: 'json' },
  sh: SHELL,
  bash: SHELL,
  shell: SHELL,
  zsh: SHELL,
  shellscript: SHELL,
  ps1: POWERSHELL,
  pwsh: POWERSHELL,
  powershell: POWERSHELL,
  py: PYTHON,
  python: PYTHON,
  css: { vscode: 'css', hljs: 'css' },
  html: HTML,
  xml: { vscode: 'xml', hljs: 'xml' },
  md: MARKDOWN,
  markdown: MARKDOWN,
  diff: { vscode: 'diff', hljs: 'diff' },
  patch: { vscode: 'diff', hljs: 'diff' },
  yml: YAML,
  yaml: YAML,
  go: { vscode: 'go', hljs: 'go' },
  golang: { vscode: 'go', hljs: 'go' },
  rs: RUST,
  rust: RUST,
  java: { vscode: 'java', hljs: 'java' },
  cs: CSHARP,
  csharp: CSHARP,
  sql: { vscode: 'sql', hljs: 'sql' },
  c: { vscode: 'c' },
  cpp: { vscode: 'cpp' },
  'c++': { vscode: 'cpp' },
  rb: { vscode: 'ruby' },
  ruby: { vscode: 'ruby' },
  php: { vscode: 'php' },
  dockerfile: { vscode: 'dockerfile' },
};

/** Looks the label up; `undefined` for no label or an unknown one. */
function lookup(fence: string | undefined): Language | undefined {
  if (fence === undefined) return undefined;
  const key = fence.trim().toLowerCase();
  return Object.hasOwn(LANGUAGES, key) ? LANGUAGES[key] : undefined;
}

/** VS Code language id for a fence label, or `undefined` when unknown (then none is sent). */
export function toVscodeLanguage(fence: string | undefined): string | undefined {
  return lookup(fence)?.vscode;
}

/** highlight.js language name for a fence label, or `undefined` when it is not registered. */
export function toHighlightLanguage(fence: string | undefined): string | undefined {
  return lookup(fence)?.hljs;
}
