// Protects the two pure helpers that tell step 39 (P7) which VS Code it is running on:
// `linksLeaveRootServed` (which side of 1.146.0 a version is) and `readVsCodeVersion` (where the
// version is read from). Without them P7 would hard-code one behaviour and go red on the other
// side of microsoft/vscode#346026 (11/11/2026: the check turned red on every PR when the stable
// build moved to 1.146.0). The cases are fabricated: version strings and folders made in a
// temporary directory, not a real VS Code build; the real layout was read by hand from the cached
// builds (see the header of `readVsCodeVersion`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isOwnVsCodeWindow, linksLeaveRootServed, readVsCodeVersion } from './vscodeProcess.mjs';

describe('isOwnVsCodeWindow', () => {
  /**
   * Protects against the CI line "system focus lost before step 28: foreground Code pid 3780 ..."
   * (run 43077896965, 11 steps): the window in front was the VS Code under test, so no recovery
   * should be tried. The windows are fabricated; a foreign window must NOT match, nor one whose
   * title has the same `open-vs-code-visual-` prefix but another suffix (step 25's control
   * windows, a parallel local run): only this run's exact folder name or the main pid count.
   */
  it('recognises the window of the VS Code under test', () => {
    const own = {
      pid: 3780,
      process: 'Code',
      title: '[Extension Development Host] open-vs-code-visual-JCfsun - Visual Studio Code [Ad',
      className: 'Chrome_WidgetWin_1',
    };
    const name = 'open-vs-code-visual-JCfsun';
    expect(isOwnVsCodeWindow(own, 1, name)).toBe(true);
    expect(isOwnVsCodeWindow({ ...own, title: 'untitled' }, 3780, name)).toBe(true);
    expect(isOwnVsCodeWindow({ ...own, pid: 9, title: 'Inbox - Mail' }, 3780, name)).toBe(false);
    // Same prefix, other suffix (step 25's control window, a parallel run): not ours.
    expect(
      isOwnVsCodeWindow(
        { ...own, pid: 9, title: own.title.replace('JCfsun', 'xyz123') },
        3780,
        name,
      ),
    ).toBe(false);
    expect(isOwnVsCodeWindow(undefined, 3780, name)).toBe(false);
  });
});

describe('linksLeaveRootServed', () => {
  /**
   * Guards the comparison against the string-compare bug ("1.9.0" > "1.146.0") and against
   * treating the boundary version as old. A comparator inverted by mutation fails every row.
   */
  it('tells which side of 1.146.0 a version is', () => {
    expect(linksLeaveRootServed('1.145.3')).toBe(true);
    expect(linksLeaveRootServed('1.9.0')).toBe(true);
    expect(linksLeaveRootServed('1.146.0')).toBe(false);
    expect(linksLeaveRootServed('1.146.1')).toBe(false);
    expect(linksLeaveRootServed('1.150.0')).toBe(false);
    expect(linksLeaveRootServed('2.0.0')).toBe(false);
  });

  /** An unreadable version must not be guessed: the step fails and says so. */
  it('returns undefined for a version it cannot read', () => {
    expect(linksLeaveRootServed(undefined)).toBeUndefined();
    expect(linksLeaveRootServed('')).toBeUndefined();
    expect(linksLeaveRootServed('abc')).toBeUndefined();
  });
});

describe('readVsCodeVersion', () => {
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  /** Makes `<tmp>/<relative>/package.json` with `version` and returns the temp root. */
  const build = (relative, version) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsc-ver-'));
    roots.push(root);
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ name: 'code', version }));
    return root;
  };

  /** The three layouts the plan lists: plain, commit folder (Windows archive) and macOS bundle. */
  it('finds the version in each of the three layouts', () => {
    const plain = build(path.join('resources', 'app', 'package.json'), '1.146.0');
    expect(readVsCodeVersion(path.join(plain, 'Code.exe'))).toBe('1.146.0');

    const commit = build(path.join('69047191fc', 'resources', 'app', 'package.json'), '1.146.1');
    expect(readVsCodeVersion(path.join(commit, 'Code.exe'))).toBe('1.146.1');

    const mac = build(path.join('Resources', 'app', 'package.json'), '1.145.3');
    // `Resources` sits next to `MacOS`, i.e. at `<dir>/../Resources`: the build above put it in
    // `<root>/Resources`, so the executable lives one level down (`<root>/MacOS/Electron`).
    const macOsExe = path.join(mac, 'MacOS', 'Electron');
    fs.mkdirSync(path.dirname(macOsExe), { recursive: true });
    expect(readVsCodeVersion(macOsExe)).toBe('1.145.3');
  });

  /** No `package.json` or one without a usable version: `undefined`, never a throw. */
  it('returns undefined when there is no readable version', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsc-ver-'));
    roots.push(empty);
    expect(readVsCodeVersion(path.join(empty, 'Code.exe'))).toBeUndefined();
    const junk = build(path.join('resources', 'app', 'package.json'), 'not-a-version');
    expect(readVsCodeVersion(path.join(junk, 'Code.exe'))).toBeUndefined();
    expect(readVsCodeVersion(path.join(empty, 'missing', 'Code.exe'))).toBeUndefined();
  });
});
