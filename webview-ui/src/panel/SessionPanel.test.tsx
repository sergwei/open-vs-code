// Protects the Session tab (issue #188, phase 4): the five sections (Instructions, Context, Usage,
// Subagents, Export), what each action hands to its callback, the disabled states (always
// `aria-disabled`, so the focus stays), the `<meter>` attributes with the 80 % `high` mark, and the
// focus after an instruction is removed (next row, else the box; only when the focus was lost and
// the document has it).
//
// Provenance: a real `createChatStore` and the real subagent monitor, driven with FABRICATED host
// messages in jsdom (`hasFocus` stubbed). They confirm the wiring and the rules, not the look of the
// meter in the four themes or the narrow layout (`test:visual`, phase 5), and not the host contract.
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, MessageInfo, ModelOption, SessionSummary } from '../../../src/shared/model';
import type { ExportFormat, HostToWebview } from '../../../src/shared/protocol';
import { createChatStore, type ChatStore } from '../store/chatStore';
import { createSubagentMonitor, SubagentProvider } from '../subagents/SubagentContext';
import { mount, must, type Mounted } from '../testing';
import { SessionPanel } from './SessionPanel';

const SES = 'ses_1';
const MODEL = { providerID: 'opencode', id: 'big-pickle' };
const option: ModelOption = {
  ...MODEL,
  name: 'Big Pickle',
  status: 'active',
  contextLimit: 200_000,
  free: true,
  variants: [],
  images: true,
};
const catalog: Catalog = { models: [option], providers: [], agents: [] };

const userMessage = (id: string): MessageInfo => ({
  kind: 'user',
  id,
  createdAt: 1,
  text: 'hi',
  files: [],
});
const reply = (id: string, total: number): MessageInfo => ({
  kind: 'assistant',
  id,
  createdAt: 2,
  agent: 'build',
  model: MODEL,
  tokens: { input: total, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
});

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
  vi.restoreAllMocks();
});

interface Options {
  messages?: MessageInfo[];
  sessions?: SessionSummary[];
  withCatalog?: boolean;
  noSession?: boolean;
  instructionsBusy?: boolean;
  exporting?: boolean;
  compactDisabled?: boolean;
  instructions?: Array<{ key: string; text: string; json: boolean }>;
}

/** Mounts the panel over a store opened on `SES` (or with no session), with spies for the actions. */
function setup(options: Options = {}) {
  const store: ChatStore = createRoot(() => createChatStore());
  const calls = {
    add: vi.fn<(text: string) => boolean>(() => true),
    remove: vi.fn<(key: string) => void>(),
    compact: vi.fn(),
    exportAs: vi.fn<(format: ExportFormat) => void>(),
    openChild: vi.fn<(id: string) => void>(),
  };
  const apply = (...messages: HostToWebview[]): void => {
    for (const message of messages) store.apply(message);
  };
  apply({ type: 'connection.state', connection: { state: 'connected', serverVersion: '2.2.7' } });
  if (options.withCatalog !== false) apply({ type: 'catalog', catalog });
  apply({
    type: 'snapshot',
    snapshot: {
      sessions: options.sessions ?? [
        { id: SES, title: 'Fix the build', createdAt: 1, updatedAt: 2 },
      ],
      statuses: {},
      ...(options.noSession === true
        ? {}
        : {
            open: {
              sessionID: SES,
              messages: options.messages ?? [],
              parts: {},
              ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
            },
          }),
      requests: { permissions: [], forms: [] },
      resolutions: [],
    },
  });
  const monitor = createRoot(() =>
    createSubagentMonitor(store, {
      open: (id) => {
        calls.openChild(id);
      },
      stop: () => undefined,
    }),
  );
  const [instructionsBusy, exporting, compactDisabled] = [
    options.instructionsBusy === true,
    options.exporting === true,
    options.compactDisabled === true,
  ];
  mounted = mount(() => (
    <SubagentProvider value={monitor}>
      <SessionPanel
        store={store}
        instructionsBusy={instructionsBusy}
        exporting={exporting}
        compactDisabled={compactDisabled}
        onAddInstruction={calls.add}
        onRemoveInstruction={calls.remove}
        onCompact={calls.compact}
        onExport={calls.exportAs}
      />
    </SubagentProvider>
  ));
  const root = mounted.container;
  const buttonByName = (name: string): HTMLButtonElement => {
    const found = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === name || button.getAttribute('aria-label') === name,
    );
    if (found === undefined) throw new Error(`no button named ${name}`);
    return found;
  };
  return { store, apply, calls, root, buttonByName };
}

