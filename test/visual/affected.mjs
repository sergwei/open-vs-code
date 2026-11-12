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
 * hash itself), plus (tooling/visual-ci-parallel) this file, `harnessDiff.mjs` (both only choose
 * what to run, never change a check), `merge-shards.mjs` (post-processing of finished outputs)
 * and `.github/` (workflows run the suite, they are not in it). They never select a group by
 * themselves. Tested before the cross-cutting list, so `chatController.test.ts` is `none`
 * although `chatController.ts` is not.
 */
const NO_EFFECT = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.md$/,
  /^test\/integration\//,
  /^\.claude\//,
  /^\.github\//,
  /^test\/visual\/(compare-runs|fingerprint|affected|harnessDiff|merge-shards)\.mjs$/,
  // E11-i18n: the catalog exporter and checker is a build-time tool.
  /^scripts\/l10n\.mjs$/,
  // E11-i18n: the language catalogs (`l10n/**`, `package.nls.<id>.json`). No step of `test:visual`
  // runs in another language any more (the Spanish window, step 42, was removed on 04/11/2026), so
  // no step reads them; `node scripts/l10n.mjs check` and the unit tests do. The base manifest
  // catalog `package.nls.json` is NOT here (the regex needs an `<id>`): it is cross-cutting below.
  /^l10n\/|^package\.nls\.[a-z0-9-]+\.json$/,
];

/**
 * Cross-cutting files: they feed every area, so a change there is judged by the full run. The
 * list comes from the plan (Engram `tooling/test-speed/plan`, section 5, phase 2) plus the files
 * that are the same kind of plumbing and the plan did not name (chatViewProvider, chatWebview,
 * webviewHtml, wireMapping, ids, vscode.ts, testing.tsx): when in doubt, full. Any
 * `test/visual/*.mjs` that is not a test or a no-effect tool is here too: run.mjs, steps.mjs,
 * vscodeProcess.mjs and webviewCdp.mjs ARE the harness, and a change in them can move any step
 * (run.mjs and steps.mjs are narrowed to the changed steps when the caller passes `harness`).
 */
const TRANSVERSAL = [
  /^src\/shared\//,
  /^webview-ui\/src\/(store|chat)\//,
  /^webview-ui\/src\/(App\.tsx|index\.css|index\.tsx|host\.ts|uiState\.ts|vscode\.ts|testing\.tsx)$/,
  /^src\/extension\/(chatController|chatViewProvider|chatWebview|eventTranslator|eventStream|extension|webviewHtml|wireMapping|ids)\.ts$/,
  /^package(-lock)?\.json$/,
  // E11-i18n: the base manifest catalog and the two boots feed every surface.
  /^package\.nls\.json$/,
  /^src\/extension\/l10nBoot\.ts$/,
  /^webview-ui\/src\/l10nBoot\.ts$/,
  /^src\/extension\/test-fixtures\//,
  /^test\/visual\/[^/]+\.mjs$/,
];

/**
 * The area rules: a pattern and the groups that cover it. The directories and files were checked
 * with `ls` (plan, section 5). Beyond the plan: the session host files go to `sessions` (the
 * group of the steps that drive the list, the native tree and fork/subagent sessions),
 * `requestResolutions.ts` to `requests` and `setupActions.ts` to `setup`; decided by the title of
 * those steps in `run.mjs`. E9-sidebar-home adds the group `home` (the native Changes and Usage
 * views, the Quick start view and their model files, steps 49 and 50). `sessionTree.ts` (which
 * also draws the changed files count of a row) stays in `sessions` only: the count has no step of
 * its own. The subagent monitor (`webview-ui/src/subagents/`, `subagentDigest.ts`,
 * `sessionActivity.ts`, issue #189) maps to the new group `subagents`, which holds step 51; the
 * mapping is by the title of that step, not measured. The chat panel tabs (`webview-ui/src/panel/`
 * and the host modules `sessionInstructions`, `sessionTranscript` and `sessionExportUi`, issue #188)
 * map to the new group `panel`, which holds steps 54 and 55; also by the title of those steps.
 * UNVERIFIED: that these extras are enough; a
 * regression found outside the chosen groups means the rule is too narrow, so widen it or make
 * the file cross-cutting.
 */
