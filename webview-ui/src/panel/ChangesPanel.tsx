import * as l10n from '@vscode/l10n';
import { Show } from 'solid-js';
import type { ChangedFile, ErrorInfo } from '../../../src/shared/model';
import { changedFilesSummary } from '../changes/changedFileText';
import { ChangedFilesList } from '../changes/ChangedFilesList';

/**
 * The Changes tab (issue #188, phase 4): the files the open session changed, as the list of issue
 * #31 used to show them under the header, now always open, with a heading that counts them and an
 * empty state for a session that changed nothing yet. Presentational: `App` decides what `onOpen`
 * sends (`session.diff.open`) and mounts the panel only while its tab is active.
 *
 * The heading is a real `<h2>` named by the same sentence the old summary had ("Changed files (3)"),
 * which `test:visual` reads. A failure to refresh (`error`) is plain text in the foreground colour
 * above the last list the host had, and it shows with an empty list too. No `style` attribute.
 * VERIFIED in jsdom by `ChangesPanel.test.tsx` (heading, rows, empty state, error with and without
 * rows, the row click reporting the exact path). VERIFIED in a real VS Code 1.146.0 on Windows 11
 * (12/11/2026, `test:visual --steps 17,18,19`, synthetic server): "ok   the Changes tab says no file
 * changed in this session yet", "ok   the heading counts the files ("Changed files (4)")", "ok   the
 * Changes tab badge counts the files ("4")" and the contrast of the heading, path and status line
 * in the four themes ("ok   the summary text of the changed files has contrast >= 4.5 in dark
 * (6.55)"). UNVERIFIED: macOS, Linux and the error line in a real window (jsdom only).
 */
export function ChangesPanel(props: {
  files: readonly ChangedFile[];
  error: ErrorInfo | undefined;
  onOpen: (path: string) => void;
}) {
  return (
    <>
      <Show when={props.error}>
        {(failure) => (
          <p class="changed-files-error">
            {l10n.t('Could not refresh the list: {0}', failure().message)}
          </p>
        )}
      </Show>
      <Show
        when={props.files.length > 0}
        fallback={<p class="panel-empty">{l10n.t('No files changed in this session yet')}</p>}
      >
        <section class="changed-files" aria-labelledby="changed-files-title">
          <h2 class="changed-files-title" id="changed-files-title">
            {changedFilesSummary(props.files.length)}
          </h2>
          <ChangedFilesList files={props.files} onOpen={props.onOpen} />
        </section>
      </Show>
    </>
  );
}
