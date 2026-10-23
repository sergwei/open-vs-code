import { Show } from 'solid-js';
import type { RevertState } from '../../../src/shared/model';
import { ChangedFilesList } from './ChangedFilesList';
import { revertFilesCaption, revertOpenName, revertTitle, type RevertSplit } from './revertView';

/**
 * The block under the conversation while a revert is prepared (issue #32, decision of Sergio
 * 23/10/2026): "N messages reverted", the files the revert changed on disk (the same rows as
 * "Changed files"; a click shows what the revert undid in that file) and two buttons, "Restore"
 * (bring everything back) and "Discard for good" (delete the reverted messages; the HOST asks for
 * the confirmation with a native modal). A line says that sending a message makes it final too,
 * because the server commits a prepared revert when a prompt arrives and nothing asks then. When
 * the revert changed files, another line warns about edits made by hand: preparing rewrites each
 * file to how it was before the first reverted turn touched it (so later own edits go too), only
 * "Restore" brings them back from the copy the server kept, Restore rewrites from that copy (so
 * edits made while reverted are lost), and committing drops the copy (read in
 * `core/src/session/revert.ts` and `session.ts` @843a6c51; decisions of Sergio 23/10/2026, Engram
 * `E7-message-revert/decisions/aviso-ediciones` and `aviso-ediciones-matices`).
 *
 * PRESENTATIONAL: it knows nothing about the store or the host. It lives OUTSIDE the
 * `role="log"` list, between the conversation and the prompt, so the log keeps the children
 * `test:visual` counts. `disabled` makes both buttons `aria-disabled` (a busy session or another
 * revert request in flight): never `disabled`, so the focus stays on the button (skill
 * solid-webview §7), and the click is ignored. Text uses the foreground colours and the warning
 * tone only in the border (lesson: no error colour as text on the sidebar). No `style` attribute.
 * VERIFIED in jsdom by `RevertBanner.test.tsx` with fabricated state (title, the two notes, rows,
 * buttons, the ignored click when disabled; 23/10/2026). VERIFIED by `test:visual` (real VS Code
 * 1.143, Windows 11, synthetic server, 23/10/2026): the checks "the block is outside the log" and "the
 * block has Restore and Discard for good" passed. The contrast checks of the block in the four
 * themes also passed, but their titles are built at run time per part and theme, so they are not
 * quoted. The modal behind "Discard for good" is covered in the header of `confirmRevertDiscard`.
 * Not observed: macOS/Linux, a screen reader reading the block.
 */
export function RevertBanner(props: {
  revert: RevertState;
  split: Pick<RevertSplit, 'revertedCount' | 'found'>;
  disabled: boolean;
  onRestore: () => void;
  onDiscard: () => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <section class="revert-banner" aria-label="Reverted messages">
      <p class="revert-banner-title">{revertTitle(props.split)}</p>
      <p class="revert-banner-note">
        Restore brings back what the revert replaced; sending a message or Discard for good makes it
        final.
      </p>
      <Show when={props.revert.files.length > 0}>
        <p class="revert-banner-note">
          Your own edits to these files since then were replaced too, and edits made while reverted
          are lost on Restore.
        </p>
        <p class="revert-banner-caption">{revertFilesCaption(props.revert.files.length)}</p>
        <ChangedFilesList
          files={props.revert.files}
          nameOf={revertOpenName}
          onOpen={props.onOpenFile}
        />
      </Show>
      <div class="revert-banner-actions">
        <button
          type="button"
          class="secondary"
          aria-disabled={props.disabled ? 'true' : undefined}
          onClick={() => {
            if (!props.disabled) props.onRestore();
          }}
        >
          Restore
        </button>
        <button
          type="button"
          class="secondary"
          aria-disabled={props.disabled ? 'true' : undefined}
          onClick={() => {
            if (!props.disabled) props.onDiscard();
          }}
        >
          Discard for good
        </button>
      </div>
    </section>
  );
}
