// What the prompt box makes of a drag-and-drop or a paste (issue #30). PURE: it reads a minimal
// shape instead of the DOM `DataTransfer`, which jsdom cannot construct, so Vitest drives it with
// plain objects.

import { MAX_DROPPED_ITEMS } from '../../../src/shared/protocol';

/** The part of `DataTransfer` that {@link readDrop} reads. */
export interface TransferLike {
  readonly types: readonly string[];
  getData(type: string): string;
  readonly files: ArrayLike<File>;
}

/** The part of a clipboard item that {@link imagesOf} reads. */
export interface ItemLike {
  readonly kind: string;
  readonly type: string;
  getAsFile(): File | null;
}

/** What was dropped: URIs from the VS Code Explorer, files from the OS (bytes only), or nothing usable. */
export type DropContent =
  { kind: 'uris'; uris: string[] } | { kind: 'files'; files: File[] } | { kind: 'none' };

/**
 * True when a drag carries something this box can take. Anything else (a text selection dragged
 * inside the textarea) is left to the browser, so moving text around keeps working.
 */
export function hasDropPayload(types: readonly string[]): boolean {
  return types.some((type) => {
    const lower = type.toLowerCase();
    return (
      lower === 'files' || lower === 'resourceurls' || lower === 'application/vnd.code.uri-list'
    );
  });
}

/** The strings of a JSON array; anything else gives an empty list. */
function jsonStrings(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item !== '');
  } catch {
    return [];
  }
}

/**
 * Reads a drop. The Explorer of VS Code puts the dragged files in `resourceurls` as a JSON array of
 * `URI.toString()` strings, folders left out (`fillEditorsDragData`, read in VS Code 1.105.0;
 * HYPOTHESIS that an iframe can read that custom type, a third party's extension does). As a
 * fallback `application/vnd.code.uri-list` (newline separated) is read. The list is cut to
 * {@link MAX_DROPPED_ITEMS}; the host validates every string again. A drop from the OS has no
 * paths in a webview, only `File` objects.
 */
export function readDrop(transfer: TransferLike): DropContent {
  const lowered = transfer.types.map((type) => type.toLowerCase());
  let uris: string[] = [];
  if (lowered.includes('resourceurls')) uris = jsonStrings(transfer.getData('resourceurls'));
  if (uris.length === 0 && lowered.includes('application/vnd.code.uri-list')) {
    uris = transfer
      .getData('application/vnd.code.uri-list')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
  }
  if (uris.length > 0) return { kind: 'uris', uris: uris.slice(0, MAX_DROPPED_ITEMS) };
  const files = Array.from(transfer.files);
  return files.length > 0 ? { kind: 'files', files } : { kind: 'none' };
}

/** The files of a paste that claim to be images; empty for a text paste. */
export function imagesOf(items: ArrayLike<ItemLike>): File[] {
  const images: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file !== null) images.push(file);
  }
  return images;
}