const type = (root: HTMLElement, text: string): HTMLInputElement => {
  const field = must<HTMLInputElement>(root, 'input.instruction-input');
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return field;
};

describe('SessionPanel: no open session', () => {
  it('disables the box, Add and Export with a line that says why, and sends nothing', () => {
    const { root, calls, buttonByName } = setup({ noSession: true });
    const field = must<HTMLInputElement>(root, 'input.instruction-input');
    expect(field.getAttribute('aria-disabled')).toBe('true');
    expect(field.readOnly).toBe(true);
    expect(root.textContent).toContain('Send a first message to pin instructions');
    expect(root.textContent).toContain('Send a first message to export the session');
    for (const name of ['Add', 'Markdown', 'JSON']) {
      const button = buttonByName(name);
      expect(button.getAttribute('aria-disabled'), name).toBe('true');
      expect(button.disabled, name).toBe(false);
      button.click();
    }
    expect(calls.add).not.toHaveBeenCalled();
    expect(calls.exportAs).not.toHaveBeenCalled();
    expect(root.querySelector('meter')).toBeNull();
  });
});

describe('SessionPanel: instructions', () => {
  // A function, not a constant: the store adopts the arrays it is handed and `reconcile` rewrites
  // them in place, so every message gets its own copy (a host message is a structured clone anyway).
  const entries = () => [
    { key: 'note-a', text: 'Always answer in Spanish', json: false },
    { key: 'note-b', text: '{"tone":"short"}', json: true },
  ];

  it('lists the pinned instructions, tags the ones another client set as JSON, and says none', () => {
    const none = setup();
    expect(none.root.textContent).toContain('No pinned instructions');
    mounted?.dispose();
    const { root } = setup({ instructions: entries() });
    const rows = [...root.querySelectorAll('.instruction-row')];
    expect(rows.map((row) => row.querySelector('.instruction-text')?.textContent)).toEqual([
      'Always answer in Spanish',
      '{"tone":"short"}',
    ]);
    expect(rows[0]?.querySelector('.instruction-tag')).toBeNull();
    expect(rows[1]?.querySelector('.instruction-tag')?.textContent).toBe('set by another client');
    // Remove only, never an edit control.
    expect(rows[1]?.querySelectorAll('button')).toHaveLength(1);
  });

  it('names each remove button after its text and hands the exact key over', () => {
    const { buttonByName, calls } = setup({ instructions: entries() });
    buttonByName('Remove instruction Always answer in Spanish').click();
    expect(calls.remove).toHaveBeenCalledWith('note-a');
    buttonByName('Remove instruction {"tone":"short"}').click();
    expect(calls.remove).toHaveBeenLastCalledWith('note-b');
  });

  it('cuts a long text in the accessible name of its remove button', () => {
    const long = 'x'.repeat(100);
    const { root } = setup({ instructions: [{ key: 'note-c', text: long, json: false }] });
    const name = must(root, '.instruction-row button').getAttribute('aria-label');
    expect(name).toBe(`Remove instruction ${'x'.repeat(40)}…`);
  });

  it('adds the trimmed text with Add and with Enter, empties the box and keeps it focused', () => {
    const { root, calls, buttonByName } = setup();
    type(root, '  be brief  ');
    buttonByName('Add').click();
    expect(calls.add).toHaveBeenLastCalledWith('be brief');
    const field = must<HTMLInputElement>(root, 'input.instruction-input');
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    type(root, 'second');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls.add).toHaveBeenLastCalledWith('second');
    expect(calls.add).toHaveBeenCalledTimes(2);
  });

  it('keeps the text when the app did not send it, and adds nothing blank or while busy', () => {
    const refused = setup();
    refused.calls.add.mockReturnValue(false);
    type(refused.root, 'kept');
    refused.buttonByName('Add').click();
    expect(must<HTMLInputElement>(refused.root, 'input.instruction-input').value).toBe('kept');
    mounted?.dispose();
    const blank = setup();
    type(blank.root, '   ');
    expect(blank.buttonByName('Add').getAttribute('aria-disabled')).toBe('true');
    blank.buttonByName('Add').click();
    expect(blank.calls.add).not.toHaveBeenCalled();
    mounted?.dispose();
    const busy = setup({ instructionsBusy: true });
    type(busy.root, 'later');
    busy.buttonByName('Add').click();
    expect(busy.calls.add).not.toHaveBeenCalled();
  });

  it('limits the box to the length the host accepts', () => {
    const { root } = setup();
    expect(must<HTMLInputElement>(root, 'input.instruction-input').maxLength).toBe(4000);
  });

  it('says the list could not be read, keeping the last rows', () => {
    const { root, apply } = setup({ instructions: entries() });
    apply({
      type: 'session.instructions',
      sessionID: SES,
      entries: entries(),
      error: { code: 'Boom', message: 'it broke' },
    });
    expect(must(root, '.session-error').textContent).toBe(
      'Could not read the instructions: it broke',
    );
    expect(root.querySelectorAll('.instruction-row')).toHaveLength(2);
  });

  // Protects the focus after removing a row: the removed row's button had it (so activeElement fell
  // to body), the document has the focus, and the new list lacks that key. FABRICATED list changes.
  it('moves the focus to the row now in its place, else to the box, only when it was lost', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { root, apply, buttonByName } = setup({ instructions: entries() });
    const first = must(root, '.instruction-row button');
    first.focus();
    first.click();
    apply({ type: 'session.instructions', sessionID: SES, entries: entries().slice(1) });
    expect(document.activeElement).toBe(must(root, '.instruction-row button'));
    const last = must(root, '.instruction-row button');
    last.focus();
    last.click();
    apply({ type: 'session.instructions', sessionID: SES, entries: [] });
    expect(document.activeElement).toBe(must(root, 'input.instruction-input'));

    // Document without the focus: nothing moves.
    apply({ type: 'session.instructions', sessionID: SES, entries: entries() });
    (document.activeElement as HTMLElement | null)?.blur();
    hasFocus.mockReturnValue(false);
    buttonByName('Remove instruction Always answer in Spanish').click();
    apply({ type: 'session.instructions', sessionID: SES, entries: entries().slice(1) });
    expect(document.activeElement).toBe(document.body);
  });
});

