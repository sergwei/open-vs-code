// The VS Code side of the plugin consent (issue #153): the real `launchGuard` of `ServerManager`
// and the "forget" command. The policy, the store and the wording are `pluginConsent.ts`, the scan
// is `projectPlugins.ts`; this module only joins them to `showWarningMessage` and `globalState`.
//
// Out of scope, recorded on purpose: opencode can also instantiate ANOTHER location (a session
// whose location is a different folder) and load that folder's plugins; nothing here covers it
// (the layers of the served folder are lazy, VERIFIED in `projectPlugins.ts`; for another location
// it is HYPOTHESIS, `makeLocationNode`, not exercised). A plugin that appears while the server
// runs is covered by `watchServedPlugins` (issue #158, below): opencode runs with its file watcher
// off, so it does not load the plugin, and the extension stops the server and asks.

import * as vscode from 'vscode';
import {
  confirmDetail,
  createDecisionStore,
  decideLaunch,
  needsReview as policyNeedsReview,
  noticeMessage,
  type DecisionStore,
} from './pluginConsent';
import { createPluginRecheck } from './pluginRecheck';
import {
  folderKey,
  pluginFingerprint,
  scanProjectPlugins,
  type PluginFinding,
} from './projectPlugins';
import { sanitizeLinkText } from './attentionPolicy';
import { PROJECT_PLUGIN_DECISIONS_KEY } from './ids';
import type { ServerLog } from './opencodeServer';
import type {
  LaunchGuardRequest,
  LaunchGuardVerdict,
  RunningServerInfo,
  ServerManager,
  ServerState,
} from './serverManager';

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
  /**
   * Scans `folder` and says whether its plugins need the user's review: the launch the extension
   * would make by itself would not be a `go`. Shows nothing and records nothing (issue #158).
   */
  needsReview(folder: string): Promise<boolean>;
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
 * opencode would reject as invalid JSONC are logged as warnings. `needsReview(folder)` (issue
 * #158) runs the same scan, warnings and policy for a running server without asking anything: it
 * only answers whether a launch by the extension would not be a `go`.
 *
 * VERIFIED in a real VS Code with the synthetic server (Windows 11, VS Code 1.144.1, 03/11/2026,
 * the full `npm run test:visual` of PR #168, the first on a tree where step 40 runs again after
 * the title fix of f823025, which ended "all visual checks passed", step 40 in 24.0 s):
 * "ok   P1 the toast …
 * offers Start anyway and Don't start" (notice), "ok   P3 after Don't start and a Reload the block is
 * logged (true), no toast shows (false) and nothing starts" (deny), "ok   P4 a modal lists the
 * plugin and offers Start anyway" and "ok   P4 Start anyway connects and the card is gone" (modal
 * and allow), "ok   P5 after a Reload the server connects with no toast and no modal (allow
 * remembered)", "ok   P6 a plugin added while the server runs stops it and asks again: the toast
 * is back (true), the log has the block line (true) and "restarting the server
 * (plugins-changed)" (true), and the chat is not-started (true)" (this replaced the old P6 "a new
 * plugin file asks again", which is no longer cited) and "ok   P7 Cancel leaves the chat not
 * started". `needsReview` is VERIFIED through that P6 (the restart reaches the guard only because
 * `needsReview` answered true) and through the integration case "restarts for a plugin that
 * arrives while the server runs, and for nothing else" (I3, same day and machine); its policy
 * is the `needsReview` table of `pluginConsent.test.ts`. NOT observed: the late "Start anyway" of
 * the notice (the run never pressed it on the notice), the revalidation branch (state or folder
 * changed meanwhile), the early `hold` of an attempt aborted during the scan, the link-stripped
 * folder in the forget message (the P7 check matches only its start), macOS and Linux. UNVERIFIED
 * until a visual step aborts a start during the scan.
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
    async needsReview(folder) {
      const scan = await scanProjectPlugins(folder);
      for (const file of scan.skipped) {
        options.log.warn(
          `opencode ignores ${file} (not valid JSON), so it is not scanned for plugins`,
        );
      }
      return policyNeedsReview({
        findings: scan.findings,
        stored: store.read(folder),
        fingerprint: pluginFingerprint(scan.findings),
      });
    },
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

