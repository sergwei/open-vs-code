// Loads the translations for the host's own modules (E11-i18n). It MUST be the first import of
// `extension.ts`: ES imports evaluate in order, so any module-level `l10n.t(...)` of another file
// already sees the bundle. `l10nCatalog.test.ts` guards that position.
//
// Why `@vscode/l10n` and not `vscode.l10n` everywhere: most host modules are pure (no `vscode`
// import, so Vitest can load them), and `vscode.l10n` only exists in the extension host. This file
// is the one bridge: it hands `vscode.l10n.bundle` to the library once. ESLint forbids
// `vscode.l10n` anywhere else, and the named imports of `@vscode/l10n`, so the extractor of
// `scripts/l10n.mjs` (which only sees `l10n.t(`) misses nothing.

import * as vscode from 'vscode';
import { setLocale, type L10nBundle } from '../shared/l10n';
import { setHostBundle } from './l10nEnglish';

/**
 * The bundle VS Code loaded for this window (`vscode.l10n.bundle`), or `undefined` when none was
 * loaded: VS Code in English loads no bundle, and `t` then returns the English message, which is
 * the key. `chatWebview.ts` hands it to the webview HTML from here, because ESLint keeps
 * `vscode.l10n` out of every other file.
 */
export const hostBundle: L10nBundle | undefined = vscode.l10n.bundle;

/** Number of keys of {@link hostBundle}, `undefined` when there is none. */
export const loadedBundleKeys: number | undefined =
  hostBundle === undefined ? undefined : Object.keys(hostBundle).length;

setHostBundle(hostBundle ?? {});
setLocale(vscode.env.language);

/** The `l10n: ...` line `extension.ts` writes to the log: language and size of the loaded bundle. */
export function describeL10n(): string {
  return `l10n: locale ${vscode.env.language}, bundle ${loadedBundleKeys === undefined ? 'none' : `${loadedBundleKeys} keys`}`;
}
