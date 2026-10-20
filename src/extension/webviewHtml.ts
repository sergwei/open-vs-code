import { randomBytes } from 'node:crypto';

/** Inputs of {@link buildWebviewHtml}. All URIs are already passed through `asWebviewUri`. */
export interface WebviewHtmlOptions {
  /** `webview.cspSource`: the origin the webview serves local resources from. */
  cspSource: string;
  /** Webview URI of the bundled script. */
  scriptUri: string;
  /** Webview URI of the bundled stylesheet. */
  styleUri: string;
  /** Per-resolution nonce from {@link createNonce}. */
  nonce: string;
}

/**
 * Creates a fresh CSP nonce: 16 random bytes, base64 (24 characters).
 *
 * Uses `node:crypto` instead of the `Math.random` of the official sample, since
 * the nonce is what keeps injected scripts out. Must be called once per
 * `resolveWebviewView`, never cached across resolutions.
 * HYPOTHESIS: 128 bits is enough; it matches common CSP guidance, not a VS Code requirement.
 */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Escapes a value for use inside a double-quoted HTML attribute.
 *
 * `Uri.toString()` is assumed to already encode most characters (HYPOTHESIS: not
 * checked against the real class), but the builder does not rely on that: an
 * unescaped `"` would let a value break out of the attribute. Covered by the
 * unit test with fabricated input.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Builds the HTML document of the chat webview, CSP included.
 *
 * Pure on purpose (no `vscode` import) so Vitest can test it.
 * The policy is `default-src 'none'` with scripts only by nonce: no inline scripts
 * or styles, none of the unsafe keywords, and no network directive because the
 * webview never touches the network (architecture rule 1). `img-src` has no
 * `https:`/`data:` since there are no images yet and Vite inlines nothing.
 * `script-src` has no `cspSource` because the bundle is a single chunk. The
 * "Loading..." text in `#root` stays visible if the CSP blocks the script,
 * instead of a blank panel; `index.tsx` clears it on mount.
 * HYPOTHESIS: VS Code applies this policy as written; confirm in F5 with the
 * webview developer tools (no "Refused to ..." in the console).
 * `webviewHtml.test.ts` guards the shape of the output with fabricated input; it
 * does not prove that VS Code enforces the policy.
 */
export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const { cspSource, nonce } = options;
  const csp = [
    "default-src 'none'",
    `img-src ${cspSource}`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${escapeAttribute(options.styleUri)}">
</head>
<body>
  <div id="root">Loading...</div>
  <script type="module" nonce="${escapeAttribute(nonce)}" src="${escapeAttribute(options.scriptUri)}"></script>
</body>
</html>`;
}
