// Protects the chips that open files (issues #28/#29): a `file:` URL becomes a button that sends
// `editor.open` WITHOUT its query and with the first line of its range; anything else stays plain
// text, so a `data:` attachment never tries to open. The accessible name says the range in words.
//
// Provenance: fabricated URLs in jsdom; the shape `file:///…?start=16&end=18` is what the planner's
// spike saw a real opencode 2.0.32 keep in `source.uri` (Windows 11, 22/10/2026). Opening a real
// editor is `test:visual` step 16.
import { afterEach, describe, expect, it } from 'vitest';
import { must, mount, type Mounted } from '../testing';
import { AttachmentOpenButton } from './AttachmentOpenButton';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

describe('AttachmentOpenButton', () => {
  it('sends editor.open with the URL without its query and the start line', () => {
    mounted = mount(() => (
      <AttachmentOpenButton name="src/a.ts#5-9" uri="file:///C:/ws/src/a.ts?start=5&end=9" />
    ));
    const button = must<HTMLButtonElement>(mounted.container, 'button');
    expect(button.getAttribute('aria-label')).toBe('Open src/a.ts, lines 5-9');
    expect(button.title).toBe('src/a.ts#5-9');
    button.click();
    expect(mounted.sent).toEqual([
      { type: 'editor.open', path: 'file:///C:/ws/src/a.ts', line: 5 },
    ]);
  });

  it('is plain text, not a button, without a file URL', () => {
    mounted = mount(() => (
      <AttachmentOpenButton name="data.txt" uri="data:text/plain;base64,AAAA" />
    ));
    expect(mounted.container.querySelector('button')).toBeNull();
    expect(mounted.container.textContent).toBe('data.txt');
  });

  it('is plain text when the attachment has no URL at all', () => {
    mounted = mount(() => <AttachmentOpenButton name="text/plain" />);
    expect(mounted.container.querySelector('button')).toBeNull();
  });
});
