import * as l10n from '@vscode/l10n';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import { formatParts, plural } from '../../../src/shared/l10n';
import type { SettingsMcpServerRow } from '../../../src/shared/settingsProtocol';
import { CheckIcon, CrossIcon, WarningIcon, WaitingIcon } from '../chat/icons';
import type { SendSettings } from './ProviderCard';
import type { SettingsStoreState } from './settingsStore';

/**
 * The status as a word, in the interface language, so the state never depends on colour or icon
 * alone. A function, not a table built at module level, so the texts follow the locale set at
 * start-up.
 */
function statusWord(status: SettingsMcpServerRow['status']): string {
  switch (status) {
    case 'connected':
      return l10n.t('connected');
    case 'pending':
      return l10n.t('connecting');
    case 'disabled':
      return l10n.t('disabled');
    case 'failed':
      return l10n.t('failed');
    case 'needs_auth':
      return l10n.t('needs sign-in');
  }
}

/** The `data-status` of the step styles for a server status. */
const STATUS_TONE: Record<SettingsMcpServerRow['status'], string> = {
  connected: 'done',
  pending: 'running',
  disabled: 'waiting',
  failed: 'failed',
  needs_auth: 'attention',
};

/** "2 resources · 1 template", or an empty string when there is neither. */
export function countsText(server: SettingsMcpServerRow): string {
  const parts: string[] = [];
  const resources = server.resources.length;
  const templates = server.templates.length;
  if (resources > 0) {
    parts.push(
      plural(resources, l10n.t('{0} resource', resources), l10n.t('{0} resources', resources)),
    );
  }
  if (templates > 0) {
    parts.push(
      plural(templates, l10n.t('{0} template', templates), l10n.t('{0} templates', templates)),
    );
  }
  return parts.join(' · ');
}

/** What the one button of a row does: its label and the message it sends. */
interface RowAction {
  label: string;
  /** True for a sign-in, which also waits while ANY sign-in of the host is running. */
  signIn: boolean;
}

/**
 * The action the row offers for its state, or `undefined` when it offers none: Connect (disabled),
 * Retry (failed), Disconnect (connected or still connecting) and Sign in (needs sign-in with an
 * integration the host can run, `canSignIn`). A server that needs sign-in without that has no
 * button: the row says to run `opencode mcp auth` instead.
 */
function actionOf(server: SettingsMcpServerRow): RowAction | undefined {
  switch (server.status) {
    case 'disabled':
      return { label: l10n.t('Connect'), signIn: false };
    case 'failed':
      return { label: l10n.t('Retry'), signIn: false };
    case 'connected':
    case 'pending':
      return { label: l10n.t('Disconnect'), signIn: false };
    case 'needs_auth':
      return server.canSignIn ? { label: l10n.t('Sign in'), signIn: true } : undefined;
  }
}

/**
 * One MCP server: its mark, name and state in words, the ONE button of its state, the first line
 * of its error (one line, cut with an ellipsis by CSS, the whole line in `title`) with "Show
 * details" for the whole error, the sign-in in progress when it is this server's, and its
 * resources folded under their count.
 *
 * The button is one element whose label changes with the state, so the focus it holds survives
 * Connect becoming Disconnect. While a request of this row is out it is `aria-disabled` and
 * `aria-busy`, never `disabled` (the focus would fall to the body: `solid-webview` section 7). The
 * busy mark is DERIVED, not stored: it holds while neither the status of the server nor its count
 * of notices (`seq`, bumped by `SettingsApp` for each notice that names the server) changed since
 * the click, so a request the host refuses or that ends in the same state still clears it. The
 * one status change that does NOT clear it is the step to `pending` from another state: the host
 * is still inside its call (it refuses a second change of the server), so the row stays busy
 * until the final notice or a final status. HYPOTHESIS for a slow remote server: the window is
 * the whole handshake, not measured; the test "stays busy while the server is pending" of
 * `McpSection.test.tsx` covers the logic with a synthetic state. A
 * sign-in also waits while any other sign-in runs (`state.attempt`), like the Providers cards.
 * The card keeps `data-server` and `tabindex="-1"`, which the search, "Needs attention" and the
 * jump focus use.
 */
