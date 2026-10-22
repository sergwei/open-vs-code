// Visual and behaviour check of the chat inside a REAL VS Code, driven over CDP.
//
// `npm run test:visual`. Opt-in, like the `real-opencode` integration suite: it needs
// `OPEN_VS_CODE_REAL_OPENCODE` (absolute path to the opencode v2 executable), network and the
// free default model, because it sends real prompts. Not run in CI. See `test/visual/README.md`.
//
// What it protects: the things no unit test can see, found by hand on 20/10/2026 (Engram #934):
// code unreadable in "High Contrast Light", a Stop painted as a red error, notifications and
// badge with the view hidden, focus on a request card, a window reload that must keep the session.
// It launches an isolated VS Code (`vscodeProcess.mjs`), drives the workbench with Playwright over
// CDP (real mouse and keyboard, screenshots) and the chat webview with raw CDP (`webviewCdp.mjs`).
//
// Where there is something objective it ASSERTS (a failed assertion makes the exit code 1):
// no CSP violation and no uncaught exception in the webview, a neutral "Stopped" note without
// role=alert after Stop, text/background contrast of code in the four themes, the toast and the badge with
// the view hidden, focus in the permission card, one primary button at a time, "Ln 20" after a
// file link, the session kept after Restart Server and after Reload Window. Since
// E3-resolved-history (issues #56/#18) it also asserts that what the user answered stays in the
// conversation under its tool ("Allowed once", "Answered … Blue", a plain "Rejected" that is not an
// alert), survives another prompt and Restart Server unchanged, and after Reload Window keeps only
// what the tool blocks say ("Answered", "Rejected") while "Allowed once" is gone. Since
// E4-session-management (issue #20) step 9 drives the session list with the real mouse and
// keyboard: groups, times, the open session marked in the four themes, ArrowDown and a visible focus
// ring, Escape returning the focus, the lazy New session (no session until the first prompt), the
// in-line rename (row and header), the server-side search, switching, and a delete confirmed in the
// MODAL dialog of VS Code (`window.dialogStyle: custom`, so it is DOM that Playwright can press),
// declined once and confirmed once. Since E4-fork-subsessions (issue #21) step 10 sends two prompts,
// hovers and Tabs to "Fork from here" on the second user message, forks with the real mouse and
// asserts the new session holds only the first exchange, the "Forked from" crumb, the refilled and
// focused prompt, the "Fork" word in the session list, and that the crumb returns to the intact
// original; then it asks the model to call the `subagent` tool and, if it does, follows the link
// to the child ("‹ parent" crumb), back, and through "Subagent sessions (1)". If the model does not
// call the tool the subagent half is SKIPPED with a warning. Since E5-model-agent-selectors (issues
// #23/#24) step 11 drives the selectors of the prompt row with the real mouse and keyboard: the
// model panel (focus in the search box, groups, the four themes), filtering and choosing with the
// keyboard, Escape, the Build | Plan switch (mouse, Tab with a visible ring, arrows, and that Enter on
// it does NOT send the prompt), a real prompt whose reply line must read "Plan · <chosen model>", the
// last used model proposed to the next new session, the `openVsCode.defaultModel` setting beating it
// (and a malformed value being reported once and ignored) and reopening the session; it also presses
// the prompt box with the real mouse while the model panel is open and asserts the panel closes (and
// the same for "More agents" when the server has a custom agent, else SKIPPED). It runs after
// steps 1-10, which keep the free default model. The reply half is SKIPPED with a warning when the
// free model fails. Step 13 (review #1015 S1) attaches a real file with the real Attach button (the
// file dialog is VS Code's own quick input, `files.simpleDialog.enable` in `vscodeProcess.mjs`),
// sends, and asserts the message leaves with its attachment and the webview logs no exception: a
// prompt with an attachment used to throw DataCloneError (VERIFIED by running this step against the
// old code on 21/10/2026: the exception was logged and the message never left). Since
// E5-model-variant (issue #61) step 14, the last one, drives the reasoning-variant control: it
// picks (dynamically) a model that lists variants, checks the control sits right after the model
// button, opens its panel with the real mouse (four themes), chooses a variant, Tab / Enter /
// arrows / Escape, an outside press, that the same model keeps the variant and another starts on
// Default, a real prompt whose reply line must end in the variant, that a new session proposes the
// last model with its variant, and that reopening the session shows the variant the server
// stored. SKIPPED with a warning when no model of the real catalog lists variants. Things that
// depend on what the model happens to write (a file reference in the reply, say) are SKIPPED with
// a warning when absent, never failed.
//
// "Always allow": the script only opens that panel (the "Always allow…" toggle), checks it, goes
// Back and presses "Allow once". It never asks for "Yes, always allow" (`clickButton` throws on
// that text) and, before each button click, it checks in the page that the element under the
// pointer is the intended button and is not an /always/ button other than that toggle. This does
// not cover a layout shift in the few milliseconds between that check and the click, nor clicks
// made by selector (textarea, file links, code buttons), which never target a request card.
//
// Isolation: opencode's data/state/cache dirs are redirected into `.vscode-test/visual/opencode-xdg`
// (see `vscodeProcess.mjs`), so the run does not add sessions to the developer's own history.
//
// Output: screenshots in `.vscode-test/visual/shots/` (ignored by git), and a summary on stdout.
// At the end (also after an exception, and on SIGINT/SIGTERM) VS Code is closed with its whole
// process tree and the temporary workspace is deleted. A hang inside a CDP call is cut by a
// timeout (`webviewCdp.mjs`), so cleanup is reached. Exit codes: 0 all good, 1 an assertion
// failed, 2 the run could not start (missing variable or build, VS Code download or launch).
//
// VERIFIED on Windows 11, VS Code 1.143.0 (the `stable` archive that `@vscode/test-electron`
// resolved on 21/10/2026, read from the run's main.log; earlier runs used 1.142.0), opencode 2.0.32,
// Node 24 (see the run recorded in Engram `E2-mvp-prototype/implementation-visual`). One earlier run
// of the same day failed in step 9 (a rename left in edit mode, then no delete modal) and passed on
// the next, with no code change in between: HYPOTHESIS that step 9 has a timing flake.
// macOS and Linux UNVERIFIED.
//
// Step 14 (issue #61) VERIFIED on Windows 11, VS Code 1.143.0, opencode 2.0.32, on 22/10/2026
// ~09:56-09:57, on the final tree: the whole run passed ("all visual checks passed", exit 0) and
// step 14 used `opencode/glm-5.3-flash-free` (variants low/high/max). Both halves of "the control
// appears only for a model with variants" RAN in that run (not skipped): `opencode/big-pickle`
// showed no control, and "another model starts on Default or shows no control" held. The log
// (`.vscode-test/visual/user-data/logs/20261022T095051/window1/exthost/sergwei.open-vs-code/
// OpenCode.log`) shows `model selected opencode/glm-5.3-flash-free for ses_… (variant low)` at
// 09:56:55.960, `prompt accepted` at 09:56:55.989 and `turn finished: succeeded` at 09:56:58.038;
// the screenshots `14a`-`14h` in `.vscode-test/visual/shots/` (four themes for the panel and the
// chosen state, the focus ring, the reply line ending in "· low", the new session and the
// reopened one) were written in that run (09:56:22-09:57:00). NOT observed: a screen reader,
// macOS and Linux, a catalog whose models list no variants (the step SKIPS then), and the host
// refusing an unlisted variant against a real server.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, startVSCode, writeSettings } from './vscodeProcess.mjs';
import { openWebview } from './webviewCdp.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const workDir = path.join(repoRoot, '.vscode-test', 'visual');
const shotsDir = path.join(workDir, 'shots');

const failures = [];
const warnings = [];
const shots = [];
/** Lines the webview logged (CSP violations, console, exceptions), across every connection. */
const webviewLogs = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Records an assertion; prints it; returns whether it held. */
function check(ok, message) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
  return ok;
}

/** Records something that could not be judged (never a failure). */
function warn(message) {
  console.log(`  warn ${message}`);
  warnings.push(message);
}

/** Polls `fn` until it returns a truthy value, or returns `undefined` after `ms`. */
async function waitFor(fn, ms, intervalMs = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let value;
    try {
      value = await fn();
    } catch {
      value = undefined;
    }
    if (value) return value;
    await sleep(intervalMs);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------

const opencodePath = process.env.OPEN_VS_CODE_REAL_OPENCODE;
if (opencodePath === undefined || opencodePath === '' || !fs.existsSync(opencodePath)) {
  console.error(
    'test:visual needs OPEN_VS_CODE_REAL_OPENCODE pointing to the opencode v2 executable ' +
      `(got ${JSON.stringify(opencodePath ?? '')}).`,
  );
  process.exit(2);
}
for (const required of ['dist/extension.js', 'dist/webview/assets/index.js']) {
  if (!fs.existsSync(path.join(repoRoot, required))) {
    console.error(
      `${required} is missing: run through \`npm run test:visual\`, which builds first.`,
    );
    process.exit(2);
  }
}

fs.rmSync(shotsDir, { recursive: true, force: true });
fs.mkdirSync(shotsDir, { recursive: true });

// Assigned inside the `try` at the bottom, so that a failure while creating them (the VS Code
// download, say) still reaches `cleanup`.
let workspace;
let vscode;
let browser;
let page;
let web;

/**
 * Closes everything the run opened: the CDP connections, VS Code with its whole process tree and
 * the temporary workspace. Idempotent, and safe when the run stopped half way (each piece is
 * optional). Called from the `finally` at the bottom and from the SIGINT/SIGTERM handlers.
 *
 * Every caller gets the SAME promise, not just the first one: on Ctrl+C the handler starts the
 * cleanup, the main body then fails (its browser is gone), reaches the `finally` and must wait for
 * that same cleanup, or it falls through to `process.exit` while `vscode.stop()` is still running
 * and VS Code + `opencode serve` are left orphaned on POSIX (review of the visual round, #941).
 * HYPOTHESIS: reasoned from the control flow, not reproduced with a real Ctrl+C mid-run.
 */
let cleaning;
function cleanup() {
  cleaning ??= (async () => {
    web?.close();
    await browser?.close().catch(() => undefined);
    await vscode?.stop();
    if (workspace !== undefined) fs.rmSync(workspace, { recursive: true, force: true });
  })();
  return cleaning;
}

// Ctrl+C or a kill of this script must not leave VS Code and `opencode serve` running (on POSIX
// VS Code has its own process group, so the signal would not reach it).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.error(`\n${signal}: closing VS Code`);
    void cleanup().finally(() => process.exit(130));
  });
}

// Real opencode data dir of the developer: the run must not write to it (see `vscodeProcess.mjs`).
// Recorded only to WARN afterwards: the developer may be using opencode at the same time.
const realOpencodeDir = path.join(os.homedir(), '.local', 'share', 'opencode');
const realDbTimes = () =>
  ['opencode.db', 'opencode.db-wal'].map((name) => {
    try {
      return fs.statSync(path.join(realOpencodeDir, name)).mtimeMs;
    } catch {
      return null;
    }
  });
const realDbBefore = realDbTimes();

/** Connects Playwright to the workbench, waiting for the debugging endpoint to come up. */
async function connectWorkbench(timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const connected = await chromium.connectOverCDP(`http://127.0.0.1:${String(vscode.port)}`);
      const pages = connected.contexts().flatMap((context) => context.pages());
      const workbench = pages.find((candidate) => candidate.url().includes('workbench'));
      if (workbench) {
        browser = connected;
        page = workbench;
        return;
      }
      await connected.close().catch(() => undefined);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`could not connect to VS Code over CDP: ${String(lastError)}`);
}

