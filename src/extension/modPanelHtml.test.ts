import { describe, expect, it } from 'vitest';
import { buildModPanelHtml, type ModPanelHtmlOptions } from './modPanelHtml';

/**
 * Regression guards for the HTML builder of mod panels (E10-mods phase 4, decision P1=2).
 *
 * All inputs are fabricated: these tests protect the shape of the output (a CSP nobody loosens to
 * "fix" a blocked request, the nonce only on declared scripts, escaped titles and URIs). They do
 * NOT prove that VS Code enforces the policy: that is `test:visual` step 40.
 */

const nonce = 'AAAAAAAAAAAAAAAAAAAAAA==';
const source = 'https://file+.vscode-resource.vscode-cdn.net';

/** Fabricated options; individual tests override what they exercise. */
function options(overrides: Partial<ModPanelHtmlOptions> = {}): ModPanelHtmlOptions {
  return {
    cspSource: source,
    nonce,
    title: 'Hello panel',
    body: '<h1 id="title">Hi</h1>',
    scriptUris: [`${source}/mods/hello/panel.js`],
    styleUris: [`${source}/mods/hello/panel.css`],
    ...overrides,
  };
}

/** Extracts the `content` of the CSP meta tag. */
function cspOf(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
  if (!match?.[1]) throw new Error('CSP meta tag not found');
  return match[1];
}

describe('buildModPanelHtml', () => {
  it('emits the exact policy: default-src none, script by nonce, style and img from cspSource, no connect-src', () => {
    const csp = cspOf(buildModPanelHtml(options()));

    // The exact string: any relaxation (cspSource in script-src, https:/data: in img-src, a
    // connect-src, unsafe-inline) changes it and has to be a deliberate edit of this test too.
    expect(csp).toBe(
      `default-src 'none'; img-src ${source}; style-src ${source}; script-src 'nonce-${nonce}'`,
    );
    expect(csp).not.toContain('connect-src');
    expect(csp).not.toContain('unsafe-');
  });

  it('puts the nonce on every declared script and writes no inline script or style of its own', () => {
    const html = buildModPanelHtml(options({ scriptUris: [`${source}/a.js`, `${source}/b.js`] }));

    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(2);
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
      expect(tag).toContain('src="');
    }
    expect(html).not.toContain('<style');
    expect(html).toContain(`<link rel="stylesheet" href="${source}/mods/hello/panel.css">`);
  });

  it('keeps the mod markup as written, between the head and the scripts', () => {
    const html = buildModPanelHtml(options());

    expect(html.indexOf('<h1 id="title">Hi</h1>')).toBeGreaterThan(html.indexOf('</head>'));
    expect(html.indexOf('<h1 id="title">Hi</h1>')).toBeLessThan(html.indexOf('<script'));
  });

  it('emits no script and no link when the mod declared none', () => {
    const html = buildModPanelHtml(options({ scriptUris: [], styleUris: [] }));

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
  });

  it('escapes the title and the URIs so they cannot break out of their place', () => {
    const html = buildModPanelHtml(
      options({
        title: '</title><script>alert(1)</script>',
        scriptUris: ['https://x/a"onload="alert(1)&b=<c>.js'],
        styleUris: ['https://x/"s.css'],
      }),
    );

    expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>');
    expect(html).toContain('src="https://x/a&quot;onload=&quot;alert(1)&amp;b=&lt;c&gt;.js"');
    expect(html).toContain('href="https://x/&quot;s.css"');
    expect(html).not.toContain('onload="alert');
  });
});
