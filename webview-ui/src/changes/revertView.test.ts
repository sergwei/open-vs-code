// Protects the rule that decides what the conversation shows while a revert is prepared (issue
// #32): the boundary message and everything after it are hidden by POSITION, the count is of USER
// messages, a boundary that is not among the loaded messages hides NOTHING (a guess would show a
// conversation the model will not see), and the words of the block are single strings.
// Provenance: FABRICATED messages in the shape of the protocol; no host, no DOM.
import { describe, expect, it } from 'vitest';
import type { ChangedFile, MessageInfo } from '../../../src/shared/model';
import { revertFilesCaption, revertOpenName, revertTitle, splitAtRevert } from './revertView';

const user = (id: string): MessageInfo => ({ kind: 'user', id, createdAt: 1, text: id, files: [] });
const assistant = (id: string): MessageInfo => ({
  kind: 'assistant',
  id,
  createdAt: 2,
  agent: 'build',
  model: { providerID: 'opencode', id: 'big-pickle' },
});
const notice = (id: string): MessageInfo => ({ kind: 'notice', id, createdAt: 3, text: 'n' });

const history = [
  user('u1'),
  assistant('a1'),
  user('u2'),
  assistant('a2'),
  notice('n1'),
  user('u3'),
];
const ids = (messages: readonly MessageInfo[]) => messages.map((message) => message.id);

describe('splitAtRevert', () => {
  it('hides the boundary and everything after it, and counts the user messages hidden', () => {
    const split = splitAtRevert(history, { messageID: 'u2', files: [] });
    expect(ids(split.visible)).toEqual(['u1', 'a1']);
    expect(split).toMatchObject({ revertedCount: 2, found: true });
  });

  it('hides everything when the boundary is the first message', () => {
    const split = splitAtRevert(history, { messageID: 'u1', files: [] });
    expect(split.visible).toEqual([]);
    expect(split.revertedCount).toBe(3);
  });

  it('hides only the last user message when the boundary is the last one', () => {
    const split = splitAtRevert(history, { messageID: 'u3', files: [] });
    expect(ids(split.visible)).toEqual(['u1', 'a1', 'u2', 'a2', 'n1']);
    expect(split.revertedCount).toBe(1);
  });

  it('hides nothing, and says it did not find the boundary, when it is not loaded', () => {
    const split = splitAtRevert(history, { messageID: 'u0', files: [] });
    expect(split.visible).toBe(history);
    expect(split).toMatchObject({ revertedCount: 0, found: false });
  });

  it('returns the very same list when there is no revert (no copy per streamed token)', () => {
    const split = splitAtRevert(history, undefined);
    expect(split.visible).toBe(history);
    expect(split).toMatchObject({ revertedCount: 0, found: false });
  });
});

describe('the words of the revert block', () => {
  it('writes the title for one, many and unknown reverted messages', () => {
    expect(revertTitle({ revertedCount: 1, found: true })).toBe('1 message reverted');
    expect(revertTitle({ revertedCount: 3, found: true })).toBe('3 messages reverted');
    expect(revertTitle({ revertedCount: 0, found: false })).toBe('Reverted messages');
  });

  it('writes the caption of the files', () => {
    expect(revertFilesCaption(1)).toBe('1 file changed on disk');
    expect(revertFilesCaption(4)).toBe('4 files changed on disk');
  });

  it('builds the accessible name of a row as one sentence', () => {
    const file: ChangedFile = {
      path: 'src/a.ts',
      status: 'modified',
      additions: 3,
      deletions: 1,
      binary: false,
      tooLarge: false,
    };
    expect(revertOpenName(file)).toBe(
      'Show what the revert undid in src/a.ts, Modified, 3 added, 1 deleted',
    );
    expect(revertOpenName({ ...file, path: 'logo.png', binary: true })).toBe(
      'Open logo.png, Binary',
    );
    expect(revertOpenName({ ...file, path: 'big.txt', tooLarge: true })).toBe(
      'Open big.txt, Too large to diff',
    );
  });
});
