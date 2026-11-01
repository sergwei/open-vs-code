// The native VS Code dialogs of the provider sign-in (issue #128, E10): the `vscode` implementation
// of the `AuthUi` that `providerAuth.ts` is written against. The API key and the OAuth code are
// asked HERE, in a masked native InputBox of the host, never in the webview (architecture rule 1);
// nothing in this module logs what it receives or returns.

import * as vscode from 'vscode';
import { COPY_AUTH_CODE_COMMAND_ID } from './ids';
import {
  cleanInstructions,
  type AuthProgressHandle,
  type AuthProgressView,
  type AuthUi,
} from './providerAuth';
import type { OpenExternalSeam } from './testLaunch';

/**
 * Answers the integration tests give in advance, because they cannot type into a masked
 * InputBox or click a modal. One-shot, like `testAnswers` of the Sessions tree: each answer is
 * used by the NEXT dialog of its kind and then forgotten. `null` dismisses the box. `approve:
 * false` is NOT one-shot: it makes the browser seam open nothing until the next answers say
 * otherwise, so an OAuth attempt stays pending (see `TEST_PROVIDER_ANSWERS_COMMAND_ID`).
 */
export interface ProviderTestAnswers {
  key?: string | null;
  code?: string | null;
  confirm?: boolean;
  approve?: boolean;
}

/** What {@link createProviderAuthUi} is given besides `vscode`. */
export interface ProviderAuthUiOptions {
  /**
   * The browser stand-in of the fake/visual launch (`fakeOpenExternal`); absent in production,
   * where `env.openExternal` opens the real browser.
   */
  openExternalSeam?: OpenExternalSeam;
  /** The pre-answers of `ExtensionMode.Test`; absent elsewhere, where every dialog is shown. */
  answers?: ProviderTestAnswers;
}

/**
 * The link the notification shows for "Copy code". It carries NO argument: the command copies the
 * code of the attempt in progress, so a crafted `command:` link cannot set the clipboard.
 */
const COPY_CODE_LINK = `[Copy code](command:${COPY_AUTH_CODE_COMMAND_ID})`;

/** Text of the notification: the instructions, and the link when there is a code to copy. */
function progressMessage(view: AuthProgressView): string {
  return view.code === undefined ? view.instructions : `${view.instructions} ${COPY_CODE_LINK}`;
}

/**
 * Builds the native {@link AuthUi}.
 *
 * `askSecret` is an InputBox with `password: true` and `ignoreFocusOut: true` (a click elsewhere
 * must not lose a pasted key) whose `validateInput` rejects an empty or blank value; the value is
 * returned trimmed. Both `askSecret` and `askCode` close their box when `signal` aborts (the
 * attempt was cancelled from the card or the notification); `askCode` is the same box without the
 * mask, but a separate copy of the code. VERIFIED for `askSecret` only, in a real VS Code 1.144.0
 * on Windows 11 (1/11/2026, `npm run test:visual --
 * --group config`, synthetic server; the dialogs are NOT pre-answered there): "ok   V7 Enter API
 * key… opens a native InputBox titled "API key for Azure" whose input is type=password and has the
 * focus, while the webview holds no password input" and "ok   W1 Cancel in the card closes the
 * native InputBox (closed true) and the card goes back to Add a provider …" (both are Azure, an API
 * key). UNVERIFIED for `askCode` in
 * a real window: no `test:visual` cell drives a `code` attempt, so its close on abort is only
 * covered by the fake-server integration cases. `progress` is a cancellable
 * notification (`withProgress`, which has no buttons of its own: "Copy code" is a `command:` link
 * in its text, so the title and the instructions are stripped of `[ ] ( )` first,
 * `vscode-extension` section 7). `confirm` is a modal warning. `copy` writes to the clipboard.
 *
 * VERIFIED in a real VS Code 1.144.0 on Windows 11 (1/11/2026, `npm run test:integration -- --label
 * fake-server`, 54 passing) through the seams of this module, with the dialogs PRE-ANSWERED by
 * `TEST_PROVIDER_ANSWERS_COMMAND_ID`: "✔ connects a provider with an API key and never writes the
 * key to the log or the state", "✔ completes an OAuth login whose link the test browser approves",
 * "✔ shows the waiting attempt, copies its code and cancels it" and "✔ removes a credential only
 * after a yes, and refuses one of another provider". That proves the flow, not the native widgets.
 * The widgets, VERIFIED in the `test:visual` run above: "ok   V8 the native notification shows the
 * instructions, a "Copy code" link and a Cancel button …", "ok   V8 the Copy code link of the
 * notification puts ABCD-1234 on the clipboard …", "ok   V8 Cancel in the notification ends the
 * attempt: the card is back in Add a provider (true) and the notification is gone (true)" and "ok
 * V9 Remove opens a VS Code modal that names Azure and says opencode stores it for all projects …".
 * That run also found that the webview card took the focus back from the box a moment after it
 * appeared (`ProvidersSection` now leaves the focus alone while its document has none), so a key
 * could not be typed until the box was clicked: "ok   V7 the native box still has the focus after
 * the card moved to Connected …" guards it.
 */
