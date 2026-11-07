// Parser of a mod's `mod.json` (E10-mods, plan Engram #1765 section 3.5). PURE: takes text, gives
// a value or a reason; reading the file and the symlink check live in `src/extension/modDiscovery.ts`.

import path from 'node:path';
import { MOD_ID_PATTERN } from '../shared/protocol';

// `id` of a mod: also the folder-safe name and the prefix of its commands (`<id>:<name>`). The
// pattern lives in `src/shared/protocol.ts` (E10-mod-toggles), where `mod.toggle` is validated.
export { MOD_ID_PATTERN };

/** The only mod API version this build speaks. A mod that asks for another is `failed`, not guessed at. */
export const SUPPORTED_API_VERSION = 1;

/** Biggest `mod.json` read, in bytes. Own choice: a manifest is a handful of lines. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

const MAIN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const MAX_NAME = 80;
const MAX_VERSION = 32;
const MAX_DESCRIPTION = 300;

/** A validated `mod.json`. */
export interface ModManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: typeof SUPPORTED_API_VERSION;
  /** Relative path of the entry file with `/` separators, lexically inside the mod folder. */
  main: string;
  description?: string;
}

/** Outcome of {@link parseManifest}: the manifest, or one sentence saying what is wrong. */
export type ManifestResult = { ok: true; manifest: ModManifest } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks `main` lexically: relative (neither POSIX nor Windows absolute, no drive), no NUL, no
 * `..` that climbs out, and a `.js`/`.mjs`/`.cjs` extension. Returns the normalized path with `/`,
 * or an error sentence. This is NOT the containment proof: a symlink can still point out, which
 * `modDiscovery` rules out after `realpath`.
 */
function checkMain(raw: string): { main: string } | { error: string } {
  if (raw === '' || raw.includes('\0'))
    return { error: '"main" must be a non-empty relative path' };
  const slashed = raw.replace(/\\/g, '/');
  if (path.posix.isAbsolute(slashed) || path.win32.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    return { error: '"main" must be relative to the mod folder, not absolute' };
  }
  const normalized = path.posix.normalize(slashed);
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    return { error: '"main" must stay inside the mod folder' };
  }
  if (!MAIN_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
    return { error: '"main" must be a .js, .mjs or .cjs file' };
  }
  return { main: normalized };
}

/**
 * Parses and validates the text of a `mod.json`.
 *
 * Fails (never throws) with a sentence a user can act on: bad JSON, a field of the wrong type, an
 * `id` outside {@link MOD_ID_PATTERN}, an `apiVersion` other than {@link SUPPORTED_API_VERSION}
 * ("requires Station mod API v2; this version supports 1") or a `main` that is absolute, climbs
 * out of the folder or has another extension. `name` defaults to the `id`. VERIFIED by
 * `manifest.test.ts` with fabricated manifests (Windows 11, 02/11/2026); a manifest written by a
 * real author is UNVERIFIED.
 */
export function parseManifest(text: string): ManifestResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'mod.json is not valid JSON' };
  }
  if (!isRecord(value)) return { ok: false, error: 'mod.json must be a JSON object' };

  const { id, name, version, apiVersion, main, description } = value;
  if (typeof id !== 'string' || !MOD_ID_PATTERN.test(id)) {
    return { ok: false, error: '"id" must match ^[a-z0-9][a-z0-9-]{0,63}$' };
  }
  if (name !== undefined && (typeof name !== 'string' || name === '' || name.length > MAX_NAME)) {
    return { ok: false, error: `"name" must be a string of 1-${MAX_NAME} characters` };
  }
  if (typeof version !== 'string' || version === '' || version.length > MAX_VERSION) {
    return { ok: false, error: `"version" must be a string of 1-${MAX_VERSION} characters` };
  }
  if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion)) {
    return { ok: false, error: '"apiVersion" must be an integer' };
  }
  if (apiVersion !== SUPPORTED_API_VERSION) {
    return {
      ok: false,
      error: `requires Station mod API v${String(apiVersion)}; this version supports ${SUPPORTED_API_VERSION}`,
    };
  }
  if (typeof main !== 'string') return { ok: false, error: '"main" must be a string' };
  const checked = checkMain(main);
  if ('error' in checked) return { ok: false, error: checked.error };
  if (
    description !== undefined &&
    (typeof description !== 'string' || description.length > MAX_DESCRIPTION)
  ) {
    return {
      ok: false,
      error: `"description" must be a string of at most ${MAX_DESCRIPTION} characters`,
    };
  }

  const manifest: ModManifest = {
    id,
    name: name ?? id,
    version,
    apiVersion: SUPPORTED_API_VERSION,
    main: checked.main,
  };
  if (description !== undefined) manifest.description = description;
  return { ok: true, manifest };
}
