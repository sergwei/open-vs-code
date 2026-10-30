// Protects the late focus of a chat tab (issue #77, E3, review 1 W3): the reveal that follows the
// `ready` of a tab's document must not pull it in front of a tab the user chose afterwards.
// Provenance: the sequence of calls is the one the host log showed in the full `test:visual` run of
// 29/10/2026 (reveal of A, reveal of B, then A's document ready and a second "chat tab revealed"
// of A); the calls are synthetic, there is no VS Code here.
import { describe, expect, it } from 'vitest';
import { RevealOrder } from './revealOrder';

describe('RevealOrder', () => {
  it('drops the late focus of a tab when another one was revealed after it was queued', () => {
    const order = new RevealOrder();
    order.noteReveal(1);
    order.queueFocus(1);
    order.noteReveal(2);
    order.queueFocus(2);
    expect(order.focusStillWanted(1)).toBe(false);
    expect(order.focusStillWanted(2)).toBe(true);
  });

  it('keeps the focus of the only tab revealed', () => {
    const order = new RevealOrder();
    order.noteReveal(1);
    order.queueFocus(1);
    expect(order.focusStillWanted(1)).toBe(true);
  });

  it('lets a later explicit reveal of the same tab renew its request', () => {
    const order = new RevealOrder();
    order.noteReveal(1);
    order.queueFocus(1);
    order.noteReveal(2);
    order.noteReveal(1); // the user came back to 1: a fresher request than the waiting one
    order.queueFocus(1);
    expect(order.focusStillWanted(1)).toBe(true);
  });

  it('allows a focus nobody queued (a compose or a setup step)', () => {
    const order = new RevealOrder();
    order.noteReveal(2);
    expect(order.focusStillWanted(1)).toBe(true);
  });

  it('does not count a surface that was closed', () => {
    const order = new RevealOrder();
    order.queueFocus(1);
    order.noteReveal(2);
    order.forget(2);
    expect(order.focusStillWanted(1)).toBe(true);
  });
});