/**
 * Keeps an eye on the plugins of the served folder while the extension's own server runs, and
 * restarts the server through the consent guard when they need review (issue #158).
 *
 * Why: opencode loads a plugin that appears while it runs, but `buildServeEnv` turns its file
 * watcher off, so a new plugin is not loaded and the guard of #153, which only asks before a
 * start, would never see it. On `running` with `source: 'spawned'` it creates a
 * `FileSystemWatcher` on `{opencode.json,opencode.jsonc,.opencode,.opencode/**}` of the folder
 * (create, change and delete all `poke` the re-check) and starts the re-check, which also looks
 * once at once, because a plugin may have arrived during `starting`. Leaving `running` (a restart,
 * a crash, a stop) disposes the watcher and stops the re-check; an external server is never
 * watched (its files are not ours). The restart is `manager.restart('plugins-changed')`, so the
 * guard decides with `userAsked: false`: the notice, the silent `hold` for a stored `deny`, or
 * nothing if the new fingerprint is allowed.
 *
 * Not covered, on purpose: the folders above the served one (opencode's own 24 h rescan, and the
 * one it runs on a config `Event.Updated`, still reach them; both read in `supervisor.ts` of the
 * spike #1849, not executed), `files.watcherExclude` (a folder excluded from VS Code's watcher raises no event)
 * and symlinked plugin folders. A plugin written during `starting` can run once before the check
 * at `running` stops the server.
 * VERIFIED in a real VS Code with the synthetic server (Windows 11, VS Code 1.144.1, 03/11/2026,
 * `npm run test:integration -- --label project-plugins`): "✔ restarts for a plugin that arrives
 * while the server runs, and for nothing else", so one `RelativePattern` with braces and `/**`
 * delivers the event of a new `.opencode/plugins/late.js`, the restart goes through the guard and
 * ends held. HYPOTHESIS (read in the code, no test exercises `watchServedPlugins` itself apart from
 * that check and the visual P6): leaving `running`, a crash or `dispose` disposes the watcher and
 * stops the re-check, and an external server is never watched; to check it, inject the watcher
 * factory and drive a fake manager through those states. NOT observed: a plugin created inside a
 * folder that did not exist when the watcher was created, `opencode.json` edits,
 * `files.watcherExclude`, macOS and Linux (inotify limits included).
 */
export function watchServedPlugins(
  manager: Pick<ServerManager, 'state' | 'onDidChangeState' | 'restart'>,
  consent: Pick<PluginConsent, 'needsReview'>,
  log: ServerLog,
): vscode.Disposable {
  const recheck = createPluginRecheck({
    check: (folder) => consent.needsReview(folder),
    restart: () => manager.restart('plugins-changed'),
    isRunning: (folder) => {
      const state = manager.state;
      return (
        state.kind === 'running' &&
        state.server.source === 'spawned' &&
        folderKey(state.server.folder) === folderKey(folder)
      );
    },
    log,
  });
  let watcher: vscode.FileSystemWatcher | undefined;
  let watched: RunningServerInfo | undefined;

  const release = (): void => {
    watcher?.dispose();
    watcher = undefined;
    watched = undefined;
    recheck.stop();
  };
  const apply = (state: ServerState): void => {
    if (state.kind !== 'running' || state.server.source !== 'spawned') {
      release();
      return;
    }
    if (watched === state.server) return;
    release();
    watched = state.server;
    const folder = state.server.folder;
    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(folder),
        '{opencode.json,opencode.jsonc,.opencode,.opencode/**}',
      ),
    );
    const poke = (): void => {
      recheck.poke();
    };
    watcher.onDidCreate(poke);
    watcher.onDidChange(poke);
    watcher.onDidDelete(poke);
    log.debug(`watching the plugins of ${folder} while the server runs`);
    recheck.start(folder);
  };

  const subscription = manager.onDidChangeState(apply);
  apply(manager.state);
  return {
    dispose: () => {
      subscription.dispose();
      release();
    },
  };
}