export const AFFECTED_RULES = [
  // E10-mods: the mods code, its host half and the band component (step 38). `src/shared/`,
  // `chatController.ts` and `test-fixtures/` (where the mod fixtures live) are cross-cutting already.
  {
    pattern:
      /^src\/mods\/|^src\/extension\/(modDiscovery|modHost|modEvents|modToggles|modsLifecycle|modsLoader|modsChat|modPanel\w*)\.ts$|^webview-ui\/src\/mods\//,
    groups: ['mods'],
  },
  // E9-sidebar-home: the Changes and Usage views, the Quick start view and what builds them (steps
  // 49 and 50, group `home`); `chatController.ts`, `ids.ts`, `package.json` and `test-fixtures/` are
  // cross-cutting already.
  {
    pattern:
      /^src\/extension\/(sessionChanges|changesView|usageStats|usageView|sidebarHome|homeController|homeModelPick|homeView)\.ts$|^webview-ui\/src\/home\//,
    groups: ['home'],
  },
  { pattern: /^webview-ui\/src\/sessions\//, groups: ['sessions'] },
  // E2-chat-panel-tabs (issue #188): the tabs, the queue chips and the Changes and Session panels
  // (steps 54 and 55, group `panel`) and the host modules behind Instructions and Export. The other
  // files that change with the issue (`src/shared/`, `chat/`, `store/`, `App.tsx`,
  // `chatController.ts`, `eventTranslator.ts`, `test-fixtures/`) are already cross-cutting.
  {
    pattern:
      /^webview-ui\/src\/panel\/|^src\/extension\/(sessionInstructions|sessionTranscript|sessionExportUi)\.ts$/,
    groups: ['panel'],
  },
  // E2-subagent-monitor (issue #189): the bar, the live cards and the digest the host builds (step 51).
  {
    pattern: /^webview-ui\/src\/subagents\/|^src\/extension\/(subagentDigest|sessionActivity)\.ts$/,
    groups: ['subagents'],
  },
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
  // E3-work-mode: the pure decision of Auto and the destructive-command classifier (step 44).
  // `chatController.ts`, `src/shared/` and `webview-ui/src/chat/` are cross-cutting already.
  { pattern: /^src\/extension\/(workMode|destructiveCommand)\.ts$/, groups: ['requests'] },
  {
    pattern: /^src\/extension\/(pendingRequests|attention|attentionPolicy|requestResolutions)\.ts$/,
    groups: ['requests'],
  },
  { pattern: /^webview-ui\/src\/selectors\//, groups: ['selectors'] },
  // modelPreference.ts also decides the `preference.status` of the Models section (step 47).
  { pattern: /^src\/extension\/modelPreference\.ts$/, groups: ['selectors', 'config'] },
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
      /^src\/extension\/(opencodeServer|opencodeBinary|binaryDetection|externalServer|setupActions|serverStatus|projectPlugins|pluginConsent|pluginConsentUi|pluginRecheck)\.ts$/,
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
 * Returns `{ mode, groups, steps, reasons }`. `mode` is `'full'` as soon as ONE file is
 * cross-cutting or matches no rule (a map that guesses would miss a regression in another area),
 * `'groups'` when every file that matters is mapped (`groups` is their union, in order of first
 * appearance; `steps` the step ids chosen by name, see below; either may be empty but not both),
 * and `'none'` when every file has no visual effect (or there are no files). `reasons` has one
 * line per file that decided something: `<file> -> <groups>`, `<file> -> steps <ids>`,
 * `<file>: cross-cutting` or `<file>: not mapped`; the no-effect files are left out. Paths are
 * normalised first, so `src\shared\a.ts` equals `src/shared/a.ts`.
 *
 * `harness` (optional) maps `test/visual/run.mjs` and `test/visual/steps.mjs` to the result of
 * `harnessDiff.mjs` (`{ mode: 'steps' | 'none' | 'full', steps, reason }`, computed by the caller
 * so that this module stays free of the parser). A file listed there is judged by it: `steps`
 * adds those ids, `none` selects nothing, `full` is cross-cutting with the reason. Without it
 * (or for a file not in it) the two files are cross-cutting as before, which is what
 * `fingerprint.mjs` `checkRun` relies on.
 *
 * `order` (optional, the canonical `STEP_IDS`) turns on two rules for the ids of a `steps` diff
 * (decision of Sergio, Engram `tooling/visual-ci-parallel/decisions/review-w1-w2`): the step that
 * FOLLOWS each chosen one in `order` is chosen too (state leaks forward: the end of steps 49/50
 * broke 50/51 in a full run, and a per-step diff cannot see it), printed as `(+ next 50)`; and an
 * id that is not in `order` makes the answer `full` instead of being dropped by the caller. The
 * last step has no next. Without `order` neither rule applies.
 * HYPOTHESIS: that the next step is enough. A leak can reach two steps ahead, and only a full run
 * (the `visual` check of a pull request) sees that.
 */
export function selectForFiles(files, harness = {}, order = undefined) {
  const groups = [];
  const steps = [];
  const reasons = [];
  let full = false;
  for (const raw of new Set(files.map(normalizePath))) {
    if (raw === '' || NO_EFFECT.some((pattern) => pattern.test(raw))) continue;
    const diff = harness[raw];
    if (diff !== undefined) {
      if (diff.mode === 'full') {
        full = true;
        reasons.push(`${raw}: cross-cutting (${diff.reason})`);
      } else if (diff.mode === 'steps') {
        const unknown = order === undefined ? [] : diff.steps.filter((id) => !order.includes(id));
        if (unknown.length > 0) {
          full = true;
          reasons.push(`${raw}: cross-cutting (step ${unknown.join(', ')} is not a known step id)`);
          continue;
        }
        const nexts = [];
        for (const id of diff.steps) {
          const next = order?.[order.indexOf(id) + 1];
          if (next !== undefined && !diff.steps.includes(next) && !nexts.includes(next)) {
            nexts.push(next);
          }
        }
        for (const id of [...diff.steps, ...nexts]) if (!steps.includes(id)) steps.push(id);
        reasons.push(
          `${raw} -> steps ${diff.steps.join(', ')}${nexts.length > 0 ? ` (+ next ${nexts.join(', ')})` : ''}`,
        );
      }
      continue;
    }
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
  if (full) return { mode: 'full', groups: [], steps: [], reasons };
  const chosen = groups.length > 0 || steps.length > 0;
  return { mode: chosen ? 'groups' : 'none', groups, steps, reasons };
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
