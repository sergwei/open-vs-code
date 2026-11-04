// Pure view model of the connection problems (E2, issue #85): the steps of the setup guide, the text
// of the error card and the rule that decides when the guide is on screen. No DOM and no Solid, so
// the texts and the rules are unit-tested. The texts are product copy: step 1 keeps one line per
// attempt (Sergio's decision of 27/10/2026, Engram #1315), not the literal P12 sentences of #1300.
import * as l10n from '@vscode/l10n';
import type { Catalog } from '../../../src/shared/model';
import type { BinaryChoice } from '../store/chatStore';
import type {
  BinaryCheck,
  BinaryDiagnosis,
  ConnectionState,
  SetupAction,
  WebviewToHost,
} from '../../../src/shared/protocol';

type Unavailable = Extract<ConnectionState, { state: 'unavailable' }>;

/**
 * A button of the guide or the card: its label and the exact message it sends to the host.
 * `disabled` (issue #86) means "busy, ignore the press": the guide renders it `aria-disabled`,
 * never `disabled`, so the keyboard focus it holds is not thrown to the body.
 */
export interface ViewAction {
  label: string;
  message: WebviewToHost;
  disabled?: boolean;
}

/**
 * `waiting` has not started, `running` is in progress, `done` passed, `failed` is the one to fix
 * and `checking` (issue #86) is the binary step while the detection judges the path just chosen.
 */
export type StepStatus = 'waiting' | 'running' | 'done' | 'failed' | 'checking';

/** One numbered step of the setup guide. `lines` are plain text (never markup). */
export interface GuideStep {
  id: 'binary' | 'connect' | 'server' | 'model';
  title: string;
  status: StepStatus;
  lines: string[];
  actions: ViewAction[];
}

/** The error card: `alert` interrupts a screen reader, `status` does not (a retry in progress). */
export interface ProblemView {
  title: string;
  cause?: string;
  actions: ViewAction[];
  role: 'alert' | 'status';
}

const setup = (label: string, action: SetupAction): ViewAction => ({
  label,
  message: { type: 'setup.action', action },
});
const restart = (label: string): ViewAction => ({ label, message: { type: 'server.restart' } });
// E11-i18n: every label and sentence below goes through `l10n.t` at call time (no module-level
// text), so the guide and the card follow the language the tests switch.
// VERIFIED by the checks "writes the steps, lines and actions of the guide in Spanish" and
// "writes the cards, buttons and connection text in Spanish, with the number in place" of
// `connectionView.test.ts` (the "Show logs" button as "Mostrar registros" in the second).
/** The "Show logs" button; a function so each call reads the active language. */
const showLogs = (): ViewAction => ({
  label: l10n.t('Show logs'),
  message: { type: 'logs.show' },
});

/** Reasons that only exist when the server is external (`openVsCode.serverUrl`). */
function isExternalReason(reason: Unavailable['reason']): boolean {
  return reason === 'unreachable' || reason === 'unauthorized' || reason === 'invalid-url';
}

/**
 * The guide's latch (decision P1=1): it turns on at an `unavailable` that has no conversation
 * behind it, stays on through the `starting` / `reconnecting` that follows (so the step "Start the
 * server" is seen running after Choose binary) and goes off at `connected`, at `stopped`, when a
 * conversation exists, in `not-started` (issue #124: it has its own "not running" card), or for
 * the folder problem, which has its own card (P15=2). A normal start
 * (`starting` then `connected`) never turns it on, so nothing flickers.
 * VERIFIED on Windows 11 with VS Code 1.143.1 (27/10/2026) by the visual checks "step 1 is done and
 * step 2 (Start the server) fails", "the guide is gone once connected" and "the normal empty state
 * is back" (real server restart after Choose binary). The unit tests use fabricated states only.
 */
export function nextGuideLatch(
  previous: boolean,
  connection: ConnectionState,
  hasConversation: boolean,
): boolean {
  if (hasConversation) return false;
  switch (connection.state) {
    case 'unavailable':
      return connection.reason !== 'no-workspace';
    case 'connected':
    case 'stopped':
    case 'not-started': // the "not running" card takes the place of the guide
      return false;
    case 'starting':
    case 'reconnecting':
      return previous;
  }
}

/** What each outcome of a binary check says; a function so each call reads the active language. */
function outcomeText(outcome: BinaryCheck['outcome']): string {
  switch (outcome) {
    case 'ok':
      return l10n.t('found');
    case 'duplicate':
      return l10n.t('already checked');
    case 'not-on-path':
      return l10n.t('not on PATH');
    case 'invalid':
      return l10n.t('the file does not exist or cannot be used');
    case 'run-failed':
      return l10n.t('it did not run');
    case 'unknown-version':
      return l10n.t('it did not report a version');
    case 'unsupported':
      return l10n.t('this is not opencode v2; open-vs-code needs v2');
    case 'skipped':
      return l10n.t('skipped');
  }
}

