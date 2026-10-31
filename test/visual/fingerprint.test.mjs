// Protects the code fingerprint of `test:visual` (tooling/test-speed, phase 3): that a change which
// is not code (comment, CRLF, test file, Markdown) leaves it alone, and that one which is (a
// literal, package.json, a fixture) moves it. The tree is a temporary one built here, so this
// checks `fingerprint.mjs`; the real tree's `--check` was run by hand against a saved run.
// Also protects the other half of the phase: the `fingerprint` line of a run must not be read as a
// check by `extractChecks` or `compare-runs`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkRun,
  fingerprint,
  hashedFiles,
  parseFingerprintLine,
  report,
  saveManifest,
} from './fingerprint.mjs';
import { compareRuns, extractChecks } from './steps.mjs';

let root;

/** Writes `content` at `rel` under the temporary root, creating folders. */
function put(rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fingerprint-'));
  put('src/extension/a.ts', '// header\nexport const a: number = 1; // trailing\n');
  put('webview-ui/src/selectors/Picker.tsx', 'export const P = () => <div>hi</div>;\n');
  put('webview-ui/src/index.css', '/* c */\n.a { color: red; }\n');
  put('test/visual/run.mjs', 'console.log("x");\n');
  put('package.json', '{"name":"x"}\n');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('fingerprint', () => {
  it('is the same for a changed comment, CRLF line endings and a type-only annotation', () => {
    const before = fingerprint(root).hash;
    put('src/extension/a.ts', '/** Doc. */\r\nexport const a:   number = 1;\r\n');
    put('webview-ui/src/index.css', '.a {\r\n  color: red;\r\n}\r\n');
    expect(fingerprint(root).hash).toBe(before);
  });

  it('changes when a literal changes, in ts, tsx and css', () => {
    const before = fingerprint(root).hash;
    put('src/extension/a.ts', 'export const a: number = 2;\n');
    const ts = fingerprint(root).hash;
    expect(ts).not.toBe(before);
    put('webview-ui/src/selectors/Picker.tsx', 'export const P = () => <div>bye</div>;\n');
    const tsx = fingerprint(root).hash;
    expect(tsx).not.toBe(ts);
    put('webview-ui/src/index.css', '.a { color: blue; }\n');
    expect(fingerprint(root).hash).not.toBe(tsx);
  });

  it('ignores test files and Markdown, and sees package.json and the harness', () => {
    const before = fingerprint(root).hash;
    put('src/extension/a.test.ts', 'export const t = 1;\n');
    put('test/visual/steps.test.mjs', 'export const t = 1;\n');
    put('src/shared/README.md', 'hello\n');
    expect(fingerprint(root).hash).toBe(before);
    put('package.json', '{"name":"y"}\n');
    const pkg = fingerprint(root).hash;
    expect(pkg).not.toBe(before);
    put('test/visual/run.mjs', 'console.log("y");\n');
    expect(fingerprint(root).hash).not.toBe(pkg);
  });

  it('hashes the synthetic server and leaves out the post-processors', () => {
    put('src/extension/test-fixtures/fake-opencode.mjs', 'export const f = 1;\n');
    put('test/visual/compare-runs.mjs', 'export const c = 1;\n');
    put('test/visual/fingerprint.mjs', 'export const c = 1;\n');
    const files = hashedFiles(root);
    expect(files).toContain('src/extension/test-fixtures/fake-opencode.mjs');
    expect(files).not.toContain('test/visual/compare-runs.mjs');
    expect(files).not.toContain('test/visual/fingerprint.mjs');
  });

  /**
   * Protects review W1 and S3: `media/` icons move the fingerprint, and bytes that are not valid
   * utf8 are not collapsed. Fabricated files in a temporary tree.
   */
  it('hashes media/, text with normalised EOL and binaries as bytes', () => {
    put('media/icon.svg', '<svg>\n</svg>\n');
    put('media/pic.bin', Buffer.from([0xff, 0xfe, 0x01]));
    const before = fingerprint(root).hash;
    expect(hashedFiles(root)).toContain('media/icon.svg');
    put('media/icon.svg', '<svg>\r\n</svg>\r\n');
    expect(fingerprint(root).hash).toBe(before);
    put('media/icon.svg', '<svg fill="red">\n</svg>\n');
    const changed = fingerprint(root).hash;
    expect(changed).not.toBe(before);
    put('media/pic.bin', Buffer.from([0xfe, 0xff, 0x01]));
    expect(fingerprint(root).hash).not.toBe(changed);
  });

  it('survives a file esbuild cannot parse, hashed raw', () => {
    put('src/extension/broken.ts', 'export const = ;\n');
    const first = fingerprint(root).hash;
    put('src/extension/broken.ts', 'export const = ;;\n');
    expect(fingerprint(root).hash).not.toBe(first);
  });
});

describe('checkRun', () => {
  /** Saved output of a "run" taken on the current tree. */
  function savedRun(extra = '') {
    const fp = fingerprint(root);
    saveManifest(root, fp);
    return `${extra}fingerprint ${fp.hash}\n== 0 first\n  ok something\n`;
  }

  it('covers after a comment-only change, and says so for a filtered run', () => {
    const text = savedRun('PARTIAL RUN (steps 11, 14): not evidence for a commit\n');
    put('src/extension/a.ts', '// other comment\nexport const a: number = 1;\n');
    const result = checkRun(root, text);
    expect(result.status).toBe('covers');
    expect(result.partial).toMatch(/^PARTIAL RUN/);
  });

  it('is stale after a literal change, naming the file and the selection', () => {
    const text = savedRun();
    put('webview-ui/src/selectors/Picker.tsx', 'export const P = () => <div>bye</div>;\n');
    const result = checkRun(root, text);
    expect(result.status).toBe('stale');
    expect(result.files).toEqual(['changed webview-ui/src/selectors/Picker.tsx']);
    expect(result.selection).toMatchObject({ mode: 'groups', groups: ['selectors'] });
  });

  it('asks for the full run when a cross-cutting file or an added file changed', () => {
    const text = savedRun();
    put('src/shared/protocol.ts', 'export const p = 1;\n');
    const result = checkRun(root, text);
    expect(result.files).toEqual(['added src/shared/protocol.ts']);
    expect(result.selection.mode).toBe('full');
  });

  it('is stale without a file list when the manifest is missing', () => {
    const text = savedRun();
    fs.rmSync(path.join(root, '.vscode-test'), { recursive: true });
    put('src/extension/a.ts', 'export const a: number = 9;\n');
    const result = checkRun(root, text);
    expect(result.status).toBe('stale');
    expect(result.files).toBeUndefined();
  });

  /**
   * Protects the verdict half of `--check` (review W2): the same tree is not evidence unless the
   * saved run ended "all visual checks passed" and was not a `--bail` run. The outputs are
   * fabricated here; the real banner text is the one `run.mjs` prints.
   */
  it('exits 0 only for a passed, non-bail run on the same tree', () => {
    const passed = `${savedRun()}all visual checks passed\n`;
    expect(report(checkRun(root, passed))).toBe(0);
    expect(report(checkRun(root, savedRun()))).toBe(3);
    const bail = `${savedRun('--bail: the run stops after the first step that fails; not evidence for a commit\n')}all visual checks passed\n`;
    expect(report(checkRun(root, bail))).toBe(3);
    put('src/extension/a.ts', 'export const a: number = 7;\n');
    expect(report(checkRun(root, passed))).toBe(1);
    expect(report(checkRun(root, '== 0 first\n'))).toBe(2);
  });

  it('reports an output without a fingerprint line', () => {
    expect(checkRun(root, '== 0 first\n  ok x\n').status).toBe('no-line');
    expect(parseFingerprintLine('fingerprint abc\n')).toBeUndefined();
  });
});

describe('the fingerprint line in a run output', () => {
  const hash = 'a'.repeat(64);
  const withLine = `fingerprint ${hash}\n== 0 first\n  ok one\n  warn two\n== summary\n`;
  const without = '== 0 first\n  ok one\n  warn two\n== summary\n';

  it('is not an assertion line for extractChecks', () => {
    expect(extractChecks(withLine)).toEqual(extractChecks(without));
    expect(extractChecks(withLine).has('')).toBe(false);
  });

  it('makes no difference for compareRuns', () => {
    const result = compareRuns(extractChecks(without), extractChecks(withLine));
    expect(result.differences).toEqual([]);
  });
});
