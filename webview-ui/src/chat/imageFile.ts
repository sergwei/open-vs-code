// Reads a pasted or dropped image into the base64 the host expects (issue #30).

import { IMAGE_MIMES, MAX_IMAGE_BYTES } from '../../../src/shared/protocol';

/** Outcome of {@link readImage}: the base64 payload, or the sentence to show the user. */
export type ImageRead = { ok: true; mime: string; data: string } | { ok: false; message: string };

/**
 * Checks `file` (type, then size, so a huge refused file is never read) and reads it as base64.
 * The type here is only the browser's claim; the host detects it again from the bytes. Uses
 * `FileReader.readAsDataURL` and cuts the `data:...;base64,` prefix, to avoid building a giant
 * binary string for `btoa`. The messages are the user-facing ones of the local warnings. An empty
 * file is refused here ("could not be read"): the host validator rejects an empty `data`, and a
 * message it drops never gets a `request.result`, which would leave Send locked (review of
 * 23/10/2026, B1).
 * VERIFIED in jsdom 30 on Windows 11 (23/10/2026) by the checks of `imageFile.test.ts` (a `File`
 * is read to base64 and an empty one is refused). NOT observed in Chromium: the real paste of
 * `test:visual` covers it.
 */
export function readImage(file: File): Promise<ImageRead> {
  if (!IMAGE_MIMES.includes(file.type)) {
    return Promise.resolve({
      ok: false,
      message: 'Only PNG, JPEG, GIF and WebP images can be attached',
    });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.resolve({ ok: false, message: 'That image is larger than 10 MiB' });
  }
  if (file.size === 0) {
    return Promise.resolve({ ok: false, message: 'That image could not be read' });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(
        comma < 0
          ? { ok: false, message: 'That image could not be read' }
          : { ok: true, mime: file.type, data: result.slice(comma + 1) },
      );
    };
    reader.onerror = () => {
      resolve({ ok: false, message: 'That image could not be read' });
    };
    reader.readAsDataURL(file);
  });
}
