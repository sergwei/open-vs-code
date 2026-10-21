// Protects the theming rule of the webview (architecture rule 5, issue #17): colours come only
// from `--vscode-*` variables, so light, dark and high-contrast themes work, and no component
// carries an inline style string (the CSP has no 'unsafe-inline' for styles).
//
// Provenance: reads the real `index.css` and the real TSX sources as raw text through Vite
// (`?raw`, `import.meta.glob`); the webview tsconfig has no Node types, so no `node:fs`. It
// checks the text, not how it renders.
import { describe, expect, it } from 'vitest';
import rawCss from './index.css?raw';

const sources = import.meta.glob<string>(['./**/*.tsx', '!./**/*.test.tsx', '!./testing.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('index.css', () => {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

  it('has no literal colour', () => {
    expect(css.length).toBeGreaterThan(1000);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i);
  });

  it('covers high contrast and reduced motion', () => {
    expect(css).toContain('--vscode-contrastBorder');
    expect(css).toContain('--vscode-contrastActiveBorder');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('body.vscode-reduce-motion');
  });
});

describe('components', () => {
  it('never set a style attribute or a style string', () => {
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const [file, text] of files) expect(text, file).not.toMatch(/\bstyle\s*=/);
  });
});
