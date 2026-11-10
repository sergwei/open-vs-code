// Tells WHICH steps of `test:visual` a change to `run.mjs` or `steps.mjs` can move (`--affected`).
//
// Pure on purpose (no `fs`, no `git`): `harnessDiff.test.mjs` runs under Vitest, and `run.mjs` hands
// it the two texts (`git show <base>:<path>` and the disk). It needs `typescript` (the parser) and
// `esbuild` (to compare code without comments or layout, as `fingerprint.mjs` does), so `run.mjs`
// imports it only with `--affected`. Until tooling/visual-ci-parallel (issue #199, Engram #2131)
// every `test/visual/*.mjs` was cross-cutting, so a change that only ADDED a step forced the full run.
//
// The idea: compare "skeletons". In `run.mjs` every run of consecutive `await step('<id> …', …)`
// statements is replaced by one marker and the bodies are compared one by one; in `steps.mjs` the
// entries of `STEPS` are taken out and compared by `id`. If the skeleton (everything that is not a
// step) is the same after minifying, only the steps whose body or entry changed are chosen. A
// shared helper that changed, a step moved, removed or renamed, a step name that is not a literal,
// or text that does not parse means `full`: when in doubt, the full run.
//
// This module only says WHICH steps changed. The step that follows each one in canonical order is
// added by `selectForFiles` (`affected.mjs`, its `order` argument), because state leaks forward.
//
// Rejected: mapping the diff hunks to the lines between two `await step(` calls. Code shared by
// several steps (`dropAndPaste`, the settings helpers) would be credited to the step above it.

import ts from 'typescript';
import { transformSync } from 'esbuild';
import { stepIdOf } from './steps.mjs';

/**
 * @typedef {{ mode: 'steps' | 'none' | 'full', steps: string[], reason: string }} HarnessDiff
 */

/** The answer "run everything", with the reason that is printed next to the file. */
function full(reason) {
  return { mode: 'full', steps: [], reason };
}

/** Line endings to `\n`: a Windows checkout and `git show` differ inside template literals. */
function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n');
}

/**
 * The code without comments or layout (esbuild `minifyWhitespace`, as the fingerprint does).
 * Throws when the text does not parse, which the callers turn into `full`.
 */
function minify(code) {
  return transformSync(code, {
    loader: 'js',
    format: 'esm',
    legalComments: 'none',
    minifyWhitespace: true,
  }).code;
}

/**
 * The step id when `statement` is `await step('<name>', …)` (name a string or a template without
 * substitutions), `undefined` when it is another statement. Throws on a `step` call whose name is
 * not a literal: the diff could not tell which step it is.
 */
function stepStatementId(statement) {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const call = ts.isAwaitExpression(statement.expression)
    ? statement.expression.expression
    : undefined;
  if (call === undefined || !ts.isCallExpression(call)) return undefined;
  if (!ts.isIdentifier(call.expression) || call.expression.text !== 'step') return undefined;
  const [first] = call.arguments;
  if (
    first === undefined ||
    !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
  ) {
    throw new Error('a step() call whose name is not a literal');
  }
  return stepIdOf(first.text);
}

/**
 * Splits `run.mjs` into its skeleton (each run of consecutive step statements becomes one
 * `__STEPS__();` marker) and the minified wrapped body of every step by id, in source order.
 * Throws on duplicated ids or text that does not parse.
 */
