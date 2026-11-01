import { describe, expect, it } from 'vitest';
import { buildWebviewHtml, createNonce } from './webviewHtml';

/**
 * Regression guards for the HTML builder of the chat webview (issue #2, plan step 6).
 *
 * All inputs are fabricated: these tests protect the shape of the output (a CSP that nobody
 * loosens to "fix" a blocked style, a single nonce-protected script, escaped attributes, a
 * fresh nonce per call). They do NOT prove that VS Code enforces the policy or that the real
 * `Uri.toString()` output is what we assume; that is only visible in the Extension
 * Development Host (F5).
 */

const nonce = 'AAAAAAAAAAAAAAAAAAAAAA==';

/** Fabricated options with plain URIs; individual tests override what they exercise. */
function options(overrides: Partial<Parameters<typeof buildWebviewHtml>[0]> = {}) {
  return {
    cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
    scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/dist/webview/assets/index.js',
    styleUri: 'https://file+.vscode-resource.vscode-cdn.net/dist/webview/assets/style.css',
    nonce,
    surface: 'view' as const,
    ...overrides,
  };
}

/** Extracts the `content` of the CSP meta tag. */
function cspOf(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
  if (!match?.[1]) throw new Error('CSP meta tag not found');
  return match[1];
}

describe('buildWebviewHtml', () => {
  it('keeps the CSP strict: default-src none, script by nonce, no unsafe-* and no connect-src', () => {
    const csp = cspOf(buildWebviewHtml(options()));

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'nonce-${nonce}'`);
    expect(csp).not.toContain('unsafe-');
    expect(csp).not.toContain('connect-src');
    // The exact policy: any relaxation (cspSource in script-src, https:/data: in img-src, a new
    // directive) changes this string and has to be a deliberate edit of the test too. `blob:` in
    // img-src is the deliberate one of issue #30 (thumbnails of pasted images).
    const source = options().cspSource;
    expect(csp).toBe(
      `default-src 'none'; img-src ${source} blob:; style-src ${source}; font-src ${source}; ` +
        `script-src 'nonce-${nonce}'`,
    );
  });

  it('emits no inline <style> element (styles only come from the bundled stylesheet)', () => {
    expect(buildWebviewHtml(options())).not.toContain('<style');
  });

  it('emits exactly one script, with the nonce and a src', () => {
    const html = buildWebviewHtml(options());

    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toMatch(
      /<script type="module" nonce="AAAAAAAAAAAAAAAAAAAAAA==" src="[^"]+"><\/script>/,
    );
  });

  it('uses the received URIs for the script and the stylesheet', () => {
    const o = options();
    const html = buildWebviewHtml(o);

    expect(html).toContain(`src="${o.scriptUri}"`);
    expect(html).toContain(`href="${o.styleUri}"`);
  });

  it('writes the surface meta for a view, a tab and the settings tab, and the CSP does not change with it', () => {
    // Protects issue #77 (E3): the tab webview hides its session picker by reading this meta; and
    // issue #128 (E10): `settings` is what makes `index.tsx` mount the OpenCode Settings root, with
    // the same strict CSP as the chat. Fabricated input; a real VS Code is covered by test:visual
    // step 29 cell B7 (view, tab) and, for `settings`, by the `webview ready` of the panel in the
    // `fake-server` suite.
    const view = buildWebviewHtml(options({ surface: 'view' }));
    const tab = buildWebviewHtml(options({ surface: 'tab' }));
    const settings = buildWebviewHtml(options({ surface: 'settings' }));

    expect(view).toContain('<meta name="open-vs-code-surface" content="view">');
    expect(tab).toContain('<meta name="open-vs-code-surface" content="tab">');
    expect(settings).toContain('<meta name="open-vs-code-surface" content="settings">');
    expect(cspOf(tab)).toBe(cspOf(view));
    expect(cspOf(settings)).toBe(cspOf(view));
  });

  it('escapes attribute values so a URI cannot break out of the attribute', () => {
    const html = buildWebviewHtml(
      options({ scriptUri: 'https://x/a"onload="alert(1)&b=<c>.js', styleUri: 'https://x/"s.css' }),
    );

    expect(html).toContain('src="https://x/a&quot;onload=&quot;alert(1)&amp;b=&lt;c&gt;.js"');
    expect(html).toContain('href="https://x/&quot;s.css"');
    expect(html).not.toContain('onload="alert');
  });
});

describe('createNonce', () => {
  it('returns a different value on every call', () => {
    expect(createNonce()).not.toBe(createNonce());
  });

  it('is 16 random bytes in base64: 24 characters of the base64 alphabet', () => {
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