function McpRow(props: {
  server: SettingsMcpServerRow;
  state: SettingsStoreState;
  send: SendSettings;
  seq: Record<string, number>;
}) {
  const titleId = createUniqueId();
  const [asked, setAsked] = createSignal<{ status: string; seq: number } | undefined>(undefined);
  const seqNow = (): number => props.seq[props.server.name] ?? 0;
  const busy = (): boolean => {
    const mark = asked();
    if (mark === undefined || mark.seq !== seqNow()) return false;
    const status = props.server.status;
    return status === mark.status || (status === 'pending' && mark.status !== 'pending');
  };
  const action = () => actionOf(props.server);
  const attempt = () => {
    const id = props.server.integrationID;
    return id !== undefined && props.state.attempt?.integrationID === id
      ? props.state.attempt
      : undefined;
  };
  const waiting = (): boolean =>
    busy() || (action()?.signIn === true && props.state.attempt !== undefined);

  const press = (): void => {
    const current = action();
    if (current === undefined || waiting()) return;
    setAsked({ status: props.server.status, seq: seqNow() });
    if (current.signIn) {
      props.send({ type: 'settings.mcpSignIn', server: props.server.name });
    } else {
      props.send({
        type: 'settings.mcp',
        server: props.server.name,
        op:
          props.server.status === 'disabled' || props.server.status === 'failed'
            ? 'connect'
            : 'disconnect',
      });
    }
  };

  return (
    <li
      class="setup-step settings-card"
      data-status={STATUS_TONE[props.server.status]}
      data-server={props.server.name}
      tabindex="-1"
    >
      <span class="step-mark settings-mark">
        <Show when={props.server.status === 'connected'}>
          <CheckIcon />
        </Show>
        <Show when={props.server.status === 'failed'}>
          <CrossIcon />
        </Show>
        <Show when={props.server.status === 'disabled'}>
          <WaitingIcon />
        </Show>
        <Show when={props.server.status === 'needs_auth'}>
          <WarningIcon />
        </Show>
        <Show when={props.server.status === 'pending'}>
          <span class="spinner" aria-hidden="true" />
        </Show>
      </span>
      <div class="step-body">
        <div class="settings-mcp-head">
          <p class="step-title" id={titleId}>
            {props.server.name}
            <span class="step-status">{` — ${statusWord(props.server.status)}`}</span>
          </p>
          <Show when={action() !== undefined}>
            <button
              type="button"
              class="secondary settings-mcp-action"
              aria-describedby={titleId}
              aria-disabled={waiting() ? 'true' : undefined}
              aria-busy={busy() ? 'true' : undefined}
              onClick={press}
            >
              {action()?.label}
            </button>
          </Show>
        </div>
        <Show when={props.server.error}>
          {(error) => (
            <p class="step-line settings-error" title={error()}>
              {error()}
            </p>
          )}
        </Show>
        <Show when={props.server.detail}>
          {(detail) => (
            <details class="settings-details">
              <summary>{l10n.t('Show details')}</summary>
              <p class="settings-detail-text">{detail()}</p>
            </details>
          )}
        </Show>
        <Show when={props.server.status === 'needs_auth' && !props.server.canSignIn}>
          <p class="step-line">
            {l10n.t('Run opencode mcp auth {0} in a terminal.', props.server.name)}
          </p>
        </Show>
        <Show when={attempt()}>
          {(current) => (
            <div class="settings-attempt" data-phase={current().phase}>
              <Show when={current().phase === 'starting'}>
                <p class="step-line">{l10n.t('Starting sign-in…')}</p>
              </Show>
              <Show when={current().phase === 'waiting'}>
                <p class="step-line">
                  {current().instructions ?? l10n.t('Waiting for the browser…')}
                </p>
                <Show
                  when={
                    current().code !== undefined &&
                    !(current().instructions ?? '').includes(current().code ?? '')
                  }
                >
                  <p class="step-line">
                    {formatParts(l10n.t('Code: {code}'), {
                      code: <code class="settings-code">{current().code}</code>,
                    })}
                  </p>
                </Show>
              </Show>
              <Show when={current().phase === 'finishing'}>
                <p class="step-line">{l10n.t('Finishing the sign-in…')}</p>
              </Show>
              <div class="step-actions">
                <button
                  type="button"
                  class="secondary"
                  aria-disabled={current().phase === 'finishing' ? 'true' : undefined}
                  onClick={() => {
                    if (current().phase === 'finishing') return;
                    props.send({ type: 'settings.cancel', integrationID: current().integrationID });
                  }}
                >
                  {l10n.t('Cancel')}
                </button>
              </div>
            </div>
          )}
        </Show>
        <Show when={countsText(props.server) !== ''}>
          <details class="settings-details">
            <summary>{countsText(props.server)}</summary>
            <Show when={props.server.resources.length > 0}>
              <ul
                class="settings-resources"
                aria-label={l10n.t('Resources of {0}', props.server.name)}
              >
                <For each={props.server.resources}>
                  {(resource) => (
                    <li title={resource.description}>
                      <span class="settings-res-name">{resource.name}</span>
                      <span class="step-status">{` ${resource.mimeType ?? resource.uri}`}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={props.server.templates.length > 0}>
              <ul
                class="settings-resources"
                aria-label={l10n.t('Templates of {0}', props.server.name)}
              >
                <For each={props.server.templates}>
                  {(template) => (
                    <li title={template.description}>
                      <span class="settings-res-name">{template.name}</span>
                      <span class="step-status">{` ${template.uriTemplate}`}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </details>
        </Show>
      </div>
    </li>
  );
}

/**
 * The MCP servers section (issue #128, E10; actions since issue #186, PR2): one card per server
 * with its state in words and a mark, ONE button that connects, retries, disconnects or signs in,
 * its error in a single line with "Show details", and its resources and templates folded under
 * their count. One note for the whole section (not one per row) says that Connect and Disconnect
 * last until opencode restarts and where to change it for good. The tab only asks: the host
 * revalidates every request against its own state ({@link McpRow}), and a refused or failed one
 * comes back as a notice.
 *
 * An empty list is NOT "no servers" until the host says the first read is over
 * (`pendingFirstRead` false): v2 answers `[]` for a while after the start and fills the list with
 * the first `mcp.status.changed` (planner spike, 01/11/2026, opencode 2.0.32). All texts of the
 * server (names, errors, URIs) are rendered as text. `seq` counts the notices per server name (see
 * {@link McpRow}); a test that mounts the section alone may leave it out.
 *
 * VERIFIED in jsdom by `McpSection.test.tsx` (fabricated rows): the button of each state, one
 * button that keeps the focus when its label changes, `aria-disabled` and `aria-busy` that clear
 * on a new state or notice, the `opencode mcp auth` line without `canSignIn`, the error line with
 * its `title` and its details folded (that it is ONE line is CSS and is not measured in jsdom), folded resources, the sign-in in progress with Cancel, texts as text, and the
 * section note.
 *
 * VERIFIED in VS Code 1.145.2 on Windows 11 (10/11/2026, `npm run test:visual -- --steps 35,52`,
 * twice, against the synthetic server): the look of the row in 3 widths and 4 themes by "L1 660 px
 * (tab 660), dark: docs connected [Disconnect] with its resources folded under "2 resources · 1
 * template", broken failed [Retry] with its error in 1 line (200 chars, cut with an ellipsis true)"
 * (the same line for 1080 and 300 px and for light, hc-dark and hc-light, ending in a contrast over
 * 16 texts of at least 4.5); the whole error under "Show details" by "L2 300 px, dark: "Show details"
 * of broken opens the whole error (405 chars in 17 lines, with the second and third stderr lines)
 * inside the card"; the unfolded resources by "L3 300 px, dark: the summary of docs unfolds its two
 * resources and its template"; the busy mark by "F1 Disconnect of docs: its row goes to disabled
 * with [Connect] and no resources, the busy mark showed while it waited (true)"; the sign-in by "F3
 * Sign in of linear: the attempt showed in its row with [Cancel] (true)"; and that the one button
 * keeps the focus by "F4 after each action the focus is on the button of its row". The focus of a
 * card through its `data-server` (the jump of "Needs attention" and the search) was VERIFIED on the
 * read-only card (the full `npm run test:visual` of 08/11/2026, "ok   G1 the item opens MCP servers
 * and focuses the card of "linear""); HYPOTHESIS that it still holds, since the attribute and the
 * `tabindex` are unchanged: step 47 was not run on this tree. NOT observed: the "Reading the MCP
 * servers…" and "No MCP servers are configured." lines in a real VS Code (jsdom only), the row of
 * a server that needs sign-in without an integration (`opencode mcp auth` hint; the fake has none),
 * macOS and Linux.
 */
export function McpSection(props: {
  state: SettingsStoreState;
  send: SendSettings;
  seq?: Record<string, number>;
}) {
  const none: Record<string, number> = {};
  return (
    <div class="settings-mcp">
      <Show when={props.state.mcp.servers.length === 0}>
        <p class="settings-empty" role="status">
          <Show
            when={props.state.mcp.failed}
            fallback={
              <Show
                when={props.state.mcp.loaded && !props.state.mcp.pendingFirstRead}
                fallback={
                  <>
                    <span class="spinner" aria-hidden="true" />
                    {` ${l10n.t('Reading the MCP servers…')}`}
                  </>
                }
              >
                {l10n.t('No MCP servers are configured.')}
              </Show>
            }
          >
            {l10n.t('Could not read the MCP servers from the server. Try Refresh.')}
          </Show>
        </p>
      </Show>
      <Show when={props.state.mcp.servers.length > 0}>
        <ul class="setup-steps" role="list">
          <For each={props.state.mcp.servers}>
            {(server) => (
              <McpRow
                server={server}
                state={props.state}
                send={props.send}
                seq={props.seq ?? none}
              />
            )}
          </For>
        </ul>
      </Show>
      <p class="settings-hint">
        {l10n.t(
          'Connect and Disconnect last until opencode restarts. To change it for good, edit mcp.servers in opencode.json.',
        )}
      </p>
    </div>
  );
}