function splitRun(source) {
  const sf = ts.createSourceFile('run.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  /** @type {{ start: number, end: number }[]} */
  const runs = [];
  /** @type {Map<string, string>} */
  const bodies = new Map();
  const visit = (node) => {
    const statements = ts.isSourceFile(node) || ts.isBlock(node) ? node.statements : undefined;
    if (statements !== undefined) {
      let run;
      for (const statement of statements) {
        const id = stepStatementId(statement);
        if (id === undefined) {
          run = undefined;
          ts.forEachChild(statement, visit);
          continue;
        }
        if (bodies.has(id)) throw new Error(`duplicated step id ${id}`);
        const text = source.slice(statement.getStart(sf), statement.end);
        bodies.set(id, minify(`async function __step(){\n${text}\n}`));
        if (run === undefined) {
          run = { start: statement.getStart(sf), end: statement.end };
          runs.push(run);
        } else run.end = statement.end;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let skeleton = source;
  for (const run of [...runs].reverse()) {
    skeleton = `${skeleton.slice(0, run.start)}__STEPS__();${skeleton.slice(run.end)}`;
  }
  return { skeleton: minify(skeleton), bodies };
}

/**
 * Decides what a change to `run.mjs` can move. Returns `{ mode, steps, reason }`: `'steps'` with the
 * ids whose `await step(…)` statement is new or has another body (comments and layout do not count),
 * `'none'` when only comments or layout changed, and `'full'` when anything outside the steps
 * changed, a step was removed or the common steps changed order, a name is not a literal, an id is
 * duplicated or a text does not parse. `reason` says which.
 * VERIFIED on Windows 11 (10/11/2026) against git, not only fabricated sources: the texts of
 * `run.mjs` at d17ea32 and bf1f0c7 (the commit that added the step 51) gave `steps: ['51']`, and
 * those at d8ba69f~1 and d8ba69f (steps 49 and 50, which also added a helper) gave `full`
 * ("code outside the steps changed"), with the one-off script of the task report.
 * UNVERIFIED: that the `full` of a real helper change is never too eager for a helper only one
 * step uses (it is: the diff cannot tell).
 */
export function diffRunMjs(before, after) {
  try {
    const a = splitRun(normalizeEol(before));
    const b = splitRun(normalizeEol(after));
    if (a.skeleton !== b.skeleton) return full('code outside the steps changed');
    const kept = [...a.bodies.keys()];
    if (kept.some((id) => !b.bodies.has(id))) return full('a step was removed');
    const common = [...b.bodies.keys()].filter((id) => a.bodies.has(id));
    if (common.join('\n') !== kept.join('\n')) return full('the steps changed order');
    const changed = [...b.bodies.keys()].filter((id) => a.bodies.get(id) !== b.bodies.get(id));
    return changed.length > 0
      ? { mode: 'steps', steps: changed, reason: 'step bodies changed' }
      : { mode: 'none', steps: [], reason: 'only comments or layout changed' };
  } catch (error) {
    return full(`could not compare (${String(error.message).split('\n')[0]})`);
  }
}

/**
 * Splits `steps.mjs` into its skeleton (the elements of the `STEPS` array taken out) and the
 * entries by id: the minified text of every property but `budgetS`, which changes no check. Throws
 * when `STEPS` is not an array of object literals with a literal `id`.
 */
function splitSteps(source) {
  const sf = ts.createSourceFile(
    'steps.mjs',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let array;
  const find = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'STEPS' &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      array = node.initializer;
    } else ts.forEachChild(node, find);
  };
  find(sf);
  if (array === undefined) throw new Error('STEPS is not an array literal');
  /** @type {Map<string, string>} */
  const entries = new Map();
  for (const element of array.elements) {
    if (!ts.isObjectLiteralExpression(element)) throw new Error('a STEPS entry is not an object');
    const props = [];
    let id;
    for (const prop of element.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
        throw new Error('a STEPS entry has a property that is not name: value');
      }
      if (prop.name.text === 'budgetS') continue;
      if (prop.name.text === 'id') {
        if (!ts.isStringLiteral(prop.initializer)) throw new Error('a STEPS id is not a string');
        id = prop.initializer.text;
      }
      props.push(`${prop.name.text}:${minify(`(${prop.initializer.getText(sf)})`)}`);
    }
    if (id === undefined) throw new Error('a STEPS entry has no id');
    if (entries.has(id)) throw new Error(`duplicated STEPS id ${id}`);
    entries.set(id, props.join(','));
  }
  let skeleton = source;
  if (array.elements.length > 0) {
    const start = array.elements[0].getStart(sf);
    const end = array.elements[array.elements.length - 1].end;
    skeleton = `${source.slice(0, start)}__ENTRIES__${source.slice(end)}`;
  }
  return { skeleton: minify(skeleton), entries };
}

/**
 * Decides what a change to `steps.mjs` can move. Returns `{ mode, steps, reason }` like
 * {@link diffRunMjs}: `'steps'` with the ids of the entries that are new or whose `needs`,
 * `sendsPrompt`, `groups` or `id` changed; `'none'` when only `budgetS` or comments changed (no
 * check depends on them); `'full'` for anything else in the module (functions, `GROUPS`, banners),
 * a removed or reordered entry, or text that does not parse.
 */
export function diffStepsMjs(before, after) {
  try {
    const a = splitSteps(normalizeEol(before));
    const b = splitSteps(normalizeEol(after));
    if (a.skeleton !== b.skeleton) return full('code outside the STEPS entries changed');
    const kept = [...a.entries.keys()];
    if (kept.some((id) => !b.entries.has(id))) return full('a STEPS entry was removed');
    const common = [...b.entries.keys()].filter((id) => a.entries.has(id));
    if (common.join('\n') !== kept.join('\n')) return full('the STEPS entries changed order');
    const changed = [...b.entries.keys()].filter((id) => a.entries.get(id) !== b.entries.get(id));
    return changed.length > 0
      ? { mode: 'steps', steps: changed, reason: 'STEPS entries changed' }
      : { mode: 'none', steps: [], reason: 'only budgetS or comments changed' };
  } catch (error) {
    return full(`could not compare (${String(error.message).split('\n')[0]})`);
  }
}