/** One line per check that explains the failure; `ok` and `duplicate` checks say nothing new. */
function checkLine(check: BinaryCheck): string | undefined {
  if (check.outcome === 'ok' || check.outcome === 'duplicate') return undefined;
  const who =
    check.source === 'setting'
      ? `openVsCode.opencodePath: ${check.path ?? l10n.t('(not set)')}`
      : `${check.source}${check.path === undefined ? '' : ` ${check.path}`}`;
  // An `invalid` check's detail already says why ("the file does not exist"): it replaces the
  // generic text instead of repeating it in parentheses (review W3).
  if (check.outcome === 'invalid' && check.detail !== '') return `${who}: ${check.detail}`;
  const what = outcomeText(check.outcome);
  return check.detail === '' ? `${who}: ${what}` : `${who}: ${what} (${check.detail})`;
}

/**
 * What the failed detection looked at, in the order it ran, plus the unset-setting note. The note
 * is added only when no attempt came from the setting: a setting that points at a v1 binary has an
 * attempt (and a line) of its own, and saying it "is not set" next to it would contradict it (B1).
 */
function binaryLines(binary: BinaryDiagnosis | undefined, fallback: string): string[] {
  if (binary === undefined) return [fallback];
  const lines = binary.checks.map(checkLine).filter((line): line is string => line !== undefined);
  const settingTried = binary.checks.some((c) => c.source === 'setting');
  if (binary.settingPath === undefined && !settingTried) {
    lines.push(l10n.t('openVsCode.opencodePath is not set.'));
  }
  return lines.length === 0 ? [fallback] : lines;
}

/**
 * The steps of the guide for `connection` (decisions P2=1, P14=1): binary, server, model; or, with
 * an external server, "Connect to the server…" and model. The step that fails carries what was
 * searched and its actions; steps after it wait. The model step is informational (never fails): it
 * is done when the catalog lists a model.
 * An `unsupported-version` WITH `binary` is step 1 (the detection found v1); WITHOUT it, it came
 * from `/api/info` after the server started, so it is step 2.
 * Issue #86 (`binaryCheck`): only while step 1 is the failed one, `choosing` keeps the step as
 * `failed` but turns "Choose binary…" busy (`disabled`), and `checking` turns step 1 into
 * `checking` with the single line "Checking <path>…" instead of the previous failure, "Choose
 * binary…" busy and "Install guide" still active. Step 2 stays `waiting`. Anywhere else (the
 * detection already passed, an external server) it is ignored, so a verdict is never hidden.
 * VERIFIED on Windows 11, VS Code 1.144.0 (28/10/2026), full `npm run test:visual`: "ok   Checking…
 * at 300 (bar 300 px), hc-light: the title says Checking… ("1. Find the opencode binary —
 * Checking…")" and the same lines in light, dark and hc-dark. The unit tests of
 * `connectionView.test.ts` use fabricated states only.
 */
export function guideSteps(
  connection: ConnectionState,
  catalog: Catalog | undefined,
  binaryCheck: BinaryChoice = { kind: 'idle' },
): GuideStep[] {
  const modelStep: GuideStep = {
    id: 'model',
    title: l10n.t('Pick a model'),
    status: (catalog?.models.length ?? 0) > 0 ? 'done' : 'waiting',
    lines: [l10n.t('Free models work without an account.')],
    actions: [],
  };

  if (connection.state === 'unavailable' && isExternalReason(connection.reason)) {
    return [
      {
        id: 'connect',
        title: l10n.t('Connect to the server in openVsCode.serverUrl'),
        status: 'failed',
        lines: [connection.error.message],
        actions: [
          ...(connection.reason === 'unauthorized'
            ? [setup(l10n.t('Set password'), 'server.password')]
            : []),
          setup(l10n.t('Open settings'), 'server.settings'),
          restart(l10n.t('Retry')),
        ],
      },
      modelStep,
    ];
  }

  const failure = connection.state === 'unavailable' ? connection : undefined;
  const binaryFailed =
    failure !== undefined &&
    (failure.reason === 'binary-missing' ||
      (failure.reason === 'unsupported-version' && failure.binary !== undefined));
  const serverFailed = failure !== undefined && !binaryFailed;

  const busy = binaryFailed && binaryCheck.kind !== 'idle';
  const binary: GuideStep = {
    id: 'binary',
    title: l10n.t('Find the opencode binary'),
    status: binaryFailed ? (binaryCheck.kind === 'checking' ? 'checking' : 'failed') : 'done',
    lines: binaryFailed
      ? binaryCheck.kind === 'checking'
        ? [l10n.t('Checking {0}…', binaryCheck.path)]
        : binaryLines(failure.binary, failure.error.message)
      : [],
    actions: binaryFailed
      ? [
          {
            ...setup(l10n.t('Choose binary…'), 'binary.choose'),
            ...(busy ? { disabled: true } : {}),
          },
          setup(l10n.t('Install guide'), 'install.guide'),
        ]
      : [],
  };
  const server: GuideStep = {
    id: 'server',
    title: l10n.t('Start the server'),
    status: binaryFailed ? 'waiting' : serverFailed ? 'failed' : 'running',
    lines: binaryFailed
      ? [l10n.t('Starts on its own after step 1.')]
      : failure !== undefined
        ? [failure.error.message]
        : [l10n.t('Starting…')],
    actions: serverFailed ? [restart(l10n.t('Restart')), showLogs()] : [],
  };
  return [binary, server, modelStep];
}

