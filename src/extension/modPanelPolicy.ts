// Pure rules of the mod panels (E10-mods-hardening, plan Engram #1863 sections 2a and 2c). No
// `vscode` import, so Vitest runs them against real temporary folders (`modPanelPolicy.test.ts`).
// `modPanels.ts` is the VS Code side that uses them.

import { realpath, stat } from 'node:fs/promises';
import { MAX_PANEL_MESSAGE_BYTES } from '../mods/wire';
import { resolveInsideFolder } from './pathPolicy';

/**
 * Window of the warning about messages the page sent that were dropped: at most one `warn` per
 * panel per window. The same 1 s as the log cap of E10-mods-limits (`LOG_LINES_PER_SECOND`,
 * Sergio's decision, Engram #1861). They are two constants because that branch is not in `main`
 * yet; reconcile them when it is.
 */
export const PANEL_DROP_WARN_WINDOW_MS = 1000;

/**
 * Resolves `relative` inside `dir` and returns the real path of an existing file, or throws.
 *
 * `dir` is already a real path (`DiscoveredMod.dir`). The lexical check catches `..`; `realpath`
 * then follows symlinks, and the second check refuses a link that leaves the folder, so a FILE
 * the mod declares (`html`, `scripts`, `styles`) cannot be outside the mod. The file must also be
 * at most 1 MB. This does NOT cover what the page asks for by itself: VS Code serves a resource
 * when its path is under `localResourceRoots` as text, without `realpath`, so a link inside the
 * folder that points outside is readable from the page (see `docs/mods.md`, Panels, and the
 * check "P7" of `test:visual` step 39).
 * VERIFIED (Windows 11, Vitest, 03/11/2026) by `modPanelPolicy.test.ts`: "R1: refuses a declared
 * file under a junction that leaves the folder" (`realpath` follows a junction) and "R3: accepts
 * a link that stays inside the folder and returns the real path". Mutation: without the second
 * check, R1 fails. A link to a FILE (R2) is skipped when the OS refuses to create it.
 */
export async function resolveModFile(dir: string, relative: string): Promise<string> {
  const lexical = resolveInsideFolder(dir, relative);
  if (lexical === undefined) throw new Error(`"${relative}" is outside the mod folder`);
  const real = await realpath(lexical);
  if (resolveInsideFolder(dir, real) === undefined) {
    throw new Error(`"${relative}" is outside the mod folder`);
  }
  if ((await stat(real)).size > MAX_PANEL_MESSAGE_BYTES) {
    throw new Error(`"${relative}" is larger than 1 MB`);
  }
  return real;
}

/**
 * Creates a gate that lets one event through per window: it returns `true` the first time and
 * then `false` until `windowMs` has passed since the last `true`.
 *
 * A panel keeps one for the warning of a dropped page message, so a page that floods invalid
 * messages writes one line a second instead of one per message. `now` is injected for tests.
 * VERIFIED by `modPanelPolicy.test.ts` "W1" to "W3" with a fake clock
 * (Windows 11, Vitest, 03/11/2026; synthetic: it proves the gate, not a real page flooding).
 */
export function createWarnGate(windowMs: number, now: () => number = Date.now): () => boolean {
  let last: number | undefined;
  return () => {
    const at = now();
    if (last !== undefined && at - last < windowMs) return false;
    last = at;
    return true;
  };
}