describe('SessionPanel: context, usage and export', () => {
  const heavy = (percent: number): MessageInfo[] => [
    userMessage('u1'),
    reply('a1', (percent * 200_000) / 100),
  ];

  it('draws a native meter with the limit and the high mark, and the exact words', () => {
    const { root } = setup({ messages: heavy(86) });
    const meter = must<HTMLMeterElement>(root, 'meter');
    expect(meter.min).toBe(0);
    expect(meter.max).toBe(200_000);
    expect(meter.value).toBe(172_000);
    expect(meter.high).toBe(160_000);
    expect(meter.getAttribute('aria-label')).toBe('Context used');
    expect(meter.hasAttribute('style')).toBe(false);
    expect(must(root, '.context-box').getAttribute('data-level')).toBe('high');
    expect(must(root, '.context-text').textContent).toBe(
      'Context: 172,000 tokens of 200,000 (86%).',
    );
  });

  it('keeps the normal level below 80 percent', () => {
    const { root } = setup({ messages: heavy(40) });
    expect(must(root, '.context-box').getAttribute('data-level')).toBe('normal');
  });

  it('has no meter without the limit of the model, only the token count', () => {
    const { root } = setup({ messages: heavy(40), withCatalog: false });
    expect(root.querySelector('meter')).toBeNull();
    expect(must(root, '.context-text').textContent).toBe('Context: 80,000 tokens.');
  });

  it('says nothing was measured before the first answer', () => {
    const { root } = setup({ messages: [userMessage('u1')] });
    expect(root.querySelector('meter')).toBeNull();
    expect(root.textContent).toContain('No context measured yet');
  });

  it('runs Compact, and not while it is disabled', () => {
    const enabled = setup({ messages: heavy(86) });
    enabled.buttonByName('Compact').click();
    expect(enabled.calls.compact).toHaveBeenCalledTimes(1);
    mounted?.dispose();
    const disabled = setup({ messages: heavy(86), compactDisabled: true });
    const button = disabled.buttonByName('Compact');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    button.click();
    expect(disabled.calls.compact).not.toHaveBeenCalled();
  });

  it('shows the session totals, the cost with subagents and the turns', () => {
    const { root } = setup({
      messages: [userMessage('u1'), reply('a1', 100), userMessage('u2')],
      sessions: [
        {
          id: SES,
          createdAt: 1,
          updatedAt: 2,
          usage: {
            cost: 0.25,
            tokens: { input: 1000, output: 400, reasoning: 100, cacheRead: 2000, cacheWrite: 0 },
          },
        },
        {
          id: 'ses_k',
          parentID: SES,
          createdAt: 3,
          updatedAt: 4,
          usage: {
            cost: 0.25,
            tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          },
        },
      ],
    });
    const grid = [...root.querySelectorAll('.usage-grid > *')].map((node) => node.textContent);
    expect(grid).toEqual([
      'Input tokens',
      '3K',
      'Output tokens',
      '500',
      'Cost with subagents',
      '$0.50',
      'Turns',
      '2',
    ]);
    expect(root.textContent).not.toContain('most recent messages');
  });

  it('says no usage is recorded when the row has none', () => {
    const { root } = setup();
    expect(root.textContent).toContain('No usage recorded yet');
  });

  it('exports in the chosen format, and not while an export is in flight', () => {
    const idle = setup();
    idle.buttonByName('Markdown').click();
    idle.buttonByName('JSON').click();
    expect(idle.calls.exportAs.mock.calls).toEqual([['markdown'], ['json']]);
    expect(idle.root.textContent).toContain(
      'The JSON file holds the full text of the conversation and the file paths.',
    );
    mounted?.dispose();
    const busy = setup({ exporting: true });
    busy.buttonByName('Markdown').click();
    expect(busy.calls.exportAs).not.toHaveBeenCalled();
    expect(busy.buttonByName('JSON').getAttribute('aria-disabled')).toBe('true');
    expect(busy.root.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('SessionPanel: subagents', () => {
  const rows: SessionSummary[] = [
    { id: SES, title: 'Fix the build', createdAt: 1, updatedAt: 2 },
    {
      id: 'ses_k1',
      parentID: SES,
      title: 'Read the docs',
      agent: 'explore',
      createdAt: 3,
      updatedAt: 4,
    },
    {
      id: 'ses_k2',
      parentID: SES,
      title: 'Write tests',
      agent: 'general',
      createdAt: 5,
      updatedAt: 6,
    },
  ];

  it('says there are none', () => {
    const { root } = setup();
    expect(root.textContent).toContain('No subagents in this session');
  });

  it('lists every child with its state in words and an Open button named after its task', () => {
    const { root, apply, buttonByName, calls } = setup({ sessions: rows });
    apply({ type: 'session.status', sessionID: 'ses_k1', status: { type: 'busy' } });
    const lines = [...root.querySelectorAll('.subagent-row')].map(
      (row) =>
        `${row.querySelector('.subagent-agent')?.textContent ?? ''}|${
          row.querySelector('.subagent-task')?.textContent ?? ''
        }|${row.querySelector('.subagent-state')?.textContent ?? ''}`,
    );
    expect(lines).toEqual(['explore|Read the docs|Working', 'general|Write tests|Finished']);
    buttonByName('Open subagent session Write tests').click();
    expect(calls.openChild).toHaveBeenCalledWith('ses_k2');
  });
});
