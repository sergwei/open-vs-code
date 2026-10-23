// Protects `readImage` (issue #30): type and size are refused before reading, and the base64 has
// no `data:` prefix. Small `File`s built in jsdom, not clipboard data from a real VS Code.
import { describe, expect, it } from 'vitest';
import { readImage } from './imageFile';

describe('readImage', () => {
  it('reads a small PNG as base64 without the data: prefix', async () => {
    const file = new File([new Uint8Array([0x89, 0x50])], 'a.png', { type: 'image/png' });
    expect(await readImage(file)).toEqual({ ok: true, mime: 'image/png', data: 'iVA=' });
  });

  it('refuses a type outside the four the model receives', async () => {
    const result = await readImage(new File(['x'], 'a.bmp', { type: 'image/bmp' }));
    expect(result).toEqual({
      ok: false,
      message: 'Only PNG, JPEG, GIF and WebP images can be attached',
    });
  });

  // Review of 23/10/2026 (B1): an empty file gave `data: ''`, which the host validator drops without
  // any `request.result`, locking Send. Probed in jsdom: readAsDataURL of it is "data:image/png;base64,".
  it('refuses an empty file instead of producing an empty payload', async () => {
    const result = await readImage(new File([], 'x.png', { type: 'image/png' }));
    expect(result).toEqual({ ok: false, message: 'That image could not be read' });
  });

  it('refuses more than 10 MiB without reading it', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect(await readImage(big)).toEqual({
      ok: false,
      message: 'That image is larger than 10 MiB',
    });
  });
});
