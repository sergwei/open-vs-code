import { createMemo, Index, Show } from 'solid-js';
import { PathLink } from './PathLink';
import { clampLines, type DiffLine } from './patchLines';
import { MAX_LINES } from './OutputBlock';

/** The marker written at the start of each kind of line, so colour is never the only signal. */
const MARKER: Readonly<Record<DiffLine['kind'], string>> = {
  hunk: '',
  add: '+',
  del: '-',
  ctx: ' ',
};

/**
 * A mini diff: one line per element, coloured by kind with the `--vscode-diffEditor-*` variables
 * and always marked with `+`/`-` in the text (high contrast themes, colour blindness).
 *
 * Decision (a) of Sergio, 22/10/2026: our own renderer over the unified patch the server already
 * computed (`parsePatch`), no diff library. `<Index>` and not `<For>`: the lines are plain objects
 * made fresh by the parent's memo and a diff has no stable identity per line, so mapping by
 * position is the right key (solid-webview skill section 2). Only the first {@link MAX_LINES}
 * lines are painted, with a notice; the diff is not highlighted by language. Long lines scroll
 * sideways instead of wrapping so the columns keep their meaning. The file name opens the file when
 * the section has a `path`.
 * VERIFIED by `ToolCard.test.tsx` (classes, markers and the clip notice from fabricated lines).
 * VERIFIED in a real VS Code (`test:visual` step 15, 22/10/2026 final run 13:59-14:05, Windows 11,
 * VS Code 1.143.0, `.vscode-test/visual/run-output.txt` lines 336-370) for a real 1-line edit: the
 * open card had 1 added and 1 deleted line, and the checks
 * "diff text contrast >= 4.5 in light|dark|hc-dark|hc-light" passed (add/del 9.21/7.46 light,
 * 5.98/7.94 dark, 21.00 hc-dark, 14.55 hc-light; hc themes use a 2.4px left border, no tint).
 * Those ratios are text against the line background; the contrast of the tint against the plain
 * background was not measured. NOT observed: a diff longer than the clip (the real one had 8 lines),
 * a `write` or `patch` diff, a screen reader reading "+ text".
 */
export function DiffView(props: { label: string; path?: string; lines: DiffLine[] }) {
  const clamped = createMemo(() => clampLines(props.lines, MAX_LINES, 'head'));
  return (
    <div class="tool-section" role="group" aria-label={props.label}>
      <div class="tool-section-header">
        <Show when={props.path} fallback={<span class="tool-section-label">{props.label}</span>}>
          {(path) => <PathLink path={path()} />}
        </Show>
      </div>
      <div class="diff-view" tabindex="0" role="group" aria-label={`Changes in ${props.label}`}>
        <Index each={clamped().items}>
          {(line) => (
            <div class="diff-line" data-kind={line().kind}>
              <span class="diff-marker">{MARKER[line().kind]}</span>
              <span class="diff-text">{line().text}</span>
            </div>
          )}
        </Index>
      </div>
      <Show when={clamped().hidden > 0}>
        <p class="tool-notice">
          {`Showing the first ${String(clamped().items.length)} of ${String(props.lines.length)} lines.`}
        </p>
      </Show>
    </div>
  );
}
