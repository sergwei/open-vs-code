// Maps the files a change touched to the `test:visual` groups that cover them (`--affected`).
//
// Pure on purpose (no `fs`, no `git`): `affected.test.mjs` runs under Vitest, and `run.mjs` is the
// one that asks git for the file list and hands it to {@link selectForFiles}. Phase 2 of
// tooling/test-speed (decision P2=1 of Sergio, Engram `tooling/test-speed/decisions/p1-p4`: a
// CONSERVATIVE `--affected` that prints its choice; an unmapped or cross-cutting file means the
// full run). Groups live in `steps.mjs` (`GROUPS`); `affected.test.mjs` checks that every group
// named here exists there.

/**
 * Files with no visual effect: tests, docs, the integration suite, the agent configuration and the
 * post-processing tools `compare-runs.mjs` and `fingerprint.mjs` (they change no check: `run.mjs`
 * only calls the fingerprint to print its line and save its manifest, and the fingerprint does not
 * hash itself). They never select a group by themselves. Tested before the cross-cutting list, so
 * `chatController.test.ts` is `none` although `chatController.ts` is not.
 */
const NO_EFFECT = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.md$/,
  /^test\/integration\//,
  /^\.claude\//,
  /^test\/visual\/(compare-runs|fingerprint)\.mjs$/,
];

/**
 * Cross-cutting files: they feed every area, so a change there is judged by the full run. The
 * list comes from the plan (Engram `tooling/test-speed/plan`, section 5, phase 2) plus the files
 * that are the same kind of plumbing and the plan did not name (chatViewProvider, chatWebview,
 * webviewHtml, wireMapping, ids, vscode.ts, testing.tsx): when in doubt, full. Any
 * `test/visual/*.mjs` that is not a test is here too: run.mjs, steps.mjs, vscodeProcess.mjs and
 * webviewCdp.mjs ARE the harness, and a change in them can move any step.
 */
const TRANSVERSAL = [
  /^src\/shared\//,
  /^webview-ui\/src\/(store|chat)\//,
  /^webview-ui\/src\/(App\.tsx|index\.css|index\.tsx|host\.ts|uiState\.ts|vscode\.ts|testing\.tsx)$/,
  /^src\/extension\/(chatController|chatViewProvider|chatWebview|eventTranslator|eventStream|extension|webviewHtml|wireMapping|ids)\.ts$/,
  /^package(-lock)?\.json$/,
  /^src\/extension\/test-fixtures\//,
  /^test\/visual\/[^/]+\.mjs$/,
];

/**
 * The area rules: a pattern and the groups that cover it. The directories and files were checked
 * with `ls` (plan, section 5). Beyond the plan: the session host files go to `sessions` (the
 * group of the steps that drive the list, the native tree and fork/subagent sessions),
 * `requestResolutions.ts` to `requests` and `setupActions.ts` to `setup`; decided by the title of
 * those steps in `run.mjs`. UNVERIFIED: that these extras are enough; a regression found outside
 * the chosen groups means the rule is too narrow, so widen it or make the file cross-cutting.
 */