export function createProviderAuthUi(options: ProviderAuthUiOptions = {}): AuthUi {
  const answers = options.answers;

  /** Takes a one-shot answer of `field` out of the pre-answers; `found` tells it was there. */
  const takeAnswer = (field: 'key' | 'code'): { found: boolean; value?: string } => {
    if (answers === undefined || answers[field] === undefined) return { found: false };
    const value = answers[field];
    delete answers[field];
    return value === null ? { found: true } : { found: true, value };
  };

  return {
    askSecret: async (prompt) => {
      const given = takeAnswer('key');
      if (given.found) return given.value;
      const source = new vscode.CancellationTokenSource();
      const abort = (): void => source.cancel();
      if (prompt.signal.aborted) abort();
      prompt.signal.addEventListener('abort', abort, { once: true });
      try {
        const value = await vscode.window.showInputBox(
          {
            title: prompt.title,
            ...(prompt.placeholder === undefined ? {} : { placeHolder: prompt.placeholder }),
            password: true,
            ignoreFocusOut: true,
            validateInput: (text) => (text.trim() === '' ? 'Enter the API key' : undefined),
          },
          source.token,
        );
        return value?.trim();
      } finally {
        prompt.signal.removeEventListener('abort', abort);
        source.dispose();
      }
    },

    askCode: async (prompt) => {
      const given = takeAnswer('code');
      if (given.found) return given.value;
      const source = new vscode.CancellationTokenSource();
      const abort = (): void => source.cancel();
      if (prompt.signal.aborted) abort();
      prompt.signal.addEventListener('abort', abort, { once: true });
      try {
        const value = await vscode.window.showInputBox(
          {
            title: prompt.title,
            ...(prompt.placeholder === undefined ? {} : { placeHolder: prompt.placeholder }),
            ignoreFocusOut: true,
            validateInput: (text) => (text.trim() === '' ? 'Enter the code' : undefined),
          },
          source.token,
        );
        return value?.trim();
      } finally {
        prompt.signal.removeEventListener('abort', abort);
        source.dispose();
      }
    },

    openExternal: (url) => {
      if (options.openExternalSeam !== undefined) {
        // The pre-answer `approve: false` leaves the attempt pending (the cancel test).
        if (answers?.approve === false) return Promise.resolve(true);
        return options.openExternalSeam(url);
      }
      return Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url, true)));
    },

    progress: (view, onCancel): AuthProgressHandle => {
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let report: ((message: string) => void) | undefined;
      let pending = progressMessage(view);
      void vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: cleanInstructions(view.title),
          cancellable: true,
        },
        (progress, token) => {
          report = (message) => progress.report({ message });
          report(pending);
          token.onCancellationRequested(onCancel);
          return finished;
        },
      );
      return {
        update: (next) => {
          pending = progressMessage(next);
          report?.(pending);
        },
        dispose: () => finish(),
      };
    },

    confirm: async (prompt) => {
      if (answers?.confirm !== undefined) {
        const given = answers.confirm;
        delete answers.confirm;
        return given;
      }
      const choice = await vscode.window.showWarningMessage(
        prompt.message,
        { modal: true },
        prompt.action,
      );
      return choice === prompt.action;
    },

    copy: async (text) => {
      await vscode.env.clipboard.writeText(text);
    },
  };
}
