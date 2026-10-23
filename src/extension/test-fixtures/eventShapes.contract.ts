// The OPT-IN event-shape check (`npm run test:event-shapes`, tooling/tests-without-model).
//
// What it protects: the synthetic opencode (`fake-opencode.mjs`) is what `npm run test:visual` and
// the e2e suites run on, and the real-opencode integration suite no longer plays a turn (it spends
// quota). So nothing else notices when the events of a TURN (text in parts, `session.step.*` with
// tokens, tools and their states, permissions and forms, usage) change upstream or drift in the
// fixture. This plays ONE identical turn against a real `opencode serve` and against the fixture,
// reduces both streams to shapes (`eventShapes.ts`) and fails on every difference the allow list
// (`event-shapes.allow.json`, each entry with its reason) does not accept.
//
// It needs a model that answers and calls `read`. Without `OPEN_VS_CODE_REAL_OPENCODE` (absolute
// path to the opencode v2 executable) it SKIPS with a banner. With it, a real turn that fails on
// the provider side (`provider.quota`, auth, no route, rate limit...) SKIPS too, naming the code
// and the message, and so does a permission turn whose model never calls `read` (there would be no
// tool or permission events to compare): a check that compared nothing, or only half, is never
// green. After the first turn it waits up to 15 s for the automatic `session.renamed` on both
// sides and FAILS when it does not come, so upstream dropping that event cannot pass unnoticed.
// The title is a second model call: if it hits quota after a succeeded turn, the check fails with
// "no session.renamed" and does NOT take the quota SKIP (the SKIP only covers the turn itself).
// Everything runs in Node (no VS Code).
//
// The turn: "Use the read tool to read the file .env ... ASK_PERMISSION" in a temporary folder
// with a dummy `.env`; the permission is answered `once` (never `always`). The model: the one in
// `OPEN_VS_CODE_SHAPE_MODEL` (`provider/id[@variant]`, it must be in `model.list()`), else the
// server's default. `OPEN_VS_CODE_SHAPE_QUESTION=1` plays a question turn instead (a form, answered
// with its first option). By default opencode's data dir is isolated under
// `.vscode-test/event-shapes-xdg` (the free models need no credentials); with
// `OPEN_VS_CODE_SHAPE_REAL_DATA=1` the real one is used, to reach a connected provider such as
// Copilot, and the session is removed afterwards. HYPOTHESIS: where v2 stores provider credentials
// (that the XDG data dir holds them, so isolating hides a connected provider): to check, run once
// with and once without the variable and compare `model.list()`.
//
// Output (ignored by git): `.vscode-test/event-shapes/{real,fake}.shapes.json` and `diff.txt`.
//
// VERIFIED on Windows 11 against opencode 2.0.32 (23/10/2026, comparison run on the tree as of
// 23/10/2026 10:49; later edits to this file are comments only; default model, permission turn):
// `npm run test:event-shapes` with
// `OPEN_VS_CODE_REAL_OPENCODE` set printed "event shapes: 0 difference(s), 108 accepted, 0 stale
// allow entries" and "1 passed". Earlier runs of the same day (before the prefix entries of the
// allow list and the wait for the title) printed the same line. A later run of the same tree
// (23/10/2026, ~11:12) took the quota SKIP and printed "SKIPPED event-shape check: the real turn
// failed on the provider side (provider.quota: Free usage limit reached." with "1 skipped". NOT
// observed: the SKIP branch of a model that does not call `read`, the failure when
// `session.renamed` never comes, `OPEN_VS_CODE_SHAPE_QUESTION=1` and
// `OPEN_VS_CODE_SHAPE_REAL_DATA=1` in this tree, macOS and Linux. The fixture side and the pipeline
// are also exercised by `eventShapes.test.ts` (fake against fake, in `npm test`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ModelRef } from '../../shared/model';
import { startServer, stopServer, type RunningServer, type ServerLog } from '../opencodeServer';
import { diffShapes, formatDiff, shapesOf, type AllowEntry } from './eventShapes';
import { clientFor, recordTurn, type TurnRecording } from './turnRecording';

const FIXTURE = fileURLToPath(new URL('./fake-opencode.mjs', import.meta.url));
const ALLOW = fileURLToPath(new URL('./event-shapes.allow.json', import.meta.url));
const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const OUT = path.join(REPO, '.vscode-test', 'event-shapes');

