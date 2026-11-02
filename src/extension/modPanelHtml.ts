/** Inputs of {@link buildModPanelHtml}. Every URI is already passed through `asWebviewUri`. */
export interface ModPanelHtmlOptions {
  /** `webview.cspSource`: the origin the panel serves local resources from. */
  cspSource: string;
  /** Per-panel nonce from `createNonce`. */
  nonce: string;
  /** Title of the document (plain text; the editor tab has its own title). */
  title: string;
  /** Markup of the mod's `panel.html`, put inside `<body>` as the mod wrote it. */
  body: string;
  /** Webview URIs of the scripts the mod declared, in order. */
  scriptUris: readonly string[];
  /** Webview URIs of the stylesheets the mod declared, in order. */
  styleUris: readonly string[];
}

/**
 * Escapes a value for a double-quoted HTML attribute or for text content.
 *
 * Same set as `webviewHtml.ts`; kept local so that file does not export a helper whose only
 * second user is the mod panel. Covered by the unit test with fabricated input.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Builds the HTML document of a mod panel (E10-mods, phase 4; plan Engram #1765 section 3.3,
 * option B, decision P1=2), CSP included.
 *
 * The policy is `default-src 'none'`, `script-src` by nonce only, `style-src` and `img-src` limited
 * to `cspSource`, and no `connect-src`: the panel cannot make a request, so it can neither reach the
 * opencode server nor send data anywhere (architecture rule 1). There is no inline script or style
 * the host writes, and an inline `<script>` or `style=` inside the mod's own markup is blocked by
 * the policy because it has no nonce and `style-src` has no `'unsafe-inline'`. The mod's markup
 * is NOT escaped (it is HTML by definition and the mod is trusted code with full Node anyway; the
 * CSP is what keeps its panel from the network), but the title and every URI are. Only the
 * declared scripts carry the nonce, each in its own `<script>` at the end of the body.
 * The theme variables (`--vscode-*`) are present in every VS Code webview, so the mod's stylesheet
 * can use them.
 * `modPanelHtml.test.ts` guards the exact policy with fabricated input; it does not prove that VS
 * Code enforces it. VERIFIED in VS Code 1.144.0 on Windows 11 (02/11/2026, `test:visual --steps
 * 39`): "ok   P3 the CSP is enforced in the panel: a fetch to another origin and an inline script are
 * blocked and reported" and "ok   P3 the panel page loaded its script and stylesheet with no CSP
 * violation".
 */
export function buildModPanelHtml(options: ModPanelHtmlOptions): string {
  const { cspSource, nonce } = options;
  const csp = [
    "default-src 'none'",
    `img-src ${cspSource}`,
    `style-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const styles = options.styleUris
    .map((uri) => `  <link rel="stylesheet" href="${escapeHtml(uri)}">`)
    .join('\n');
  const scripts = options.scriptUris
    .map((uri) => `  <script nonce="${escapeHtml(nonce)}" src="${escapeHtml(uri)}"></script>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
${styles}
</head>
<body>
${options.body}
${scripts}
</body>
</html>`;
}