/**
 * The card for the problem `connection` shows inside the conversation (or in the empty view when
 * there is no conversation but the guide does not apply), or `undefined` when there is none.
 * `reconnecting` is a neutral `status` with only Show logs (the host is already retrying).
 * `no-workspace` is the simple "Open a folder to start" card (P15=2). `not-started` (issue #124)
 * is the "opencode is not running" status card with a Start button; its cause depends on the
 * `reason` (`auto-start-off`, or `project-plugins` of issue #153: the plugins of the folder were
 * not allowed yet and Start opens a confirmation). The `project-plugins` card is covered by a
 * SYNTHETIC unit test and VERIFIED in a real window (Windows 11, VS Code 1.144.1, 03/11/2026,
 * the full `npm run test:visual` on the final tree, step 40 all ok): "ok   P2 the chat card says opencode is not running
 * because of the plugins" and "ok   P4 Start is pressed on the card with the real mouse".
 * Not observed: other OSes and themes.
 */
export function describeProblem(connection: ConnectionState): ProblemView | undefined {
  if (connection.state === 'reconnecting') {
    return {
      title: l10n.t('Reconnecting to opencode (attempt {0})…', connection.attempt),
      actions: [showLogs()],
      role: 'status',
    };
  }
  if (connection.state === 'not-started') {
    return {
      title: l10n.t('opencode is not running'),
      cause:
        connection.reason === 'project-plugins'
          ? l10n.t(
              'This folder has opencode plugins that would run with your permissions. Press Start to review them.',
            )
          : l10n.t('openVsCode.autoStart is off. Send a prompt or press Start.'),
      actions: [restart(l10n.t('Start'))],
      role: 'status',
    };
  }
  if (connection.state !== 'unavailable') return undefined;
  const cause = connection.error.message;
  switch (connection.reason) {
    case 'exited':
      return {
        title: l10n.t('opencode stopped'),
        cause: l10n.t('The server exited unexpectedly. Your conversation is kept.'),
        actions: [restart(l10n.t('Restart')), showLogs()],
        role: 'alert',
      };
    case 'start-failed':
      return {
        title: l10n.t('opencode could not start'),
        cause,
        actions: [restart(l10n.t('Restart')), showLogs()],
        role: 'alert',
      };
    case 'unsupported-version':
      return {
        title: l10n.t('This opencode is not supported'),
        cause,
        actions: [setup(l10n.t('Choose binary…'), 'binary.choose'), showLogs()],
        role: 'alert',
      };
    case 'binary-missing':
      return {
        title: l10n.t('opencode was not found'),
        cause,
        actions: [setup(l10n.t('Choose binary…'), 'binary.choose'), showLogs()],
        role: 'alert',
      };
    case 'unreachable':
      return {
        title: l10n.t('Cannot reach the opencode server'),
        cause,
        actions: [
          restart(l10n.t('Retry')),
          setup(l10n.t('Open settings'), 'server.settings'),
          showLogs(),
        ],
        role: 'alert',
      };
    case 'unauthorized':
      return {
        title: l10n.t('The server needs a password'),
        cause,
        actions: [setup(l10n.t('Set password'), 'server.password'), showLogs()],
        role: 'alert',
      };
    case 'invalid-url':
      return {
        title: l10n.t('The server address is not valid'),
        cause,
        actions: [setup(l10n.t('Open settings'), 'server.settings')],
        role: 'alert',
      };
    case 'no-workspace':
      return {
        title: l10n.t('Open a folder to start'),
        cause: l10n.t('opencode needs a folder to work in.'),
        actions: [setup(l10n.t('Open folder'), 'folder.open')],
        role: 'alert',
      };
  }
}

/** Short text of the connection for the hidden live region of the status strip. */
export function describeConnection(connection: ConnectionState): string {
  switch (connection.state) {
    case 'starting':
      return l10n.t('Starting…');
    case 'connected':
      return l10n.t('Connected');
    case 'reconnecting':
      return l10n.t('Reconnecting ({0})', connection.attempt);
    case 'unavailable':
      return l10n.t('Unavailable: {0}', connection.error.message);
    case 'stopped':
      return l10n.t('Stopped');
    case 'not-started':
      return l10n.t('Not started');
  }
}
