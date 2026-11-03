// The VS Code side of the plugin consent (issue #153): the real `launchGuard` of `ServerManager`
// and the "forget" command. The policy, the store and the wording are `pluginConsent.ts`, the scan
// is `projectPlugins.ts`; this module only joins them to `showWarningMessage` and `globalState`.
//
// Out of scope, recorded on purpose: opencode can also instantiate ANOTHER location (a session
// whose location is a different folder) and load that folder's plugins; nothing here covers it
// (the layers of the served folder are lazy, VERIFIED in `projectPlugins.ts`; for another location
// it is HYPOTHESIS, `makeLocationNode`, not exercised). A plugin that
// appears while the server runs is hot-reloaded by opencode (`source.ts` L81-90) with no notice.

import * as vscode from 'vscode';
import {
  confirmDetail,
  createDecisionStore,
  decideLaunch,
  noticeMessage,
  type DecisionStore,
} from './pluginConsent';
import {
  folderKey,
  pluginFingerprint,
  scanProjectPlugins,
  type PluginFinding,
} from './projectPlugins';
import { sanitizeLinkText } from './attentionPolicy';
import { PROJECT_PLUGIN_DECISIONS_KEY } from './ids';
import type { ServerLog } from './opencodeServer';
import type { LaunchGuardRequest, LaunchGuardVerdict, ServerState } from './serverManager';

/** Button of the notice and of the modal that allows the plugins of the folder. */
const START_ANYWAY = 'Start anyway';
/** Button of the notice that remembers a refusal. */
const DONT_START = "Don't start";

/** What {@link createPluginConsent} needs from the rest of the extension. */
export interface PluginConsentOptions {
  /** `context.globalState`: per machine, never `setKeysForSync` (the keys are local paths). */
  memento: vscode.Memento;
  log: ServerLog;
  /** The manager's current state, read when a late answer arrives. */
  serverState: () => ServerState;
  /** The folder the server is set to serve now, or undefined when there is none. */
  servedFolder: () => string | undefined;
  /** `manager.restart('command')`, called after a late "Start anyway". */
  restart: () => Promise<unknown>;
}

/** The guard for `ServerManagerDeps.launchGuard` and the action of the forget command. */
export interface PluginConsent {
  launchGuard(request: LaunchGuardRequest): Promise<LaunchGuardVerdict>;
  /** Forgets the decision of the served folder and tells the user; changes no running server. */
  forgetServedFolder(): Promise<void>;
}

/**
 * Builds the launch guard (scan, policy, notice or modal, store) and the forget action.
 *
 * Flow per launch: scan the folder (`scanProjectPlugins` never rejects: an unreadable entry counts
 * as absent, see its header; if it rejected anyway the rejection propagates and `ServerManager`
 * treats it as a `hold`, FAILING CLOSED with an error line, covered by the unit test "a guard
 * that rejects fails closed"; there is deliberately no catch here that would let the launch go),
 * then, if the attempt was aborted meanwhile, `hold` without showing anything, then
 * {@link decideLaunch}. `go` lets the launch through; `hold`
 * stays unlaunched in silence; `notify` returns `hold` AT ONCE and shows a non-modal notice (at
 * most one open per folder, so a repeated detection does not stack them); `confirm` waits for a
 * modal because the user just asked. "Start anyway" on the notice records `allow` and restarts
 * only if the manager is still `not-started/project-plugins` and still serves that folder (the
 * answer may come minutes later, vscode-extension section 7, plan B); closing the notice records
 * nothing. A blocked launch logs `project plugins in <folder>: <n> (<list>)`, and the config files
 * opencode would reject as invalid JSONC are logged as warnings.
 *
 * VERIFIED in a real VS Code with the synthetic server (Windows 11, VS Code 1.144.1, 03/11/2026,
 * the full `npm run test:visual` on the final tree: step 40 all ok; its only FAIL was F2 of step
 * 36, a known intermittent, which passed alone): "ok   P1 the toast …
 * offers Start anyway and Don't start" (notice), "ok   P3 after Don't start and a Reload the block is
 * logged (true), no toast shows (false) and nothing starts" (deny), "ok   P4 a modal lists the
 * plugin and offers Start anyway" and "ok   P4 Start anyway connects and the card is gone" (modal
 * and allow), "ok   P5 after a Reload the server connects with no toast and no modal (allow
 * remembered)", "ok   P6 a new plugin file asks again" (fingerprint) and "ok   P7 Cancel leaves the
 * chat not started". NOT observed: the late "Start anyway" of the notice (the run never pressed it
 * on the notice), the revalidation branch (state or folder changed meanwhile), the early `hold`
 * of an attempt aborted during the scan, the link-stripped folder in the forget message (the P7
 * check matches only its start), macOS and Linux. UNVERIFIED until a visual step aborts a start
 * during the scan.
 * The pure parts are tested by `pluginConsent.test.ts` and `projectPlugins.test.ts`.
 */
