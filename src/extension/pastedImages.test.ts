// Protects the host's own look at a pasted image (issue #30): the type comes from the bytes, never
// from what the webview declared. The headers are hand-made (a few magic bytes), not real images.

import { describe, expect, it } from 'vitest';
import { detectImageMime, PastedImageError, PastedImages } from './pastedImages';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = Buffer.from('GIF89a....');
const WEBP = Buffer.from('RIFF....WEBPVP8 ');
const BMP = Buffer.from('BM......');

describe('detectImageMime', () => {
  it('recognises the four types by their signatures', () => {
    expect([PNG, JPEG, GIF, WEBP].map(detectImageMime)).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ]);
  });

  it('refuses bmp, text and empty input', () => {
    expect([BMP, Buffer.from('hello'), Buffer.alloc(0)].map(detectImageMime)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('PastedImages', () => {
  it('keeps an image under an opaque uri and numbers the names', () => {
    const store = new PastedImages();
    const first = store.add('image/png', PNG.toString('base64'));
    const second = store.add('image/jpeg', JPEG.toString('base64'));
    expect(first).toEqual({ uri: 'pasted-image:1', name: 'Pasted image 1' });
    expect(second.name).toBe('Pasted image 2');
    expect(store.dataUrlFor(first.uri)).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });

  it('refuses a declared type that the bytes contradict', () => {
    expect(() => new PastedImages().add('image/png', JPEG.toString('base64'))).toThrow(
      PastedImageError,
    );
  });

  it('refuses non-canonical base64 and non-image bytes', () => {
    const store = new PastedImages();
    expect(() => store.add('image/png', `${PNG.toString('base64')}!`)).toThrow('could not be read');
    expect(() => store.add('image/png', BMP.toString('base64'))).toThrow('Only PNG');
  });

  it('forgets the oldest past the cap and forgets on request', () => {
    const store = new PastedImages();
    const refs = Array.from({ length: 21 }, () => store.add('image/png', PNG.toString('base64')));
    expect(store.has(refs[0]?.uri ?? '')).toBe(false);
    expect(store.has(refs[20]?.uri ?? '')).toBe(true);
    store.forget(refs[20]?.uri ?? '');
    expect(store.has(refs[20]?.uri ?? '')).toBe(false);
  });
});