const REAL = process.env['OPEN_VS_CODE_REAL_OPENCODE'] ?? '';
const usable = REAL !== '' && fs.existsSync(REAL);

const PERMISSION_PROMPT =
  'Use the read tool to read the file .env in the workspace root, then reply with one short sentence. ASK_PERMISSION';
const QUESTION_PROMPT =
  'Call the question tool to ask me to pick A or B, then reply with the letter I picked. ASK_QUESTION';

const quiet: ServerLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/**
 * Writes a visible line straight to the process's stderr.
 *
 * `console.*` of a skipped suite or test is not shown by Vitest, and a skip nobody sees is how
 * "nothing was compared" would pass for green; `fs.writeSync(2, …)` bypasses that capture.
 * VERIFIED by running `npm run test:event-shapes` without the variable (22/10/2026): the banner
 * printed with this and did not print with `console.warn`.
 */
function banner(message: string): void {
  fs.writeSync(2, `\n!! ${message}\n\n`);
}

if (!usable) {
  const why =
    REAL === ''
      ? 'OPEN_VS_CODE_REAL_OPENCODE is not set'
      : `OPEN_VS_CODE_REAL_OPENCODE points to a file that does not exist (${REAL})`;
  banner(
    `SKIPPED event-shape check: ${why}. It compares a real turn with the synthetic one and ` +
      'needs a real opencode v2 AND a model that answers. Nothing was compared.',
  );
}

/** Parses `provider/id[@variant]`; `undefined` when it does not have that form. */
function parseModel(text: string): ModelRef | undefined {
  const match = /^([^/@\s]+)\/([^@\s]+)(?:@(\S+))?$/.exec(text);
  if (match === null) return undefined;
  const [, providerID, id, variant] = match;
  if (providerID === undefined || id === undefined) return undefined;
  return { providerID, id, ...(variant === undefined ? {} : { variant }) };
}

/** Creates the folder the turn runs in: a dummy `.env` (no secret) and `src/sample.ts`. */
function makeFolder(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'open-vs-code-shapes-'));
  fs.mkdirSync(path.join(folder, 'src'));
  fs.writeFileSync(path.join(folder, '.env'), 'API_KEY=dummy-value-not-a-secret\n');
  fs.writeFileSync(path.join(folder, 'src', 'sample.ts'), 'export const value = 1;\n');
  return folder;
}

/** How long the recording waits, after the turn succeeded, for the automatic `session.renamed`. */
const TITLE_WAIT_MS = 15_000;

/** Whether the recording holds an event of `type`. */
function hasEvent(turn: TurnRecording, type: string): boolean {
  return turn.events.some((event) => (event as { type: string }).type === type);
}

