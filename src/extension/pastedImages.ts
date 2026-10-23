// Pasted images (issue #30): detection of the type by bytes and the in-memory store the host keeps
// them in. PURE: no `vscode` import. The webview never receives the bytes back; it holds an opaque
// `pasted-image:<n>` URI and the host swaps it for the `data:` URL when the prompt is sent.

import { IMAGE_MIMES, MAX_IMAGE_BYTES, type AttachmentRef } from '../shared/protocol';

/** URI scheme of an image held by the host. Not `file:` on purpose: nothing can open or read it. */
export const PASTED_IMAGE_SCHEME = 'pasted-image:';

/** Images kept at once; the oldest is forgotten past it. Our choice (decision of the plan, 23/10/2026). */
export const MAX_KEPT_IMAGES = 20;

/**
 * The image type of `bytes` from its magic numbers, or `undefined` when it is not one of
 * {@link IMAGE_MIMES}. The declared type of the webview is never used: the server also ignores the
 * header of a `data:` URL and detects the type from the bytes (`Mime.detect`, `core/src/mime.ts`
 * @v2.0.32, read). Signatures: PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, GIF `GIF87a` or
 * `GIF89a`, WebP `RIFF....WEBP`. bmp and avif are refused because the model would never see them.
 * VERIFIED on Windows 11 (23/10/2026): the check "recognises the four types by their signatures"
 * of `pastedImages.test.ts` passed on hand-made headers (not real files).
 */
export function detectImageMime(bytes: Uint8Array): string | undefined {
  const at = (index: number): number => bytes[index] ?? -1;
  const text = (start: number, value: string): boolean =>
    [...value].every((char, offset) => at(start + offset) === char.charCodeAt(0));
  if (
    at(0) === 0x89 &&
    text(1, 'PNG') &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return 'image/png';
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (text(0, 'GIF87a') || text(0, 'GIF89a')) return 'image/gif';
  if (text(0, 'RIFF') && text(8, 'WEBP')) return 'image/webp';
  return undefined;
}

/** A refusal of {@link PastedImages.add}: `code` is the `ErrorInfo.code` the user sees. */
export class PastedImageError extends Error {
  constructor(
    readonly code: 'UnsupportedImage' | 'ImageTooLarge',
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

/**
 * Memory of the pasted images that can still be sent: `uri` to `data:` URL.
 *
 * `add` checks everything the webview claimed: the base64 must be canonical (the server rejects
 * anything else with `Invalid attachment data URL`, `prompt.ts@v2.0.32`), at most
 * `MAX_IMAGE_BYTES`, and the bytes must be one of the four types the model receives; the declared
 * `mime` must agree with them, or it is a lie. Past {@link MAX_KEPT_IMAGES} the oldest is
 * forgotten, and its chip would then fail with `AttachmentRejected`; removing a chip frees its
 * image earlier, so the cap is only the worst case. Names are `Pasted image N`
 * with a counter that never repeats within the store's life.
 */
export class PastedImages {
  private readonly images = new Map<string, string>();
  private counter = 0;

  /** Validates and keeps one image; returns its chip. Throws {@link PastedImageError}. */
  add(declaredMime: string, base64: string): AttachmentRef {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64) {
      throw new PastedImageError('UnsupportedImage', 'That image could not be read');
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new PastedImageError('ImageTooLarge', 'That image is larger than 10 MiB');
    }
    const mime = detectImageMime(bytes);
    if (mime === undefined || mime !== declaredMime || !IMAGE_MIMES.includes(mime)) {
      throw new PastedImageError(
        'UnsupportedImage',
        'Only PNG, JPEG, GIF and WebP images can be attached',
      );
    }
    this.counter += 1;
    const uri = `${PASTED_IMAGE_SCHEME}${String(this.counter)}`;
    this.images.set(uri, `data:${mime};base64,${base64}`);
    while (this.images.size > MAX_KEPT_IMAGES) {
      const oldest = this.images.keys().next();
      if (oldest.done) break;
      this.images.delete(oldest.value);
    }
    return { uri, name: `Pasted image ${String(this.counter)}` };
  }

  /** True while `uri` is an image this store still holds. */
  has(uri: string): boolean {
    return this.images.has(uri);
  }

  /** The `data:` URL of a held image, or `undefined`. */
  dataUrlFor(uri: string): string | undefined {
    return this.images.get(uri);
  }

  /**
   * Forgets one image: after the prompt that carried it was accepted, or when the user removed its
   * chip (`attachments.forget`). An unknown `uri` is a no-op, so the webview cannot free anything
   * the store did not issue.
   */
  forget(uri: string): void {
    this.images.delete(uri);
  }

  /** Size of a held image in KiB, for the log; `undefined` when unknown. */
  sizeKiB(uri: string): number | undefined {
    const url = this.images.get(uri);
    return url === undefined
      ? undefined
      : Math.round(((url.length - url.indexOf(',')) * 3) / 4 / 1024);
  }
}