export const AFFECTED_RULES = [
  { pattern: /^webview-ui\/src\/sessions\//, groups: ['sessions'] },
  {
    pattern:
      /^src\/extension\/(sessionBrowser|sessionTree|sessionsView|sessionsSearch|sessionLineage|sessionUi|sessionOrganization|sessionsOrganize|organizationStore)\.ts$/,
    groups: ['sessions'],
  },
  // E10-config-views: the Settings tab (steps 35-36). `src/shared/settingsProtocol.ts` is already
  // cross-cutting through `src/shared/`.
  { pattern: /^webview-ui\/src\/settings\//, groups: ['config'] },
  {
    pattern:
      /^src\/extension\/(serverConfig|providerAuth|providerAuthUi|settingsController|settingsPanel)\.ts$/,
    groups: ['config'],
  },
  { pattern: /^webview-ui\/src\/requests\//, groups: ['requests'] },
  {
    pattern: /^src\/extension\/(pendingRequests|attention|attentionPolicy|requestResolutions)\.ts$/,
    groups: ['requests'],
  },
  { pattern: /^webview-ui\/src\/selectors\//, groups: ['selectors'] },
  { pattern: /^src\/extension\/modelPreference\.ts$/, groups: ['selectors'] },
  { pattern: /^webview-ui\/src\/(markdown|tools|changes)\//, groups: ['render'] },
  {
    pattern: /^src\/extension\/(chatTabs|chatPanels|chatPane|chatLifecycle|chatSurfaceGate)\.ts$/,
    groups: ['tabs'],
  },
  // chatLocation.ts also decides the default of a profile with no chatLocation key (step 25 D0,
  // group `setup`), so it maps to both groups.
  { pattern: /^src\/extension\/chatLocation\.ts$/, groups: ['tabs', 'setup'] },
  {
    pattern:
      /^src\/extension\/(fileMentions|droppedFiles|pastedImages|contextPrompts|editorActions)\.ts$/,
    groups: ['composer'],
  },
  {
    pattern:
      /^src\/extension\/(opencodeServer|opencodeBinary|binaryDetection|externalServer|setupActions|serverStatus)\.ts$/,
    groups: ['setup'],
  },
];

/** A path as the rules see it: `/` separators (git prints those, a Windows caller may not) and no `./`. */
export function normalizePath(file) {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Decides what `--affected` runs for a list of changed files.
 *
 * Returns `{ mode, groups, reasons }`. `mode` is `'full'` as soon as ONE file is cross-cutting or
 * matches no rule (a map that guesses would miss a regression in another area), `'groups'` when
 * every file that matters is mapped (`groups` is their union, in order of first appearance), and
 * `'none'` when every file has no visual effect (or there are no files). `reasons` has one line
 * per file that decided something: `<file> -> <groups>`, `<file>: cross-cutting` or
 * `<file>: not mapped`; the no-effect files are left out. Paths are normalised first, so
 * `src\shared\a.ts` equals `src/shared/a.ts`.
 */
export function selectForFiles(files) {
  const groups = [];
  const reasons = [];
  let full = false;
  for (const raw of new Set(files.map(normalizePath))) {
    if (raw === '' || NO_EFFECT.some((pattern) => pattern.test(raw))) continue;
    if (TRANSVERSAL.some((pattern) => pattern.test(raw))) {
      full = true;
      reasons.push(`${raw}: cross-cutting`);
      continue;
    }
    const rule = AFFECTED_RULES.find((candidate) => candidate.pattern.test(raw));
    if (rule === undefined) {
      full = true;
      reasons.push(`${raw}: not mapped`);
      continue;
    }
    for (const group of rule.groups) if (!groups.includes(group)) groups.push(group);
    reasons.push(`${raw} -> ${rule.groups.join(', ')}`);
  }
  if (full) return { mode: 'full', groups: [], reasons };
  return { mode: groups.length > 0 ? 'groups' : 'none', groups, reasons };
}

/**
 * Reads `--affected` or `--affected <ref>` (also `--affected=<ref>`) from `argv`.
 *
 * Returns `{ enabled: false }` without the flag, else `{ enabled: true, ref }` where `ref` is the
 * next argument when it does not start with `--`, and `undefined` otherwise (the caller then
 * defaults to `origin/main`).
 */
export function parseAffectedArg(argv) {
  const index = argv.findIndex((arg) => arg === '--affected' || arg.startsWith('--affected='));
  if (index === -1) return { enabled: false };
  if (argv[index].startsWith('--affected=')) {
    const ref = argv[index].slice('--affected='.length);
    return { enabled: true, ref: ref === '' ? undefined : ref };
  }
  const next = argv[index + 1];
  return { enabled: true, ref: next !== undefined && !next.startsWith('--') ? next : undefined };
}