describe.skipIf(!usable)('event shapes: one real turn against one synthetic turn', () => {
  it('has no difference the allow list does not accept', async (context) => {
    const folders: string[] = [];
    const servers: RunningServer[] = [];
    try {
      const realFolder = makeFolder();
      folders.push(realFolder);
      const xdg = path.join(REPO, '.vscode-test', 'event-shapes-xdg');
      const isolated = process.env['OPEN_VS_CODE_SHAPE_REAL_DATA'] !== '1';
      const realServer = await startServer({
        command: REAL,
        folder: realFolder,
        port: 0,
        log: quiet,
        baseEnv: {
          ...process.env,
          ...(isolated
            ? {
                XDG_DATA_HOME: path.join(xdg, 'data'),
                XDG_STATE_HOME: path.join(xdg, 'state'),
                XDG_CACHE_HOME: path.join(xdg, 'cache'),
              }
            : {}),
        },
      });
      servers.push(realServer);
      const realClient = clientFor(realServer, realFolder);

      // --- Which model --------------------------------------------------------------------------
      const wanted = process.env['OPEN_VS_CODE_SHAPE_MODEL'];
      let model: ModelRef | undefined;
      if (wanted !== undefined && wanted !== '') {
        const parsed = parseModel(wanted);
        const listed = (await realClient.model.list()).data;
        if (
          parsed === undefined ||
          !listed.some((m) => m.providerID === parsed.providerID && m.id === parsed.id)
        ) {
          const available = listed.map((m) => `${m.providerID}/${m.id}`).join(', ');
          banner(
            `SKIPPED event-shape check: OPEN_VS_CODE_SHAPE_MODEL=${wanted} is not offered by the server. Available: ${available}`,
          );
          context.skip();
          return;
        }
        model = parsed;
      } else {
        const fallback = (await realClient.model.default()).data;
        if (fallback === null) {
          banner('SKIPPED event-shape check: the server has no default model.');
          context.skip();
          return;
        }
        model = { providerID: fallback.providerID, id: fallback.id };
      }

      // --- The real turn ------------------------------------------------------------------------
      const question = process.env['OPEN_VS_CODE_SHAPE_QUESTION'] === '1';
      const prompt = question ? QUESTION_PROMPT : PERMISSION_PROMPT;
      const realTurn = await recordTurn({
        client: realClient,
        prompt,
        model,
        timeoutMs: 120_000,
        answerForms: question,
        titleWaitMs: TITLE_WAIT_MS,
      });
      if (!isolated) await realClient.session.remove({ sessionID: realTurn.sessionID });
      if (
        realTurn.recording.outcome === 'failed' &&
        (realTurn.recording.error?.type ?? '').startsWith('provider.')
      ) {
        banner(
          `SKIPPED event-shape check: the real turn failed on the provider side (${realTurn.recording.error?.type ?? ''}: ${realTurn.recording.error?.message ?? ''}). Nothing was compared.`,
        );
        context.skip();
        return;
      }
      expect(
        realTurn.recording.outcome,
        `the real turn ended ${realTurn.recording.outcome} ${JSON.stringify(realTurn.recording.error ?? {})}`,
      ).toBe('succeeded');
      // The automatic title is a second model call that races with the end of the turn; the
      // recording waited for it (`titleWaitMs`). Without it the comparison would silently lose
      // `session.renamed` (if upstream stopped emitting it, nothing would notice), so it fails.
      expect(
        hasEvent(realTurn.recording, 'session.renamed'),
        `the real turn emitted no session.renamed in ${String(TITLE_WAIT_MS / 1000)} s after session.execution.succeeded`,
      ).toBe(true);
      // A permission turn whose model never called `read` has no tool or permission events to
      // compare: a partial comparison is not green, it is a loud skip.
      if (!question && !realTurn.recording.permissionAnswered) {
        banner(
          'SKIPPED event-shape check: the real model did not call the read tool, so the tool and permission shapes cannot be compared. Nothing was compared.',
        );
        context.skip();
        return;
      }

      // --- The same turn against the synthetic server -------------------------------------------
      const fakeFolder = makeFolder();
      folders.push(fakeFolder);
      const fakeServer = await startServer({
        command: process.execPath,
        prefixArgs: [FIXTURE],
        folder: fakeFolder,
        port: 0,
        log: quiet,
        baseEnv: { ...process.env, FAKE_OPENCODE_MODE: 'ok' },
      });
      servers.push(fakeServer);
      const fakeTurn = await recordTurn({
        client: clientFor(fakeServer, fakeFolder),
        prompt,
        model,
        timeoutMs: 30_000,
        answerForms: question,
        titleWaitMs: TITLE_WAIT_MS,
      });
      expect(
        hasEvent(fakeTurn.recording, 'session.renamed'),
        'the synthetic server emitted no session.renamed after its turn',
      ).toBe(true);

      // --- Compare ------------------------------------------------------------------------------
      const realShapes = shapesOf(realTurn.recording.events);
      const fakeShapes = shapesOf(fakeTurn.recording.events);
      const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8')) as AllowEntry[];
      const result = diffShapes(realShapes, fakeShapes, allow);
      const text = formatDiff(result);
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, 'real.shapes.json'), JSON.stringify(realShapes, null, 2));
      fs.writeFileSync(path.join(OUT, 'fake.shapes.json'), JSON.stringify(fakeShapes, null, 2));
      fs.writeFileSync(path.join(OUT, 'diff.txt'), text);
      fs.writeSync(2, `\n${text}\n(written to ${OUT})\n`);
      expect(result.diffs, text).toEqual([]);
    } finally {
      for (const server of servers) await stopServer(server.child, quiet);
      for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