/** Saves a screenshot of the whole window and remembers its path. */
async function shot(name) {
  const file = path.join(shotsDir, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  return file;
}

/** (Re)opens the CDP connection to the webview target, replacing the previous one. */
async function openChat(timeoutMs = 30_000) {
  web?.close();
  web = await openWebview(vscode.port, webviewLogs, timeoutMs);
}

/** Types a command in the palette (F1) and runs it. */
async function command(title) {
  await page.keyboard.press('F1');
  await sleep(400);
  await page.keyboard.type(title);
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(800);
}

/** On-screen centre of the first element matching `selector` in the webview, or null. */
async function centreOf(selector) {
  const box = await web.inDoc((doc, sel) => {
    const element = doc.querySelector(sel);
    if (!element) return null;
    // 'nearest': an element already in view does not move (centring one in the fixed bottom
    // dock shifted the layout and the click missed the button).
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  if (!box) return null;
  const frame = await page.locator('iframe.webview.ready').first().boundingBox();
  if (!frame) return null;
  return { x: frame.x + box.x, y: frame.y + box.y };
}

/** A real mouse click on the first element matching `selector`; false when there is none. */
async function clickIn(selector) {
  const point = await centreOf(selector);
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

/**
 * A real click on the button of the webview whose text is exactly `text`, with a guard against
 * pressing "Always allow" by accident.
 *
 * The click is a mouse click at the button's measured centre, so the layout could move between
 * measuring and clicking and the pointer land on a neighbour ("Back" sits in the same row as
 * "Yes, always allow"). Right before clicking, the page is asked what is under that point
 * (`elementFromPoint`): it must be the intended button, and its text must not match /always/
 * unless it is the "Always allow…" toggle (recognised by `aria-expanded`), which only opens the
 * confirmation panel. Otherwise nothing is clicked and the call throws. Returns false when no
 * button has that text. What this does NOT cover: a layout shift in the few milliseconds between
 * that check and the click.
 */
async function clickButton(text) {
  if (/yes,?\s*always/i.test(text)) throw new Error(`refusing to press "${text}"`);
  const target = await web.inDoc((doc, label) => {
    const button = [...doc.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === label,
    );
    if (!button) return null;
    button.setAttribute('data-visual-click', 'true');
    // 'nearest': an element already in view does not move (centring one in the fixed bottom
    // dock shifted the layout and the click missed the button).
    button.scrollIntoView({ block: 'nearest' });
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, text);
  if (!target) return false;
  try {
    const verdict = await web.inDoc((doc, point) => {
      const hit = doc.elementFromPoint(point.x, point.y)?.closest('button') ?? null;
      return {
        intended: hit !== null && hit === doc.querySelector('[data-visual-click="true"]'),
        text: hit?.textContent.trim() ?? '',
        toggle: hit?.hasAttribute('aria-expanded') ?? false,
      };
    }, target);
    if (!verdict.intended) {
      throw new Error(
        `the pointer for "${text}" would land on "${verdict.text || 'something else'}"`,
      );
    }
    if (/always/i.test(verdict.text) && !verdict.toggle) {
      throw new Error(`refusing to press "${verdict.text}"`);
    }
    const frame = await page.locator('iframe.webview.ready').first().boundingBox();
    if (!frame) return false;
    await page.mouse.click(frame.x + target.x, frame.y + target.y);
    return true;
  } finally {
    await web
      .inDoc((doc) => {
        for (const element of doc.querySelectorAll('[data-visual-click]')) {
          element.removeAttribute('data-visual-click');
        }
      })
      .catch(() => undefined);
  }
}

/**
 * Real click in the textarea (so keyboard focus enters the iframe), empties it, then types and
 * sends. Emptying first matters: a fork refills the draft with the forked prompt and the draft
 * survives New session, so typing straight away concatenated both prompts (seen in screenshot
 * 11h of step 10, review of #21). On an empty textarea select-all + Backspace does nothing.
 */
async function send(text) {
  await clickIn('textarea');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  // Without this pause the first typed character was lost (screenshot 11h showed "all the
  // subagent tool…" for "Call the…"). Cause: HYPOTHESIS, the webview re-renders the emptied
  // textarea. The 150 ms pause: VERIFIED by the test:visual run of 21/10/2026 (153 ok, 11h clean).
  await sleep(150);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** True while the webview shows a Stop button (a turn is running). */
const isBusy = () =>
  web.inDoc((doc) =>
    [...doc.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Stop'),
  );

/** Waits until no turn is running; returns whether it got there in time. */
async function waitIdle(ms = 150_000) {
  await sleep(2000);
  const idle = await waitFor(async () => !(await isBusy()), ms);
  return idle === true;
}

/** Number of message blocks in the conversation log and the title shown in the header. */
const snapshotOfChat = () =>
  web.inDoc((doc) => ({
    messages: doc.querySelectorAll('[role="log"] > *').length,
    title: doc.querySelector('.chat-title')?.textContent ?? '',
  }));

/**
 * The lines of answered requests: those in the conversation (`log`, with their hidden prefix, e.g.
 * "Permission: Allowed once · Read .env"), those in the dock (`dock`) and the number of
 * `role="alert"` elements. E3-resolved-history (issues #56/#18).
 */
const outcomeLines = () =>
  web.inDoc((doc) => ({
    log: [...doc.querySelectorAll('[role="log"] .request-outcome')].map((p) =>
      (p.textContent ?? '').trim(),
    ),
    dock: [...doc.querySelectorAll('.request-results li')].map((li) =>
      (li.textContent ?? '').trim(),
    ),
    alerts: doc.querySelectorAll('[role="alert"]').length,
  }));

/** Fails when the webview logged a CSP violation or an uncaught exception since the last call. */
function assertNoWebviewErrors(where) {
  const bad = webviewLogs
    .splice(0)
    .filter((line) => /Refused to|Content Security Policy|^\[exception\]/i.test(line));
  check(
    bad.length === 0,
    `${where}: no CSP violation or exception in the webview${bad.length ? ` (${bad.slice(0, 3).join(' | ')})` : ''}`,
  );
}

/** Runs a step; an exception becomes a failure plus a screenshot, and the run continues. */
async function step(name, body) {
  console.log(`\n== ${name}`);
  try {
    await body();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`  FAIL (exception) ${message}`);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`).catch(() => undefined);
  }
}

/** Waits for the webview to say "Connected" (the server is up and the stream is connected). */
async function waitConnected(ms = 60_000) {
  const ok = await waitFor(
    () => web.inDoc((doc) => (doc.body?.innerText ?? '').includes('Connected')),
    ms,
  );
  return check(ok === true, 'the webview shows "Connected"');
}

/** Measures code text contrast in the webview; see the long comment inside. */
function measureCode(doc) {
  const parse = (value) => {
    const text = String(value).trim();
    let match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(
      text,
    );
    if (match) {
      let alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
      if (match[4]?.endsWith('%')) alpha /= 100;
      return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
    }
    match = /^#([0-9a-f]{3,8})$/i.exec(text);
    if (match) {
      let hex = match[1];
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
      const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
        alpha,
      ];
    }
    return null;
  };
  const over = (front, back) => {
    const alpha = front[3];
    return [0, 1, 2].map((i) => front[i] * alpha + back[i] * (1 - alpha)).concat([1]);
  };
  const luminance = (color) => {
    const [r, g, b] = color.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  const win = doc.defaultView;
  const root = win.getComputedStyle(doc.documentElement);
  // The webview body is transparent: what shows through is the side bar of the workbench.
  const base =
    parse(root.getPropertyValue('--vscode-sideBar-background')) ??
    parse(root.getPropertyValue('--vscode-editor-background'));
  if (!base) return { error: 'no base background variable' };
  const effectiveBackground = (element) => {
    const chain = [];
    for (let node = element; node; node = node.parentElement) chain.unshift(node);
    let background = [base[0], base[1], base[2], 1];
    for (const node of chain) {
      const own = parse(win.getComputedStyle(node).backgroundColor);
      if (own && own[3] > 0) background = over(own, background);
    }
    return background;
  };
  const textRatio = (element) => {
    const background = effectiveBackground(element);
    const color = parse(win.getComputedStyle(element).color);
    return color ? ratio(over(color, background), background) : 0;
  };
  const code = doc.querySelector('.code-body code');
  if (!code) return { error: 'no code block in the conversation' };
  const spans = [...doc.querySelectorAll('.code-body [class*="hljs-"]')].slice(0, 60);
  const inline = doc.querySelector('.md code:not(.file-ref)');
  return {
    code: textRatio(code),
    spansMin: spans.length ? Math.min(...spans.map(textRatio)) : null,
    spans: spans.length,
    inline: inline ? textRatio(inline) : null,
    codeBackground: win.getComputedStyle(code).backgroundColor,
  };
}

// ---------------------------------------------------------------------------------------------

let started = false;
let startupError;
try {
  workspace = createWorkspace();
  vscode = await startVSCode({ repoRoot, workDir, workspace, opencodePath });
  console.log(
    `VS Code pid ${String(vscode.pid)}, CDP port ${String(vscode.port)}, workspace ${workspace}`,
  );
  await connectWorkbench();
  started = true;
  await page.waitForTimeout(3000);

  await step('1 empty state and connection', async () => {
    for (let i = 0; i < 5 && (await page.locator('.onboarding-a-overlay.visible').count()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
    await openChat(40_000);
    await waitConnected();
    const state = await web.inDoc((doc) => ({
      title: doc.querySelector('.chat-title')?.textContent,
      newSessionButtons: [...doc.querySelectorAll('header button')].map((b) => b.textContent),
      suggestions: doc.querySelectorAll('.suggestion').length,
    }));
    check(
      state.title === 'Untitled session',
      `empty session title is "Untitled session" (got "${state.title}")`,
    );
    check(state.newSessionButtons.includes('New session'), 'the header has a New session button');
    check(
      state.suggestions >= 3,
      `the empty state offers suggestions (${String(state.suggestions)})`,
    );
    await shot('01-empty');
    assertNoWebviewErrors('empty state');
  });

  await step('2 Markdown, code actions and file links', async () => {
    // The free model sometimes stalls on "Working" for minutes (seen once). One turn is given
    // 100 s; if it has not ended it is stopped and the prompt is sent once more.
    let ended = false;
    for (const attempt of [1, 2]) {
      await send(
        'Reply with: a short TypeScript function in a ts code block, a bash command in a bash code block, ' +
          'a markdown table with 2 columns and 2 rows, a bullet list of 2 items, the inline code path `src/sample.ts:20`, ' +
          'and a link to https://code.visualstudio.com . Do not use any tools.',
      );
      await page.waitForTimeout(3000);
      if (attempt === 1) await shot('02a-streaming');
      ended = await waitIdle(100_000);
      if (ended) break;
      warn(`the first turn had not ended after 100 s (attempt ${String(attempt)}); stopping it`);
      await clickButton('Stop');
      await waitIdle(30_000);
    }
    check(ended, 'the first turn ended');
    await page.waitForTimeout(800);
    await shot('02b-markdown');
    const dom = await web.inDoc((doc) => ({
      hljs: doc.querySelectorAll('[class*="hljs-"]').length,
      tables: doc.querySelectorAll('table').length,
      codeButtons: doc.querySelectorAll('button[aria-label="Copy code"]').length,
      links: [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      // Not the `<html>` element: VS Code itself sets the theme variables in its `style`.
      // Only NON-EMPTY ones: Chromium leaves an empty `style=""` on a textarea it has resized,
      // which the CSP does not block (no declarations to apply).
      styleAttributes: [...doc.querySelectorAll('body [style], body[style]')]
        .filter((e) => (e.getAttribute('style') ?? '').trim() !== '')
        .map((e) => `${e.tagName}.${e.className}: ${e.getAttribute('style')}`),
      fileRefs: [...doc.querySelectorAll('.file-ref')].map(
        (e) => `${e.dataset.path}:${e.dataset.line}`,
      ),
    }));
    check(
      dom.codeButtons >= 1,
      `code blocks have actions (${String(dom.codeButtons)} Copy buttons)`,
    );
    check(dom.hljs > 0, 'closed code blocks are highlighted');
    check(
      dom.styleAttributes.length === 0,
      `no inline style attribute in the webview body (${dom.styleAttributes.join(' | ')})`,
    );
    if (dom.tables === 0) warn('the model wrote no table; nothing to check');
    check(
      dom.links.every((href) => /^(https?:|mailto:)/.test(href ?? '')),
      `every link is http(s) or mailto (${dom.links.join(', ')})`,
    );
    if (dom.fileRefs.includes('src/sample.ts:20')) {
      await clickIn('.file-ref[data-path="src/sample.ts"][data-line="20"]');
      await page.waitForTimeout(1500);
      const selection = await page
        .locator('#status\\.editor\\.selection')
        .first()
        .innerText()
        .catch(() => '');
      check(
        /Ln 20\b/.test(selection),
        `clicking the file reference opens the line (status bar: "${selection}")`,
      );
      await shot('02c-fileref');
    } else {
      warn(
        `no file reference to src/sample.ts:20 in the reply (${dom.fileRefs.join(', ') || 'none'}); click not tested`,
      );
    }
    if (await clickIn('button[aria-label="Open code in a new file"]')) {
      await page.waitForTimeout(1500);
      const language = await page
        .locator('#status\\.editor\\.mode')
        .first()
        .innerText()
        .catch(() => '');
      check(
        language.trim() !== '' && !/plain\s*text/i.test(language),
        `New file opens with a language (status bar: "${language.trim()}")`,
      );
    }
    assertNoWebviewErrors('markdown');
  });

  await step('3 Stop is neutral, history, focus', async () => {
    await clickIn('textarea');
    await page.keyboard.type('Count from 1 to 400, one number per line. Do not use tools.');
    await page.keyboard.press('Enter');
    const sawStop = await waitFor(isBusy, 30_000, 300);
    check(sawStop === true, 'Stop is visible while the turn runs');
    await page.waitForTimeout(2500);
    await shot('03a-busy');
    await page.keyboard.press('Escape'); // the focus is still in the textarea
    check(await waitIdle(30_000), 'Escape stops the turn');
    await page.waitForTimeout(800);
    const state = await web.inDoc((doc) => ({
      stopped: doc.querySelectorAll('.stopped-note').length,
      alerts: doc.querySelectorAll('[role="alert"]').length,
      redBoxes: doc.querySelectorAll('.alert-error').length,
      text: doc.querySelector('.stopped-note')?.textContent ?? '',
    }));
    check(state.stopped >= 1, `a neutral "Stopped" note is shown ("${state.text.trim()}")`);
    check(state.alerts === 0 && state.redBoxes === 0, 'a stopped turn is not an alert and not red');
    await shot('03b-stopped');
    await clickIn('textarea');
    await page.keyboard.press('ArrowUp');
    const recalled = await web.inDoc((doc) => doc.querySelector('textarea').value);
    check(recalled.startsWith('Count from 1 to 400'), 'ArrowUp recalls the last prompt');
    await page.keyboard.press('ArrowDown');
    assertNoWebviewErrors('stop');
  });

  await step('4 themes: code contrast and screenshots', async () => {
    for (const [name, theme, strict] of [
      ['light', 'Default Light Modern', false],
      ['dark', 'Default Dark Modern', false],
      ['hc-dark', 'Default High Contrast', true],
      ['hc-light', 'Default High Contrast Light', true],
    ]) {
      writeSettings(vscode.userDataDir, { 'workbench.colorTheme': theme });
      await page.waitForTimeout(3000);
      await shot(`04-theme-${name}`);
      const measured = await web.inDoc(measureCode);
      if (measured.error) {
        check(false, `${name}: could not measure the code (${measured.error})`);
        continue;
      }
      check(
        measured.code >= 4.5,
        `${name}: code text contrast ${measured.code.toFixed(2)} >= 4.5 (code background ${measured.codeBackground})`,
      );
      if (measured.inline !== null) {
        check(
          measured.inline >= 4.5,
          `${name}: inline code contrast ${measured.inline.toFixed(2)} >= 4.5`,
        );
      }
      if (measured.spansMin !== null) {
        if (strict)
          check(
            measured.spansMin >= 4.5,
            `${name}: every highlighted token contrast ${measured.spansMin.toFixed(2)} >= 4.5`,
          );
        else if (measured.spansMin < 3)
          warn(
            `${name}: weakest highlighted token contrast is ${measured.spansMin.toFixed(2)} (< 3)`,
          );
      }
    }
    writeSettings(vscode.userDataDir, { 'workbench.colorTheme': 'Default Dark Modern' });
    await page.waitForTimeout(2000);
    assertNoWebviewErrors('themes');
  });

  await step(
    '5 permission: notification and badge with the view hidden, card, Always panel',
    async () => {
      // A fresh session: in the old one step 3 said "Do not use tools", and on 21/10/2026 the
      // real model obeyed it and declined to call `read`, so no permission was ever asked and
      // every check of this step failed in cascade.
      check(await clickButton('New session'), 'New session starts a clean conversation');
      await page.waitForTimeout(1500);
      await clickIn('textarea');
      await page.keyboard.type(
        'Use the read tool to read the file .env in the workspace root and tell me its content.',
      );
      await page.keyboard.press('Enter');
      await page.waitForTimeout(800);
      await page.keyboard.press('Control+b'); // hides the side bar: the chat view is not visible
      const toast = await waitFor(async () => {
        const toasts = page.locator('.notifications-toasts .notification-toast');
        return (await toasts.count())
          ? (await toasts.first().innerText()).replace(/\n/g, ' | ')
          : null;
      }, 90_000);
      check(
        toast !== undefined && toast !== null,
        `a notification appears with the view hidden ("${String(toast).slice(0, 100)}")`,
      );
      const badge = page.locator(
        '.activitybar .action-item:has([aria-label^="OpenCode"]) .badge-content',
      );
      const badgeText = (await badge.allInnerTexts().catch(() => [])).join(',');
      check(badgeText !== '', `the OpenCode activity bar item has a badge ("${badgeText}")`);
      await shot('05a-hidden-permission');
      const open = page
        .locator('.notifications-toasts .notification-toast a', { hasText: /open/i })
        .first();
      if (await open.count()) {
        await open.click();
      } else {
        warn('the notification has no "Open" link; showing the side bar with Ctrl+B');
        await page.keyboard.press('Control+b');
      }
      await page.waitForTimeout(2000);
      await openChat(30_000);
      const card = await waitFor(
        () => web.inDoc((doc) => doc.querySelector('.permission-card')?.innerText?.slice(0, 200)),
        20_000,
      );
      check(card !== undefined, 'the permission card is shown');
      const focused = await web.inDoc(
        (doc) =>
          doc.activeElement?.closest?.('.request-card') !== null &&
          doc.activeElement?.closest?.('.request-card') !== undefined,
      );
      check(focused === true, 'the focus is inside the request card');
      await shot('05b-card');

      check(await clickButton('Always allow…'), 'the first "Always allow…" press opens the panel');
      await page.waitForTimeout(800);
      const panel = await web.inDoc((doc) => ({
        open: doc.querySelector('.request-always') !== null,
        primaries: [...doc.querySelectorAll('.permission-card button.primary')].map((b) =>
          b.textContent.trim(),
        ),
      }));
      check(panel.open, 'the confirmation panel is open (nothing was saved by that press)');
      check(
        panel.primaries.length === 1 && panel.primaries[0] === 'Yes, always allow',
        `a single primary button while the panel is open (${panel.primaries.join(' | ')})`,
      );
      await shot('05c-always-panel');
      check(await clickButton('Back'), 'Back closes the panel');
      await page.waitForTimeout(500);
      check(
        await web.inDoc((doc) => doc.querySelector('.request-always') === null),
        'the confirmation panel is closed after Back',
      );
      check(await clickButton('Allow once'), 'Allow once is pressed (never Always)');
      check(await waitIdle(90_000), 'the turn ends after Allow once');
      await page.waitForTimeout(1000);
      const after = (await badge.allInnerTexts().catch(() => [])).join(',');
      check(after === '', `the badge is gone after answering ("${after}")`);
      // E3-resolved-history: the answer stays in the conversation, under the tool, not in the dock.
      const once = await outcomeLines();
      check(
        once.log.some((line) => /Allowed once/.test(line)),
        `the history says "Allowed once" under the tool (${JSON.stringify(once.log)})`,
      );
      check(
        !once.dock.some((line) => /Allowed once/.test(line)),
        'the dock no longer prints the answer of the open session',
      );
      check(once.alerts === 0, 'an answered permission is not an alert');
      await shot('05d-after-once');
      assertNoWebviewErrors('permission');
    },
  );

  await step('6 question card', async () => {
    // Whether the model calls the `question` tool is up to the model (in one run it answered "I
    // don't have a question tool"), so the card is tried twice and, if it never comes, the step is
    // SKIPPED with a warning instead of failed. A card that does appear is fully asserted.
    let form;
    for (const attempt of [1, 2]) {
      await waitIdle(90_000);
      await clickIn('textarea');
      await page.keyboard.type(
        'Call the question tool now (do not answer in text) to ask me to pick one option: "Red" or "Blue". Then reply with the colour I picked.',
      );
      await page.keyboard.press('Enter');
      form = await waitFor(
        () => web.inDoc((doc) => doc.querySelector('.form-card')?.innerText?.slice(0, 200)),
        attempt === 1 ? 60_000 : 90_000,
      );
      if (form) break;
    }
    if (form === undefined) {
      await shot('07a-question-not-asked');
      warn('the model never called the question tool (2 attempts); question card not tested');
    } else {
      const focused = await web.inDoc((doc) => doc.activeElement?.closest?.('.form-card') != null);
      check(focused === true, 'the focus is inside the question card');
      check(true, 'the question card is shown');
      await shot('07a-question');
    }
    // A new prompt (the one of the question) does not erase the answer given in step 5.
    const afterPrompt = await outcomeLines();
    check(
      afterPrompt.log.some((line) => /Allowed once/.test(line)),
      `sending another prompt keeps the "Allowed once" line (${JSON.stringify(afterPrompt.log)})`,
    );
    if (form) {
      await web.inDoc((doc) => {
        const option = [
          ...doc.querySelectorAll(
            '.form-card input[type="radio"], .form-card input[type="checkbox"]',
          ),
        ].find((input) => /blue/i.test(input.closest('label')?.textContent || ''));
        option?.click();
        [...doc.querySelectorAll('.form-card button')]
          .find((b) => /submit/i.test(b.textContent))
          ?.click();
      });
      check(await waitIdle(90_000), 'the turn ends after answering');
      const gone = await web.inDoc((doc) => doc.querySelector('.form-card') === null);
      check(gone === true, 'the question card is gone after the answer');
      await page.waitForTimeout(800);
      const answered = await outcomeLines();
      check(
        answered.log.some((line) => /Answered/.test(line) && /Blue/.test(line)),
        `the history says what was answered ("Answered … Blue"): ${JSON.stringify(answered.log)}`,
      );
      check(answered.dock.length === 0, 'the dock prints no result line for the open session');
      await shot('07b-answered');
    }
    assertNoWebviewErrors('question');
  });

  await step('6b a plain Reject is kept in the history, not painted as an error', async () => {
    // Same reasoning as step 6: whether the model calls `read` is up to the model, so two tries and
    // then SKIP with a warning.
    let card;
    for (const attempt of [1, 2]) {
      await waitIdle(90_000);
      await clickIn('textarea');
      await page.keyboard.type(
        'Use the read tool to read the file .env in the workspace root once more and tell me its content.',
      );
      await page.keyboard.press('Enter');
      card = await waitFor(
        () => web.inDoc((doc) => doc.querySelector('.permission-card')?.innerText?.slice(0, 200)),
        attempt === 1 ? 60_000 : 90_000,
      );
      if (card) break;
    }
    if (card === undefined) {
      await shot('07c-reject-not-asked');
      warn('the model never called the read tool again (2 attempts); Reject not tested');
      return;
    }
    check(await clickButton('Reject'), 'Reject is pressed (the plain one, never Always)');
    check(await waitIdle(90_000), 'the turn ends after Reject');
    await page.waitForTimeout(1000);
    const lines = await outcomeLines();
    check(
      lines.log.some((line) => /Rejected/.test(line) && !/feedback/.test(line)),
      `the history says "Rejected" under the tool: ${JSON.stringify(lines.log)}`,
    );
    check(
      lines.log.some((line) => /Allowed once/.test(line)),
      'the earlier "Allowed once" line is still there',
    );
    const painted = await web.inDoc((doc) => ({
      red: doc.querySelectorAll('.alert-error').length,
      alerts: doc.querySelectorAll('[role="alert"]').length,
      outcomeIsError: [...doc.querySelectorAll('.request-outcome')].some(
        (p) => p.matches('.alert, .alert-error') || p.closest('[role="alert"]') !== null,
      ),
    }));
    check(
      painted.red === 0 && painted.alerts === 0 && !painted.outcomeIsError,
      'a Reject is not an alert and not red',
    );
    await shot('07c-rejected');
    assertNoWebviewErrors('reject');
  });

  await step('7 Restart Server keeps the session', async () => {
    const before = await snapshotOfChat();
    const linesBefore = await outcomeLines();
    check(
      before.messages > 0,
      `there is a conversation to keep (${String(before.messages)} blocks, "${before.title}")`,
    );
    await command('OpenCode: Restart Server');
    await page.waitForTimeout(6000);
    await openChat(40_000);
    await waitConnected();
    const afterRestart = await snapshotOfChat();
    check(
      afterRestart.messages === before.messages,
      `same number of message blocks after Restart Server (${String(before.messages)} -> ${String(afterRestart.messages)})`,
    );
    check(
      afterRestart.title === before.title,
      `same title after Restart Server ("${afterRestart.title}")`,
    );
    // The host (not the webview, not the server) remembers the exact decisions, and it survives.
    const linesAfter = await outcomeLines();
    check(
      linesBefore.log.length > 0 &&
        JSON.stringify(linesAfter.log) === JSON.stringify(linesBefore.log),
      `the answered-request lines are the same after Restart Server (${JSON.stringify(linesBefore.log)} -> ${JSON.stringify(linesAfter.log)})`,
    );
    await shot('08a-after-restart');
  });

  await step('8 Reload Window keeps the session', async () => {
    const preReload = await snapshotOfChat();
    const linesPreReload = await outcomeLines();
    const hadRejected = linesPreReload.log.some((line) => /Rejected/.test(line));
    const hadAnswered = linesPreReload.log.some((line) => /Answered/.test(line));
    await command('Developer: Reload Window');
    web?.close();
    await browser.close().catch(() => undefined);
    await sleep(10_000);
    await connectWorkbench(90_000);
    let opened = true;
    try {
      await openChat(8_000);
    } catch {
      opened = false;
    }
    if (!opened) {
      await page
        .locator('.activitybar [aria-label^="OpenCode"]')
        .first()
        .click()
        .catch(() => undefined);
      await openChat(60_000);
    }
    await waitConnected();
    await page.waitForTimeout(4000);
    const afterReload = await snapshotOfChat();
    check(
      afterReload.messages === preReload.messages,
      `same number of message blocks after Reload Window (${String(preReload.messages)} -> ${String(afterReload.messages)})`,
    );
    check(
      afterReload.title === preReload.title,
      `same title after Reload Window ("${afterReload.title}")`,
    );
    // Reload Window kills the extension host and with it the memory of exact decisions (decision of
    // Sergio, 21/10/2026: nothing is persisted). What the tool blocks say survives, and it comes
    // from REST `message.list` (that is the check of the HYPOTHESIS that REST returns the same
    // `content[]` as the database). "Allowed once" is ASSERTED gone, so the documented limit cannot
    // change silently.
    const linesAfterReload = await outcomeLines();
    check(
      !linesAfterReload.log.some((line) => /Allowed once|Always allowed/.test(line)),
      `after Reload Window "Allowed once" is gone (the server keeps no trace): ${JSON.stringify(linesAfterReload.log)}`,
    );
    if (hadAnswered) {
      check(
        linesAfterReload.log.some((line) => /Answered/.test(line) && /Blue/.test(line)),
        `after Reload Window "Answered … Blue" is read back from the tool block: ${JSON.stringify(linesAfterReload.log)}`,
      );
    }
    if (hadRejected) {
      check(
        linesAfterReload.log.some((line) => /Rejected/.test(line)),
        `after Reload Window "Rejected" is read back from the tool block: ${JSON.stringify(linesAfterReload.log)}`,
      );
    }
    await shot('09-after-reload');
    assertNoWebviewErrors('reload');
  });

  await step('9 sessions: list, search, rename, switch, delete (issue #20)', async () => {
    /** What the open session list shows, and where the focus is. Self-contained (it is serialized). */
    const picker = () =>
      web.inDoc((doc) => ({
        open: doc.querySelector('.session-picker') !== null,
        rows: [...doc.querySelectorAll('.session-row')].map((li) => ({
          title: li.querySelector('.session-title')?.textContent ?? '',
          time: li.querySelector('.session-time')?.textContent ?? '',
          badge: li.querySelector('.session-badge')?.textContent ?? '',
          current: li.querySelector('.session-main')?.getAttribute('aria-current') === 'true',
        })),
        groups: [...doc.querySelectorAll('.session-group-title')].map((e) => e.textContent),
        status: doc.querySelector('.session-status')?.textContent ?? '',
        // The polite live region: "Loading sessions…" while a query is in flight, then the count.
        // The only place that says "loading" when old rows are still on screen.
        live: (doc.querySelector('.session-picker [role="status"]')?.textContent ?? '').trim(),
        focus: {
          tag: doc.activeElement?.tagName ?? '',
          type: doc.activeElement?.getAttribute?.('type') ?? '',
          cls: doc.activeElement?.className ?? '',
          text: (doc.activeElement?.textContent ?? '').trim().slice(0, 40),
          visible: doc.activeElement?.matches?.(':focus-visible') ?? false,
        },
        title: doc.querySelector('.chat-title')?.textContent ?? '',
        suggestions: doc.querySelectorAll('.suggestion').length,
        messages: doc.querySelectorAll('[role="log"] > *').length,
        notices: (doc.body.innerText ?? '').includes('deleted outside'),
      }));
    /** Opens the list with a real click on "Sessions" and waits for its first page. */
    const openList = async () => {
      if ((await picker()).open) return true;
      const clicked = await clickButton('Sessions');
      // Loaded = the live region has left "Loading sessions…" (old rows may be on screen already,
      // from an earlier opening, so the rows alone say nothing about the NEW page).
      const loaded = await waitFor(async () => {
        const state = await picker();
        return state.open && state.live !== '' && !/^Loading/.test(state.live);
      }, 20_000);
      return clicked && loaded === true;
    };
    /** Closes the list with a real Escape (the focus is inside it). */
    const closeList = async () => {
      await page.keyboard.press('Escape');
      await sleep(300);
    };
    /** Waits until `predicate(await picker())` holds. */
    const until = (predicate, ms = 15_000) =>
      waitFor(async () => predicate(await picker()), ms, 300);

    check(await openList(), 'the Sessions button opens the list');
    let state = await picker();
    check(
      state.rows.length >= 1,
      `the list shows the sessions of the folder (${String(state.rows.length)})`,
    );
    check(
      state.groups.includes('Today'),
      `rows are grouped by date (${JSON.stringify(state.groups)})`,
    );
    check(
      state.rows.every((row) => row.time !== ''),
      'every row carries its time',
    );
    check(
      state.rows.filter((row) => row.current).length === 1,
      'exactly one row is marked as the open session (aria-current)',
    );
    check(
      state.focus.tag === 'INPUT' && state.focus.type === 'search',
      `the focus is in the search box on opening (${state.focus.tag} ${state.focus.type})`,
    );
    const countBefore = state.rows.length;
    for (const [name, theme] of [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ]) {
      writeSettings(vscode.userDataDir, { 'workbench.colorTheme': theme });
      await page.waitForTimeout(3000);
      await shot(`10a-sessions-${name}`);
      const marker = await web.inDoc((doc) => {
        const row = doc.querySelector('.session-row.current');
        if (!row) return null;
        const style = doc.defaultView.getComputedStyle(row);
        return {
          bar: style.borderLeftColor,
          outline: style.outlineStyle,
          background: style.backgroundColor,
        };
      });
      const hc = name.startsWith('hc');
      check(
        marker !== null &&
          (hc ? marker.outline !== 'none' : marker.bar !== 'rgba(0, 0, 0, 0)' && marker.bar !== ''),
        `${name}: the open session has a visible marker (${JSON.stringify(marker)})`,
      );
    }
    writeSettings(vscode.userDataDir, { 'workbench.colorTheme': 'Default Dark Modern' });
    await page.waitForTimeout(2500);

    // Keyboard: ArrowDown from the search box enters the list, with a visible focus ring.
    await openList();
    await clickIn('input[type="search"]');
    await page.keyboard.press('ArrowDown');
    state = await picker();
    check(
      state.focus.cls.includes('session-main') && state.focus.visible,
      `ArrowDown enters the list with a visible focus (${JSON.stringify(state.focus)})`,
    );
    await shot('10b-sessions-keyboard');
    await closeList();
    state = await picker();
    check(!state.open, 'Escape closes the list');
    check(
      state.focus.tag === 'BUTTON' && state.focus.text === 'Sessions',
      `Escape returns the focus to the Sessions button (${JSON.stringify(state.focus)})`,
    );

    // "New session" is lazy: it empties the view and creates NOTHING until the first prompt.
    check(await clickButton('New session'), 'New session is pressed');
    await page.waitForTimeout(1500);
    state = await picker();
    check(
      state.suggestions >= 3 && state.title === 'Untitled session',
      `New session leaves the empty view (${String(state.suggestions)} suggestions, "${state.title}")`,
    );
    await openList();
    state = await picker();
    check(
      state.rows.length === countBefore,
      `New session created no session (${String(countBefore)} -> ${String(state.rows.length)})`,
    );
    check(
      state.rows.every((row) => !row.current),
      'no session is marked as open after New session',
    );
    await closeList();

    // The first prompt creates the session.
    const token = `vr${String(Date.now())}`;
    await send(`Reply with exactly: ${token}. Do not use any tools.`);
    await page.waitForTimeout(1200);
    const busyNow = await isBusy();
    await openList();
    state = await picker();
    check(
      state.rows.length === countBefore + 1,
      `the first prompt created the session (${String(countBefore)} -> ${String(state.rows.length)})`,
    );
    if (busyNow) {
      const running = state.rows.find((row) => row.current);
      check(
        running !== undefined && /Running/.test(running.badge),
        `a running session says "Running" in text (${JSON.stringify(running?.badge)})`,
      );
      await shot('10c-sessions-running');
    } else {
      warn('the turn had already ended when the list opened; "Running" not checked');
    }
    await closeList();
    if (!(await waitIdle(120_000))) warn('the second session did not finish in 120 s; going on');

    // Rename in line, with the real mouse and keyboard.
    const renamed = `Visual ${token}`;
    await openList();
    check(await clickIn('.session-row.current .session-action'), 'the Rename button is pressed');
    await page.waitForTimeout(400);
    check(
      (await web.inDoc((doc) => doc.activeElement?.classList.contains('session-rename-input'))) ===
        true,
      'the title becomes an input with the focus',
    );
    await shot('10d-sessions-renaming');
    await page.keyboard.type(renamed);
    await page.keyboard.press('Enter');
    const renamedOk = await until(
      (s) => s.rows.some((row) => row.current && row.title === renamed) && s.title === renamed,
    );
    check(
      renamedOk === true,
      `the row AND the header show the new title ("${(await picker()).title}")`,
    );
    await shot('10e-sessions-renamed');

    // Search happens on the server: only the renamed session matches.
    await clickIn('input[type="search"]');
    await page.keyboard.type(token.toUpperCase());
    const found = await until((s) => s.rows.length === 1 && s.rows[0].title === renamed);
    check(
      found === true,
      `the search finds only the renamed session, case-insensitively (${JSON.stringify((await picker()).rows.map((r) => r.title))})`,
    );
    await shot('10f-sessions-search');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    const cleared = await until((s) => s.rows.length >= countBefore + 1);
    check(cleared === true, 'clearing the search brings the whole list back');

    // Switch to the other session by clicking its row.
    state = await picker();
    const other = state.rows.find((row) => !row.current && row.title !== renamed);
    check(other !== undefined, 'there is another session to switch to');
    if (other !== undefined) {
      await web.inDoc((doc, title) => {
        const row = [...doc.querySelectorAll('.session-row')].find(
          (li) => li.querySelector('.session-title')?.textContent === title,
        );
        row?.querySelector('.session-main')?.setAttribute('data-visual-pick', 'true');
      }, other.title);
      check(await clickIn('[data-visual-pick="true"]'), 'the other session is clicked');
      const switched = await until((s) => !s.open && s.title === other.title, 20_000);
      check(
        switched === true,
        `choosing a session opens it and closes the list ("${(await picker()).title}")`,
      );
      state = await picker();
      check(
        state.messages > 0,
        `the other conversation is shown (${String(state.messages)} blocks)`,
      );
      await shot('10g-sessions-switched');
    }

    // Back to the renamed one, then delete it: the host asks with a native modal.
    await openList();
    await web.inDoc((doc, title) => {
      const row = [...doc.querySelectorAll('.session-row')].find(
        (li) => li.querySelector('.session-title')?.textContent === title,
      );
      row?.querySelector('.session-main')?.setAttribute('data-visual-pick', 'true');
    }, renamed);
    // The centre of the row is only safe while the document has no scrollbar: the row actions are
    // laid over its right end (opacity 0 still takes the click), and a 9 px overflow narrowed the
    // row enough for the centre to land on "Rename" (found while adding step 10, issue #21).
    const overflowPx = await web.inDoc(
      (doc) => doc.documentElement.scrollHeight - doc.documentElement.clientHeight,
    );
    check(overflowPx <= 0, `the document has no vertical overflow (${String(overflowPx)} px)`);
    await clickIn('[data-visual-pick="true"]');
    await until((s) => !s.open && s.title === renamed, 20_000);
    await openList();
    const dialog = page.locator('.monaco-dialog-box');
    const askDelete = async () => {
      check(
        await clickIn('.session-row.current .session-action[aria-label^="Delete"]'),
        'Delete is pressed',
      );
      return waitFor(
        async () => ((await dialog.count()) ? await dialog.first().innerText() : null),
        10_000,
        300,
      );
    };
    let modal = await askDelete();
    check(
      modal !== undefined && modal !== null,
      `a modal dialog of VS Code asks for confirmation (${String(modal).replace(/\s+/g, ' ').slice(0, 160)})`,
    );
    if (modal === undefined || modal === null) {
      await shot('10h-FAIL-no-modal');
      throw new Error(
        'the confirmation modal never appeared as DOM (window.dialogStyle custom): see PREGUNTA PENDIENTE',
      );
    }
    check(modal.includes(renamed), 'the modal names the session');
    check(/cannot be undone/i.test(modal), 'the modal says it cannot be undone');
    await shot('10h-sessions-delete-modal');
    // Declining deletes nothing.
    await dialog
      .first()
      .getByRole('button', { name: /^Cancel$/ })
      .click();
    await page.waitForTimeout(800);
    state = await picker();
    check(
      state.rows.some((row) => row.title === renamed) && state.title === renamed,
      'Cancel keeps the session and its conversation',
    );
    check(
      state.rows.every((row) => row.badge === ''),
      `the row unlocks after a declined delete (${JSON.stringify(state.rows.map((r) => r.badge))})`,
    );
    // Confirming deletes it and empties the view.
    modal = await askDelete();
    check(modal !== undefined && modal !== null, 'the modal appears again');
    await dialog
      .first()
      .getByRole('button', { name: /^Delete$/ })
      .click();
    const gone = await until(
      (s) => !s.rows.some((row) => row.title === renamed) && s.suggestions >= 3,
      20_000,
    );
    state = await picker();
    check(gone === true, 'the deleted session leaves the list and the view is empty');
    check(
      state.title === 'Untitled session',
      `the header is back to "Untitled session" ("${state.title}")`,
    );
    check(!state.notices, 'deleting from here does not announce "deleted outside"');
    check((await dialog.count()) === 0, 'the dialog is closed');
    await shot('10i-sessions-deleted');
    // The native dialog took the keyboard focus out of the page: click into the list first.
    await clickIn('input[type="search"]');
    await closeList();
    state = await picker();
    check(
      state.focus.tag === 'BUTTON' && state.focus.text === 'Sessions',
      `Escape returns the focus to the Sessions button again (${JSON.stringify(state.focus)})`,
    );
    assertNoWebviewErrors('sessions');
  });

  await step('10 fork and subagent sessions (issue #21)', async () => {
    /** What the chat shows about the open conversation. Self-contained (it is serialized). */
    const chat = () =>
      web.inDoc((doc) => {
        const bar = (article) => article.querySelector('.message-actions');
        const users = [...doc.querySelectorAll('[role="log"] .message-user')];
        const active = doc.activeElement;
        return {
          blocks: doc.querySelectorAll('[role="log"] > *').length,
          users: users.map((u) => (u.querySelector('.part-text')?.textContent ?? '').trim()),
          bars: users.map((u) =>
            bar(u) ? doc.defaultView.getComputedStyle(bar(u)).opacity : 'none',
          ),
          forkNames: users.map(
            (u) => u.querySelector('.message-action')?.getAttribute('aria-label') ?? '',
          ),
          title: doc.querySelector('.chat-title')?.textContent ?? '',
          path: doc.querySelector('nav[aria-label="Session path"]')?.textContent ?? '',
          pathButton: doc.querySelector('nav[aria-label="Session path"] button') !== null,
          children: doc.querySelector('details.subagent-sessions > summary')?.textContent ?? '',
          draft: doc.querySelector('textarea')?.value ?? '',
          focus: {
            tag: active?.tagName ?? '',
            cls: active?.className ?? '',
            visible: active?.matches?.(':focus-visible') ?? false,
          },
          subagentLinks: doc.querySelectorAll('.subagent-link').length,
          subagentLine: doc.querySelector('.part-subagent span')?.textContent ?? '',
          alerts: doc.querySelectorAll('[role="alert"]').length,
        };
      });
    /** Tags the Nth (1-based) user message of the log so the real mouse can find it. */
    const tagUser = (nth) =>
      web.inDoc((doc, n) => {
        for (const old of doc.querySelectorAll('[data-visual-msg]')) {
          old.removeAttribute('data-visual-msg');
        }
        const users = [...doc.querySelectorAll('[role="log"] .message-user')];
        users[n - 1]?.setAttribute('data-visual-msg', 'true');
        return users.length;
      }, nth);
    /** Moves the real mouse to the centre of the first element matching `selector`. */
    const hover = async (selector) => {
      const point = await centreOf(selector);
      if (point) await page.mouse.move(point.x, point.y);
      await sleep(300);
      return point !== null;
    };
    const setTheme = async (theme) => {
      writeSettings(vscode.userDataDir, { 'workbench.colorTheme': theme });
      await page.waitForTimeout(2500);
    };

    // --- Fork from the second user message ---------------------------------------------------
    // Step 9 left the view empty (its session was deleted): the first prompt creates a session.
    const ONE = 'Reply with exactly: ONE. Do not use any tools.';
    const TWO = 'Reply with exactly: TWO. Do not use any tools.';
    await send(ONE);
    if (!(await waitIdle(120_000))) warn('the first turn did not finish in 120 s; going on');
    await send(TWO);
    if (!(await waitIdle(120_000))) warn('the second turn did not finish in 120 s; going on');
    let state = await chat();
    check(
      state.users.length === 2 && state.users[1].includes('TWO'),
      `the original session has the two prompts (${JSON.stringify(state.users)})`,
    );
    check(
      state.forkNames.every((name) => name.startsWith('Fork from here: Reply with exactly')),
      `each user message has a "Fork from here" named after it (${JSON.stringify(state.forkNames)})`,
    );
    check(
      (await web.inDoc(
        (doc) => doc.querySelectorAll('.message-assistant .message-action').length,
      )) === 0,
      'assistant messages have no fork button',
    );
    const originalBlocks = state.blocks;
    // Not the title: the model names the session some seconds after its first answer, so a title
    // read now can differ from the one read after navigating (seen in a run of 21/10/2026).

    // Hover shows the bar of that message only (opacity, so Tab can still reach it).
    await tagUser(2);
    check(await hover('textarea'), 'the mouse rests away from the messages');
    state = await chat();
    check(
      state.bars.every((opacity) => opacity === '0'),
      `no action bar is visible without hover or focus (${JSON.stringify(state.bars)})`,
    );
    check(await hover('[data-visual-msg="true"]'), 'the mouse is over the second user message');
    state = await chat();
    check(
      state.bars[1] === '1' && state.bars[0] === '0',
      `hovering a message shows ITS bar only (${JSON.stringify(state.bars)})`,
    );
    await shot('11a-fork-hover');

    // Keyboard: click the text, Tab lands on that message's button, with a visible ring and bar.
    await hover('textarea');
    check(
      await clickIn('[data-visual-msg="true"] .part-text'),
      'the text of the message is clicked',
    );
    await page.keyboard.press('Tab');
    state = await chat();
    check(
      state.focus.tag === 'BUTTON' && state.focus.cls.includes('message-action'),
      `Tab reaches "Fork from here" (${JSON.stringify(state.focus)})`,
    );
    check(state.focus.visible, 'the focused fork button shows a focus ring');
    check(state.bars[1] === '1', 'focusing the button shows its bar without hover');
    await hover('textarea');
    await shot('11b-fork-focus');

    // Fork with the real mouse.
    await web.inDoc((doc) => {
      doc
        .querySelector('[data-visual-msg="true"] .message-action')
        ?.setAttribute('data-visual-fork', 'true');
    });
    check(await clickIn('[data-visual-fork="true"]'), '"Fork from here" is pressed');
    const forked = await waitFor(async () => (await chat()).path.startsWith('Forked from'), 20_000);
    state = await chat();
    check(forked === true, `the fork opened and the header says where from ("${state.path}")`);
    check(
      state.users.length === 1 && state.users[0].includes('ONE'),
      `the fork holds only the history BEFORE the message (${JSON.stringify(state.users)})`,
    );
    check(state.pathButton, 'the "Forked from" crumb is a button');
    check(
      state.draft === TWO,
      `the prompt is refilled with the text of the forked message ("${state.draft}")`,
    );
    check(
      state.focus.tag === 'TEXTAREA',
      `the prompt has the focus after the fork (${JSON.stringify(state.focus)})`,
    );
    check(state.alerts === 0, 'forking raised no alert');
    for (const [name, theme] of [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ]) {
      await setTheme(theme);
      await tagUser(1);
      await hover('[data-visual-msg="true"]');
      await shot(`11c-fork-${name}`);
      const look = await web.inDoc((doc) => {
        const link = doc.querySelector('nav[aria-label="Session path"] button');
        const bar = doc.querySelector('[data-visual-msg="true"] .message-actions');
        return {
          link: link ? doc.defaultView.getComputedStyle(link).color : '',
          bar: bar ? doc.defaultView.getComputedStyle(bar).opacity : '',
        };
      });
      check(
        look.link !== '' && look.bar === '1',
        `${name}: the crumb and the hovered action bar render (${JSON.stringify(look)})`,
      );
    }
    await setTheme('Default Dark Modern');

    // The fork is a root session: it is in the list with the word "Fork"; the original is intact.
    await clickButton('Sessions');
    const listed = await waitFor(
      () =>
        web.inDoc((doc) => {
          const live = doc.querySelector('.session-picker [role="status"]')?.textContent ?? '';
          return (
            doc.querySelector('.session-picker') !== null &&
            live.trim() !== '' &&
            !/^Loading/.test(live.trim())
          );
        }),
      20_000,
      300,
    );
    check(listed === true, 'the session list opened');
    const badges = await web.inDoc((doc) =>
      [...doc.querySelectorAll('.session-row')].map(
        (li) => li.querySelector('.session-badge')?.textContent ?? '',
      ),
    );
    check(
      badges.some((badge) => badge.includes('Fork')),
      `the fork is listed with the word "Fork" (${JSON.stringify(badges)})`,
    );
    await shot('11d-fork-in-list');
    await page.keyboard.press('Escape');
    await sleep(300);

    // "Forked from ..." goes back to the original, which still has both exchanges.
    check(
      await clickIn('nav[aria-label="Session path"] button'),
      'the "Forked from" crumb is pressed',
    );
    const back = await waitFor(async () => {
      const now = await chat();
      return now.path === '' && now.users.length === 2;
    }, 20_000);
    state = await chat();
    check(
      back === true && state.users.length === 2 && state.blocks === originalBlocks,
      `the crumb opens the original, intact (${String(state.blocks)} of ${String(originalBlocks)} blocks, ${String(state.users.length)} prompts)`,
    );
    assertNoWebviewErrors('fork');

    // --- Subagent session ---------------------------------------------------------------------
    // Depends on the free model calling the `subagent` tool: SKIPPED with a warning when it does not.
    check(await clickButton('New session'), 'New session is pressed for the subagent run');
    await page.waitForTimeout(1500);
    await send(
      'Call the subagent tool exactly once with agent "general", description "Say hello" and ' +
        'prompt "Reply with exactly: HELLO". After it returns, reply with exactly: DONE.',
    );
    if (!(await waitIdle(150_000))) warn('the subagent turn did not finish in 150 s; going on');
    state = await chat();
    if (state.subagentLinks === 0) {
      warn(
        'SKIPPED: the model did not call the subagent tool (no "Open subagent session" in the ' +
          'conversation), so the subagent navigation was not exercised',
      );
      await shot('11e-subagent-skipped');
      return;
    }
    check(
      state.subagentLine.startsWith('Subagent'),
      `the tool block reads as a subagent line ("${state.subagentLine}")`,
    );
    await shot('11e-subagent-link');
    check(await clickButton('Open subagent session'), '"Open subagent session" is pressed');
    const inChild = await waitFor(async () => (await chat()).path.startsWith('‹'), 20_000);
    state = await chat();
    check(inChild === true, `the child shows the crumb "‹ parent" ("${state.path}")`);
    check(state.pathButton, 'the parent crumb is a button');
    check(state.users.length >= 1, 'the child conversation is shown');
    await shot('11f-subagent-child');
    for (const [name, theme] of [
      ['light', 'Default Light Modern'],
      ['hc-light', 'Default High Contrast Light'],
    ]) {
      await setTheme(theme);
      await shot(`11g-subagent-child-${name}`);
    }
    await setTheme('Default Dark Modern');
    check(await clickIn('nav[aria-label="Session path"] button'), 'the parent crumb is pressed');
    const backToParent = await waitFor(async () => {
      const now = await chat();
      return now.path === '' && now.subagentLinks > 0;
    }, 20_000);
    state = await chat();
    check(backToParent === true, `the crumb returns to the parent ("${state.title}")`);
    check(
      state.children === 'Subagent sessions (1)',
      `the parent lists its subagent session ("${state.children}")`,
    );
    // The list opens with the keyboard-native <details> and its button opens the child.
    check(
      await clickIn('details.subagent-sessions > summary'),
      'the "Subagent sessions" summary is pressed',
    );
    await sleep(300);
    await shot('11h-subagent-list');
    check(await clickIn('.subagent-child'), 'the child in the list is pressed');
    const again = await waitFor(async () => (await chat()).path.startsWith('‹'), 20_000);
    check(again === true, 'the list opens the same child session');
    assertNoWebviewErrors('subagent');
  });

  // Issues #23/#24. The LAST step on purpose: steps 1-10 ran with the free default model and the
  // default agent, because the profile (and so `globalState` and the setting) is wiped at start.
  await step('11 model and agent selectors (issues #23/#24)', async () => {
    /** What the prompt row and the model panel show. Self-contained (it is serialized). */
    const ui = () =>
      web.inDoc((doc) => {
        const trigger = doc.querySelector('button.model-trigger');
        const radio = doc.querySelector('.agent-toggle input:checked');
        const active = doc.activeElement;
        const label = active?.id ? doc.querySelector(`label[for="${active.id}"]`) : null;
        const metas = [...doc.querySelectorAll('.message-assistant .message-meta')];
        return {
          trigger: trigger?.textContent ?? '',
          triggerName: trigger?.getAttribute('aria-label') ?? '',
          expanded: trigger?.getAttribute('aria-expanded') ?? '',
          agent: radio?.value ?? '',
          panel: doc.querySelector('.model-panel') !== null,
          groups: [...doc.querySelectorAll('.model-panel .model-group > h3')].map(
            (h) => h.textContent ?? '',
          ),
          options: [...doc.querySelectorAll('.model-panel button.model-option')].map((b) => ({
            id: b.getAttribute('data-model') ?? '',
            name: b.querySelector('.model-name')?.textContent ?? '',
            current: b.getAttribute('aria-current') === 'true',
          })),
          live: (doc.querySelector('.model-panel [role="status"]')?.textContent ?? '').trim(),
          panelTop: doc.querySelector('.model-panel')?.getBoundingClientRect().top ?? null,
          focus: {
            tag: active?.tagName ?? '',
            cls: active?.className ?? '',
            aria: active?.getAttribute?.('aria-label') ?? '',
            visible: active?.matches?.(':focus-visible') ?? false,
            ring: label ? doc.defaultView.getComputedStyle(label).outlineStyle : '',
          },
          lastMeta: metas.at(-1)?.textContent ?? '',
          metas: metas.length,
          blocks: doc.querySelectorAll('[role="log"] > *').length,
          headerHasMarker: doc.querySelector('header .model-marker') !== null,
          draft: doc.querySelector('textarea')?.value ?? '',
          alerts: doc.querySelectorAll('[role="alert"]').length,
          text: doc.body.innerText,
        };
      });
    const setTheme = async (theme) => {
      writeSettings(vscode.userDataDir, { 'workbench.colorTheme': theme });
      await page.waitForTimeout(2500);
    };
    const press = async (key) => {
      await page.keyboard.press(key);
      await sleep(250);
    };
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];

    // --- A new session proposes the default agent and the server's default model --------------
    check(await clickButton('New session'), 'New session is pressed');
    await page.waitForTimeout(1500);
    let state = await ui();
    check(state.agent === 'build', `a new session starts on Build (got "${state.agent}")`);
    check(
      state.trigger.endsWith('(default)') && state.triggerName === `Model: ${state.trigger}`,
      `the model button names the server default ("${state.trigger}" / "${state.triggerName}")`,
    );
    check(!state.headerHasMarker, 'the header no longer has the Agent · model marker');
    await shot('12a-prompt-row');

    // --- The panel: focus in the search box, groups, the four themes ---------------------------
    check(await clickIn('button.model-trigger'), 'the model button is pressed');
    await sleep(400);
    state = await ui();
    check(state.panel && state.expanded === 'true', 'the model panel opened');
    check(
      state.focus.cls.includes('session-search') && state.focus.aria === 'Search models',
      `the focus is in "Search models" (${JSON.stringify(state.focus)})`,
    );
    check(
      state.groups.length >= 1 && state.options.length >= 1,
      `the models are grouped by provider (${JSON.stringify(state.groups)}, ${String(state.options.length)} models)`,
    );
    check(
      state.options.filter((o) => o.current).length === 1,
      'exactly one model is marked as the current one',
    );
    check(
      state.panelTop !== null && state.panelTop >= 0,
      `the panel is inside the view (top ${String(state.panelTop)})`,
    );
    check(
      // eslint-disable-next-line no-irregular-whitespace -- the next line strips a literal no-break space
      /^\d+ models?$/.test(state.live.replace(/ /g, '')),
      `the live region counts the models ("${state.live}")`,
    );
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      await shot(`12b-model-panel-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- Filter and pick with the keyboard -----------------------------------------------------
    const options = state.options;
    const target = options.find((o) => !o.current);
    if (target === undefined) {
      warn(
        'SKIPPED: the server lists a single model, so picking a different one was not exercised',
      );
      await press('Escape');
      return;
    }
    await page.keyboard.type(target.name);
    await sleep(400);
    state = await ui();
    check(
      state.options.length >= 1 && state.options.length <= options.length,
      `typing the name filters the list (${String(options.length)} -> ${String(state.options.length)})`,
    );
    check(
      state.options.some((o) => o.id === target.id),
      'the typed model is still listed',
    );
    await press('ArrowDown');
    state = await ui();
    check(
      state.focus.cls.includes('model-option') && state.focus.visible,
      `ArrowDown enters the list with a visible focus (${JSON.stringify(state.focus)})`,
    );
    const chosen = state.options[0];
    await press('Enter');
    state = await ui();
    check(!state.panel && state.expanded === 'false', 'choosing a model closes the panel');
    check(
      state.trigger.startsWith(chosen.name) && !state.trigger.endsWith('(default)'),
      `the button shows the chosen model ("${state.trigger}" for "${chosen.name}")`,
    );
    check(
      state.focus.cls.includes('model-trigger'),
      `the focus returns to the model button (${JSON.stringify(state.focus)})`,
    );

    // --- Escape closes without choosing ---------------------------------------------------------
    check(await clickIn('button.model-trigger'), 'the model button is pressed again');
    await sleep(400);
    state = await ui();
    check(
      state.panel && state.focus.cls.includes('session-search'),
      'the panel reopened with the focus in the box',
    );
    await press('Escape');
    state = await ui();
    check(
      !state.panel &&
        state.trigger.startsWith(chosen.name) &&
        state.focus.cls.includes('model-trigger'),
      `Escape closes it, keeps the model and returns the focus (${JSON.stringify(state.focus)})`,
    );

    // --- A press outside the panel closes it (dismissOutside, review #1015 C1) ------------------
    // A real mouse click on the prompt box: it is outside the panel, so the panel must close, the
    // model must stay, and the focus must stay where the user clicked (the rule does not move it).
    check(
      await clickIn('button.model-trigger'),
      'the model button is pressed to test an outside click',
    );
    await sleep(400);
    check((await ui()).panel, 'the panel is open before the outside click');
    check(await clickIn('textarea'), 'the prompt box is pressed (outside the panel)');
    await sleep(400);
    state = await ui();
    check(
      !state.panel && state.expanded === 'false' && state.trigger.startsWith(chosen.name),
      `a press outside closes the model panel and keeps the model ("${state.trigger}")`,
    );
    check(
      state.focus.tag === 'TEXTAREA',
      `...and the focus stays where the user clicked (${JSON.stringify(state.focus)})`,
    );
    const moreAgents = await web.inDoc(
      (doc) => doc.querySelector('button[data-agent-more-trigger]') !== null,
    );
    if (moreAgents) {
      check(await clickIn('button[data-agent-more-trigger]'), '"More agents" is pressed');
      await sleep(400);
      const opened = await web.inDoc((doc) => doc.querySelector('#agent-more-panel') !== null);
      check(opened, 'the "More agents" panel opened');
      check(await clickIn('textarea'), 'the prompt box is pressed (outside "More agents")');
      await sleep(400);
      check(
        !(await web.inDoc((doc) => doc.querySelector('#agent-more-panel') !== null)),
        'a press outside closes "More agents"',
      );
    } else {
      warn(
        'SKIPPED: the server has no custom agent, so "More agents" (and its outside click) was not exercised',
      );
    }

    // --- The agent switch: mouse, then Tab and arrows ------------------------------------------
    check(await clickIn('label[for="agent-plan"]'), '"Plan" is pressed');
    state = await ui();
    check(state.agent === 'plan', `Plan is checked (got "${state.agent}")`);
    await clickIn('textarea');
    await page.keyboard.type('keep this text');
    await press('Tab');
    state = await ui();
    check(
      state.focus.tag === 'INPUT' && state.focus.cls.includes('agent-radio'),
      `Tab from the prompt lands on the agent switch (${JSON.stringify(state.focus)})`,
    );
    check(
      state.focus.visible && state.focus.ring !== '' && state.focus.ring !== 'none',
      `the focused segment shows a ring (${JSON.stringify(state.focus)})`,
    );
    await shot('12c-agent-focus');
    await press('ArrowLeft');
    state = await ui();
    check(state.agent === 'build', `ArrowLeft moves to Build (got "${state.agent}")`);
    await press('ArrowRight');
    state = await ui();
    check(state.agent === 'plan', `ArrowRight moves back to Plan (got "${state.agent}")`);
    const before = state.blocks;
    await press('Enter');
    await sleep(800);
    state = await ui();
    check(
      state.draft === 'keep this text' && state.blocks === before && !(await isBusy()),
      `Enter on the agent switch does NOT send the prompt ("${state.draft}")`,
    );
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      await shot(`12d-agent-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- A prompt carries the choice, and the reply says who answered --------------------------
    await send('Reply with exactly: OK. Do not use any tools.');
    const finished = await waitIdle(120_000);
    state = await ui();
    if (!finished) {
      warn(
        'SKIPPED: the free model did not finish the turn in 120 s; the reply line was not judged',
      );
    } else if (state.metas === 0 || state.alerts > 0) {
      warn(
        `SKIPPED: the free model gave no usable reply (${String(state.metas)} replies, ${String(state.alerts)} alerts); ` +
          'the "Plan · model" line was not judged',
      );
    } else {
      check(
        state.lastMeta === `Plan · ${chosen.name}`,
        `the reply says who answered ("${state.lastMeta}", expected "Plan · ${chosen.name}")`,
      );
    }
    check(
      state.agent === 'plan' && state.trigger.startsWith(chosen.name),
      `the session now holds Plan and the chosen model ("${state.agent}", "${state.trigger}")`,
    );
    await shot('12e-reply-meta');
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      await shot(`12f-reply-meta-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- A NEW session proposes the last model used; the setting wins over it --------------------
    check(await clickButton('New session'), 'New session is pressed after the reply');
    await page.waitForTimeout(1500);
    state = await ui();
    check(
      state.trigger.startsWith(chosen.name) && !state.trigger.endsWith('(default)'),
      `a new session proposes the LAST model used ("${state.trigger}")`,
    );
    check(
      state.agent === 'build',
      `the agent is not remembered: Build again (got "${state.agent}")`,
    );

    const other = options.find((o) => o.id !== chosen.id && o.id !== target.id) ?? target;
    const settingFile = writeSettings(vscode.userDataDir, { 'openVsCode.defaultModel': other.id });
    const applied = await waitFor(
      async () => (await ui()).trigger.startsWith(other.name),
      15_000,
      300,
    );
    state = await ui();
    check(
      applied === true,
      `the setting wins over the last used model ("${state.trigger}", setting ${other.id} in ${settingFile})`,
    );
    await shot('12g-setting');

    writeSettings(vscode.userDataDir, { 'openVsCode.defaultModel': 'nope' });
    const ignored = await waitFor(
      async () => (await ui()).text.includes('is not written provider/model'),
      15_000,
      300,
    );
    state = await ui();
    check(ignored === true, 'a badly written setting is reported to the user once');
    check(
      state.trigger.startsWith(chosen.name),
      `...and ignored: the last used model applies again ("${state.trigger}")`,
    );
    writeSettings(vscode.userDataDir, { 'openVsCode.defaultModel': '' });

    // --- Reopening the session shows ITS model and agent -------------------------------------------
    check(await clickButton('Sessions'), 'Sessions is pressed');
    const rows = await waitFor(
      () => web.inDoc((doc) => doc.querySelectorAll('button.session-main').length > 0),
      20_000,
      300,
    );
    check(rows === true, 'the session list has rows');
    check(await clickIn('button.session-main'), 'the newest session is pressed');
    const reopened = await waitFor(async () => (await ui()).agent === 'plan', 20_000, 300);
    state = await ui();
    check(
      reopened === true && state.trigger.startsWith(chosen.name),
      `the reopened session shows its own model and agent ("${state.agent}", "${state.trigger}")`,
    );
    await shot('12h-reopened');
    assertNoWebviewErrors('selectors');
  });

  // Review #1015 S1: a prompt WITH an attachment threw DataCloneError in a real VS Code (the picked
  // files were Solid store Proxies and `postMessage` cannot clone them). jsdom cannot see it, so this
  // attaches a real file through the real Attach button and sends. The file dialog is the quick-input
  // one (`files.simpleDialog.enable`, see `vscodeProcess.mjs`), which is DOM that Playwright can type in.
  await step('13 attach a real file and send it (review #1015 S1)', async () => {
    const target = path.join(workspace, 'src', 'sample.ts');
    const chips = () =>
      web.inDoc((doc) => ({
        pending: [...doc.querySelectorAll('.chips .chip-name')].map((c) => c.textContent ?? ''),
        sent: [...doc.querySelectorAll('[role="log"] .message-files .chip')].map(
          (c) => c.textContent ?? '',
        ),
        alerts: doc.querySelectorAll('[role="alert"]').length,
      }));
    assertNoWebviewErrors('before attaching');
    // A fresh session: when the model of step 11 ignores "do not use tools" its turn waits for a
    // permission forever (seen on 21/10/2026, screenshot 12e), and a busy session would swallow Enter.
    check(await clickButton('New session'), 'New session is pressed');
    await page.waitForTimeout(1500);
    check(await clickButton('Attach'), 'Attach is pressed');
    const dialog = page.locator('.quick-input-widget input').first();
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    await sleep(400);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(target);
    await sleep(600);
    await shot('13a-attach-dialog');
    await page.keyboard.press('Enter');
    const attached = await waitFor(async () => (await chips()).pending.length > 0, 15_000, 300);
    let state = await chips();
    check(
      attached === true && state.pending.some((name) => name.endsWith('sample.ts')),
      `the picked file shows as a chip ("${state.pending.join(', ')}")`,
    );
    await shot('13b-attached');
    // The quick input gives the focus back to the editor when it closes, a moment later: let it
    // happen, then take the focus into the prompt box before typing (else the text lands in a file).
    await sleep(1000);
    await clickIn('textarea');
    await sleep(300);
    const focus = await web.inDoc((doc) => ({
      tag: doc.activeElement?.tagName ?? '',
      focused: doc.hasFocus(),
    }));
    check(
      focus.tag === 'TEXTAREA' && focus.focused,
      `the prompt box has the keyboard focus (${JSON.stringify(focus)})`,
    );
    await send('Reply with exactly: OK. Do not use any tools.');
    const left = await waitFor(async () => (await chips()).sent.length > 0, 20_000, 300);
    state = await chips();
    check(
      left === true && state.sent.some((name) => name.endsWith('sample.ts')),
      `the message left with its attachment ("${state.sent.join(', ')}")`,
    );
    check(state.pending.length === 0, 'the chip left the prompt box once sent');
    check(
      state.alerts === 0,
      `no alert after sending with an attachment (${String(state.alerts)})`,
    );
    assertNoWebviewErrors('attach');
    if (!(await waitIdle(120_000))) {
      warn('SKIPPED: the free model did not finish the attachment turn in 120 s');
    }
    await shot('13c-attachment-reply');
  });

  // Issue #61 (decisions of Sergio, 22/10/2026, Engram #1021): the reasoning-variant control, a
  // button + panel after the model button, shown only for a model that lists variants. It is the
  // LAST step on purpose: it leaves a remembered "model + variant" behind, which would change what
  // steps 11 and 13 expect a new session to propose. The model with variants is chosen
  // dynamically (the free catalog changes over time); with none, the step is SKIPPED with a
  // warning.
  await step('14 reasoning variant (issue #61)', async () => {
    /** What the prompt row, the variant control and its panel show. Self-contained (serialized). */
    const ui = () =>
      web.inDoc((doc) => {
        const model = doc.querySelector('button.model-trigger');
        const trigger = doc.querySelector('button.variant-trigger');
        const panel = doc.querySelector('#variant-panel');
        const active = doc.activeElement;
        const metas = [...doc.querySelectorAll('.message-assistant .message-meta')];
        const row = [...doc.querySelectorAll('.prompt-selectors button')].map(
          (b) => b.className.split(' ').find((c) => c !== 'secondary') ?? '',
        );
        const style = active ? doc.defaultView.getComputedStyle(active) : null;
        return {
          model: model?.textContent ?? '',
          trigger: trigger?.textContent ?? null,
          expanded: trigger?.getAttribute('aria-expanded') ?? '',
          disabled: trigger?.getAttribute('aria-disabled') ?? '',
          panel: panel !== null,
          entries: [...doc.querySelectorAll('#variant-panel button.model-option')].map((b) => ({
            id: b.getAttribute('data-variant') ?? '',
            current: b.getAttribute('aria-current') === 'true',
          })),
          modelIds: [...doc.querySelectorAll('.model-panel button[data-model]')].map(
            (b) => b.getAttribute('data-model') ?? '',
          ),
          afterModel: row.indexOf('variant-trigger') === row.indexOf('model-trigger') + 1,
          inRow: row.includes('variant-trigger'),
          focus: {
            cls: active?.className ?? '',
            variant: active?.getAttribute?.('data-variant') ?? '',
            visible: active?.matches?.(':focus-visible') ?? false,
            outline: style ? `${style.outlineStyle} ${style.outlineWidth}` : '',
          },
          // Same filter as step 2: not `<html>` (VS Code sets theme variables there) and only
          // NON-EMPTY attributes (Chromium leaves `style=""` on a textarea it has resized).
          styled: [...doc.querySelectorAll('body [style], body[style]')]
            .filter((e) => (e.getAttribute('style') ?? '').trim() !== '')
            .map((e) => `${e.tagName}.${e.className}: ${e.getAttribute('style')}`),
          lastMeta: metas.at(-1)?.textContent ?? '',
          metas: metas.length,
          alerts: doc.querySelectorAll('[role="alert"]').length,
        };
      });
    const setTheme = async (theme) => {
      writeSettings(vscode.userDataDir, { 'workbench.colorTheme': theme });
      await page.waitForTimeout(2500);
    };
    const press = async (key) => {
      await page.keyboard.press(key);
      await sleep(250);
    };
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];
    /** Opens the model panel with the real mouse and presses model `id`; false if not listed. */
    const pickModel = async (id) => {
      if (!(await clickIn('button.model-trigger'))) return false;
      await sleep(400);
      const pressed = await clickIn(`.model-panel button.model-option[data-model="${id}"]`);
      await sleep(500);
      return pressed;
    };

    assertNoWebviewErrors('before the variant step');
    check(await clickButton('New session'), 'New session is pressed');
    await page.waitForTimeout(1500);

    // --- Find a model that lists variants (glm-5.3-flash-free first), else SKIP -----------------
    check(await clickIn('button.model-trigger'), 'the model button is pressed');
    await sleep(400);
    const ids = (await ui()).modelIds;
    await press('Escape');
    const GLM = 'opencode/glm-5.3-flash-free';
    const candidates = [...ids.filter((id) => id === GLM), ...ids.filter((id) => id !== GLM)];
    let withVariants;
    let withoutVariants;
    for (const id of candidates) {
      if (!(await pickModel(id))) continue;
      const has = (await ui()).trigger !== null;
      if (has && withVariants === undefined) withVariants = id;
      if (!has && withoutVariants === undefined) withoutVariants = id;
      if (withVariants !== undefined && withoutVariants !== undefined) break;
    }
    if (withVariants === undefined) {
      warn(
        'SKIPPED: no model of the real catalog lists variants, so the variant control was not exercised',
      );
      return;
    }
    if (withoutVariants === undefined) {
      warn('SKIPPED: every model lists variants, so "the control disappears" was not exercised');
    }

    // --- A model without variants shows no control -------------------------------------------
    if (withoutVariants !== undefined) {
      await pickModel(withoutVariants);
      const state = await ui();
      check(
        state.trigger === null && !state.inRow,
        `a model without variants (${withoutVariants}) shows no variant control`,
      );
    }

    // --- A model with variants: the control, closed and open, in the four themes -------------
    check(await pickModel(withVariants), `the model with variants (${withVariants}) is chosen`);
    let state = await ui();
    check(
      state.trigger === 'Reasoning: Default',
      `the control appears reading "Reasoning: Default" ("${String(state.trigger)}")`,
    );
    check(state.afterModel, 'the control sits right after the model button in the prompt row');
    await shot('14a-variant-closed');
    check(
      await clickIn('button.variant-trigger'),
      'the variant button is pressed with the real mouse',
    );
    await sleep(400);
    state = await ui();
    check(state.panel && state.expanded === 'true', 'the variant panel opened');
    check(
      state.entries[0]?.id === 'default' &&
        state.entries.length >= 2 &&
        state.entries.filter((e) => e.current).length === 1 &&
        state.entries[0].current,
      `the panel lists Default (current) and the catalog variants (${JSON.stringify(state.entries)})`,
    );
    check(
      state.focus.variant === 'default',
      `the focus is on the current entry (${JSON.stringify(state.focus)})`,
    );
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      await shot(`14b-variant-panel-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- Choose a variant with the real mouse ------------------------------------------------
    const variant = state.entries.find((e) => e.id === 'low')?.id ?? state.entries[1]?.id;
    check(
      await clickIn(`#variant-panel button[data-variant="${String(variant)}"]`),
      `the variant "${String(variant)}" is pressed`,
    );
    await sleep(400);
    state = await ui();
    check(
      !state.panel && state.trigger === `Reasoning: ${String(variant)}`,
      `choosing closes the panel and the control reads "Reasoning: ${String(variant)}" ("${String(state.trigger)}")`,
    );
    check(
      state.focus.cls.includes('variant-trigger'),
      `the focus returns to the variant button (${JSON.stringify(state.focus)})`,
    );
    await shot('14c-variant-chosen');
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      await shot(`14d-variant-chosen-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- Keyboard: Tab from the model button, Enter opens, arrows, Escape ---------------------
    await clickIn('textarea');
    const visited = [];
    for (let i = 0; i < 12; i += 1) {
      await press('Tab');
      const focus = (await ui()).focus;
      visited.push(focus.cls);
      if (focus.cls.includes('variant-trigger')) break;
    }
    state = await ui();
    check(
      state.focus.cls.includes('variant-trigger') &&
        (visited.at(-2) ?? '').includes('model-trigger'),
      `Tab from the model button reaches the variant button (${JSON.stringify(visited)})`,
    );
    check(
      state.focus.visible && state.focus.outline !== '' && !state.focus.outline.startsWith('none'),
      `...with a visible focus ring (${JSON.stringify(state.focus)})`,
    );
    await shot('14e-variant-focus');
    await press('Enter');
    state = await ui();
    check(
      state.panel && state.focus.variant === String(variant),
      `Enter opens the panel with the focus on the current variant (${JSON.stringify(state.focus)})`,
    );
    await press('ArrowUp');
    state = await ui();
    check(
      state.focus.cls.includes('model-option') && state.focus.variant !== String(variant),
      `ArrowUp moves to the previous entry (${JSON.stringify(state.focus)})`,
    );
    await press('Escape');
    state = await ui();
    check(
      !state.panel &&
        state.trigger === `Reasoning: ${String(variant)}` &&
        state.focus.cls.includes('variant-trigger'),
      `Escape closes it, keeps the variant and returns the focus (${JSON.stringify(state.focus)})`,
    );

    // --- A press outside closes the panel (dismissOutside) -----------------------------------
    check(
      await clickIn('button.variant-trigger'),
      'the variant button is pressed to test an outside click',
    );
    await sleep(400);
    check((await ui()).panel, 'the variant panel is open before the outside click');
    check(await clickIn('textarea'), 'the prompt box is pressed (outside the panel)');
    await sleep(400);
    state = await ui();
    check(
      !state.panel && state.trigger === `Reasoning: ${String(variant)}`,
      'a press outside closes the variant panel and keeps the variant',
    );

    // --- Decision (c): the same model keeps the variant, another model starts on Default ------
    check(await pickModel(withVariants), 'the SAME model is chosen again');
    state = await ui();
    check(
      state.trigger === `Reasoning: ${String(variant)}`,
      `re-choosing the same model keeps the variant ("${String(state.trigger)}")`,
    );
    const another = candidates.find((id) => id !== withVariants);
    if (another === undefined) {
      warn(
        'SKIPPED: the server lists a single model, so "another model starts on Default" was not exercised',
      );
    } else {
      check(await pickModel(another), `another model (${another}) is chosen`);
      state = await ui();
      check(
        state.trigger === null || state.trigger === 'Reasoning: Default',
        `another model starts on Default or shows no control ("${String(state.trigger)}")`,
      );
      check(await pickModel(withVariants), `the first model is chosen again`);
      state = await ui();
      check(
        state.trigger === 'Reasoning: Default',
        `...and its variant was NOT remembered across the change ("${String(state.trigger)}")`,
      );
      check(await clickIn('button.variant-trigger'), 'the variant button is pressed again');
      await sleep(400);
      check(
        await clickIn(`#variant-panel button[data-variant="${String(variant)}"]`),
        `the variant "${String(variant)}" is chosen again`,
      );
      await sleep(400);
    }

    // --- The prompt carries it, and the reply says so -----------------------------------------
    await send('Reply with exactly: OK. Do not use any tools.');
    const finished = await waitIdle(120_000);
    state = await ui();
    if (!finished) {
      warn(
        'SKIPPED: the free model did not finish the turn in 120 s; the reply line was not judged',
      );
    } else if (state.metas === 0 || state.alerts > 0) {
      warn(
        `SKIPPED: the free model gave no usable reply (${String(state.metas)} replies, ${String(state.alerts)} alerts); ` +
          'the "· variant" line was not judged',
      );
    } else {
      check(
        state.lastMeta.endsWith(` · ${String(variant)}`),
        `the reply line ends in the variant ("${state.lastMeta}", expected "… · ${String(variant)}")`,
      );
    }
    check(
      state.trigger === `Reasoning: ${String(variant)}`,
      `the open session holds the variant ("${String(state.trigger)}")`,
    );
    await shot('14f-variant-reply');

    // --- A NEW session proposes the last model WITH its variant; reopening shows the stored one
    check(await clickButton('New session'), 'New session is pressed after the reply');
    await page.waitForTimeout(1500);
    state = await ui();
    check(
      state.trigger === `Reasoning: ${String(variant)}`,
      `a new session proposes the last used variant ("${String(state.trigger)}")`,
    );
    await shot('14g-variant-new-session');
    check(await clickButton('Sessions'), 'Sessions is pressed');
    const rows = await waitFor(
      () => web.inDoc((doc) => doc.querySelectorAll('button.session-main').length > 0),
      20_000,
      300,
    );
    check(rows === true, 'the session list has rows');
    check(await clickIn('button.session-main'), 'the newest session is pressed');
    const reopened = await waitFor(
      async () => (await ui()).trigger === `Reasoning: ${String(variant)}`,
      20_000,
      300,
    );
    state = await ui();
    check(
      reopened === true,
      `the reopened session shows the variant the SERVER stored ("${String(state.trigger)}")`,
    );
    check(
      state.styled.length === 0,
      `no inline style attribute in the webview body (${state.styled.join(' | ')})`,
    );
    await shot('14h-variant-reopened');
    assertNoWebviewErrors('variant');
  });
} catch (error) {
  // Before the first step: the run could not start (exit 2). Later: an unexpected failure.
  if (!started) startupError = error;
  else failures.push(`unexpected error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await cleanup();
}

if (startupError !== undefined) {
  console.error(
    `test:visual could not start: ${startupError instanceof Error ? startupError.message : String(startupError)}`,
  );
  process.exit(2);
}

// XDG isolation: opencode must have created its database inside the run's own data dir, and the
// developer's real one should not have been touched (only a warning: they may be using opencode).
const isolatedDb = path.join(vscode.xdgRoot, 'data', 'opencode', 'opencode.db');
check(fs.existsSync(isolatedDb), `opencode wrote its database inside the run (${isolatedDb})`);
if (JSON.stringify(realDbTimes()) !== JSON.stringify(realDbBefore)) {
  warn(
    `${realOpencodeDir} changed during the run: either XDG was not honoured or opencode was in use elsewhere`,
  );
}

console.log('\n== summary');
console.log(`screenshots (${String(shots.length)}):`);
for (const file of shots) console.log(`  ${file}`);
if (warnings.length) {
  console.log(`warnings (${String(warnings.length)}):`);
  for (const message of warnings) console.log(`  - ${message}`);
}
if (failures.length) {
  console.log(`FAILED (${String(failures.length)}):`);
  for (const message of failures) console.log(`  - ${message}`);
  process.exit(1);
}
console.log('all visual checks passed');