export function createPluginConsent(options: PluginConsentOptions): PluginConsent {
  const store: DecisionStore = createDecisionStore(options.memento, PROJECT_PLUGIN_DECISIONS_KEY);
  const open = new Set<string>();

  const describe = (folder: string, findings: readonly PluginFinding[]): string =>
    `project plugins in ${folder}: ${findings.length} (${confirmDetail(findings, folder).replace(/\n/g, ', ')})`;

  /** Shows the non-modal notice and handles the answer; never throws. */
  const showNotice = async (
    folder: string,
    findings: readonly PluginFinding[],
    fingerprint: string,
  ): Promise<void> => {
    const key = folderKey(folder);
    if (open.has(key)) return;
    open.add(key);
    try {
      const choice = await vscode.window.showWarningMessage(
        noticeMessage(findings, folder),
        START_ANYWAY,
        DONT_START,
      );
      if (choice === DONT_START) {
        await store.record(folder, 'deny', fingerprint);
      } else if (choice === START_ANYWAY) {
        await store.record(folder, 'allow', fingerprint);
        const state = options.serverState();
        const served = options.servedFolder();
        if (
          state.kind === 'not-started' &&
          state.reason === 'project-plugins' &&
          served !== undefined &&
          folderKey(served) === key
        ) {
          await options.restart();
        }
      }
    } catch (error) {
      options.log.error(
        `plugin notice failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      open.delete(key);
    }
  };

  /** The modal of an explicit start; true only on "Start anyway" (and it records `allow`). */
  const confirm = async (
    folder: string,
    findings: readonly PluginFinding[],
    fingerprint: string,
  ): Promise<boolean> => {
    const choice = await vscode.window.showWarningMessage(
      'This folder has opencode plugins that will run with your permissions. Start opencode anyway?',
      { modal: true, detail: confirmDetail(findings, folder) },
      START_ANYWAY,
    );
    if (choice !== START_ANYWAY) return false;
    await store.record(folder, 'allow', fingerprint);
    return true;
  };

  return {
    async launchGuard(request) {
      const { folder, userAsked, signal } = request;
      const scan = await scanProjectPlugins(folder);
      // A start the user asked for, or a stop, may have aborted this attempt during the scan: show
      // neither the notice nor the modal for an attempt that is already dead.
      if (signal.aborted) return 'hold';
      for (const file of scan.skipped) {
        options.log.warn(
          `opencode ignores ${file} (not valid JSON), so it is not scanned for plugins`,
        );
      }
      const fingerprint = pluginFingerprint(scan.findings);
      const action = decideLaunch({
        findings: scan.findings,
        stored: store.read(folder),
        fingerprint,
        userAsked,
      });
      if (action === 'go') return 'go';
      options.log.info(describe(folder, scan.findings));
      if (action === 'notify') {
        void showNotice(folder, scan.findings, fingerprint);
        return 'hold';
      }
      if (action === 'confirm') {
        const allowed = await confirm(folder, scan.findings, fingerprint);
        return allowed && !signal.aborted ? 'go' : 'hold';
      }
      return 'hold';
    },
    async forgetServedFolder() {
      const folder = options.servedFolder();
      if (folder === undefined) {
        void vscode.window.showInformationMessage('OpenCode: no folder is being served.');
        return;
      }
      const removed = await store.forget(folder);
      // The path is chosen by whoever opened the folder; same link-stripping as the notice.
      const shown = sanitizeLinkText(folder);
      void vscode.window.showInformationMessage(
        removed
          ? `OpenCode will ask again before it starts opencode in ${shown}.`
          : `No plugin decision is stored for ${shown}.`,
      );
    },
  };
}
