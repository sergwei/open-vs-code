// Protects the error card (E2, issue #85): role by kind, title as a heading, the cause as plain
// text (never markup) and each button sending its message. Provenance: FABRICATED problem views in
// jsdom; layout and contrast are measured by `test:visual`, not here.
import { afterEach, describe, expect, it } from 'vitest';
import { must, mount, type Mounted } from '../testing';
import { ConnectionCard } from './ConnectionCard';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

describe('ConnectionCard', () => {
  it('renders the cause as text, not HTML, and sends the action messages', () => {
    mounted = mount(() => (
      <ConnectionCard
        problem={{
          title: 'opencode could not start',
          cause: '<img src=x onerror=alert(1)>',
          role: 'alert',
          actions: [
            { label: 'Restart', message: { type: 'server.restart' } },
            { label: 'Show logs', message: { type: 'logs.show' } },
          ],
        }}
      />
    ));
    expect(must(mounted.container, 'h3').textContent).toBe('opencode could not start');
    expect(mounted.container.querySelector('img')).toBeNull();
    expect(must(mounted.container, '.card-cause').textContent).toBe('<img src=x onerror=alert(1)>');
    for (const button of mounted.container.querySelectorAll('button')) button.click();
    expect(mounted.sent).toEqual([{ type: 'server.restart' }, { type: 'logs.show' }]);
    expect(mounted.container.contains(document.activeElement)).toBe(false);
  });

  it('uses role status and no warning icon for a neutral card', () => {
    mounted = mount(() => (
      <ConnectionCard problem={{ title: 'Reconnecting', role: 'status', actions: [] }} />
    ));
    expect(must(mounted.container, '.connection-card').getAttribute('role')).toBe('status');
    expect(mounted.container.querySelector('svg')).toBeNull();
  });
});
