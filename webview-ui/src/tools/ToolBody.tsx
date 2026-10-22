import { createMemo, For, Index, Match, Show, Switch } from 'solid-js';
import { DiffView } from './DiffView';
import { MAX_LINES, OutputBlock } from './OutputBlock';
import { PathLink } from './PathLink';
import { clampLines } from './patchLines';
import { toolBody, type BodySection, type MatchGroup } from './toolView';
import type { Part } from '../../../src/shared/model';

type ToolPart = Extract<Part, { type: 'tool' }>;

/** Narrowing helper for `<Match when>`: the section itself when it has that kind, else `undefined`. */
function only<K extends BodySection['kind']>(
  section: BodySection,
  kind: K,
): Extract<BodySection, { kind: K }> | undefined {
  return section.kind === kind ? (section as Extract<BodySection, { kind: K }>) : undefined;
}

/** Keeps at most `max` hits across the groups, in order, and says how many were left out. */
function clampMatches(groups: MatchGroup[], max: number): { groups: MatchGroup[]; hidden: number } {
  const flat = groups.flatMap((group) => group.hits.map((hit) => ({ path: group.path, hit })));
  const { items, hidden } = clampLines(flat, max, 'head');
  const rebuilt: MatchGroup[] = [];
  for (const { path, hit } of items) {
    const last = rebuilt[rebuilt.length - 1];
    if (last?.path === path) last.hits.push(hit);
    else rebuilt.push({ path, hits: [hit] });
  }
  return { groups: rebuilt, hidden };
}

/**
 * The unfolded content of a tool card: one block per section of `toolBody` (command and output,
 * a mini diff, a list of paths, grep matches, a note, an error).
 *
 * It is created only when the card opens (`ToolCard` wraps it in `<Show>`), so a folded card costs
 * nothing per token and the body is not in the DOM until asked for. `<Switch>` and not `if`, because
 * a Solid component runs once. Sections are recomputed when the block changes (running to
 * completed) and mapped by position with `<Index>`, because `toolBody` builds fresh objects each
 * time and `<For>` would rebuild the DOM (and drop the scroll of an output) on every update; the
 * open state lives in `ToolCard`, so that does not fold it. Lists are clipped at
 * {@link MAX_LINES} with a notice. A path is a {@link PathLink}; a grep hit opens its line.
 * VERIFIED by `ToolCard.test.tsx` (fabricated blocks rendered in jsdom). VERIFIED in a real VS Code
 * for the shell, read, grep and edit bodies (`test:visual` step 15, 22/10/2026 final run 13:59-14:05,
 * Windows 11; the bodies it printed are listed in `toolView.ts`), and the text of the `error`
 * section of a failed read (`run-output.txt` line 383). NOT observed: the `paths` section (glob),
 * the `note` section, how the `error` section looks, a clipped output (the real outputs were short), and the
 * `matches` clip notice.
 */
export function ToolBody(props: { part: ToolPart }) {
  const sections = createMemo(() => toolBody(props.part));
  return (
    <Index each={sections()}>
      {(sectionAt) => (
        <Switch>
          <Match when={only(sectionAt(), 'code')}>
            {(code) => (
              <OutputBlock
                label={code().label}
                text={code().text}
                from={code().from}
                language={code().language}
              />
            )}
          </Match>
          <Match when={only(sectionAt(), 'diff')}>
            {(diff) => <DiffView label={diff().label} path={diff().path} lines={diff().lines} />}
          </Match>
          <Match when={only(sectionAt(), 'paths')}>
            {(paths) => {
              const clamped = createMemo(() => clampLines(paths().paths, MAX_LINES, 'head'));
              return (
                <div class="tool-section" role="group" aria-label={paths().label}>
                  <ul class="tool-paths">
                    <For each={clamped().items}>
                      {(path) => (
                        <li>
                          <PathLink path={path} />
                        </li>
                      )}
                    </For>
                  </ul>
                  <Show when={clamped().hidden > 0}>
                    <p class="tool-notice">
                      {`Showing the first ${String(clamped().items.length)} of ${String(paths().paths.length)} files.`}
                    </p>
                  </Show>
                </div>
              );
            }}
          </Match>
          <Match when={only(sectionAt(), 'matches')}>
            {(matches) => {
              const clamped = createMemo(() => clampMatches(matches().groups, MAX_LINES));
              return (
                <div class="tool-section" role="group" aria-label={matches().label}>
                  <For each={clamped().groups}>
                    {(group) => (
                      <div class="tool-match-group">
                        <PathLink path={group.path} />
                        <For each={group.hits}>
                          {(hit) => (
                            <div class="tool-match">
                              {hit.line === undefined ? null : (
                                <PathLink
                                  path={group.path}
                                  line={hit.line}
                                  text={String(hit.line)}
                                />
                              )}
                              <span class="tool-match-text">{hit.text}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                  <Show when={clamped().hidden > 0}>
                    <p class="tool-notice">
                      {`${String(clamped().hidden)} more matches are not shown.`}
                    </p>
                  </Show>
                </div>
              );
            }}
          </Match>
          <Match when={only(sectionAt(), 'note')}>
            {(note) => <p class="tool-note">{note().text}</p>}
          </Match>
          <Match when={only(sectionAt(), 'error')}>
            {(error) => <p class="tool-error">{error().text}</p>}
          </Match>
        </Switch>
      )}
    </Index>
  );
}
