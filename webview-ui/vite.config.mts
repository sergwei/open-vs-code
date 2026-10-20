import { join } from 'node:path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

/**
 * Vite config for the webview bundle (issue #2).
 *
 * The extension host builds the HTML itself (CSP, nonce, `asWebviewUri`), so Vite
 * only has to emit fixed file names: `assets/index.js` and `assets/style.css`
 * under `dist/webview`. Those names are a contract with `src/extension/chatViewProvider.ts`
 * and must change together. A single chunk is required because the CSP allows
 * scripts only by nonce (no `cspSource` in `script-src`), and `assetsInlineLimit: 0`
 * avoids `data:` URIs, which the CSP does not allow either.
 * HYPOTHESIS (read in vite@8.3.4 and rolldown@1.2.14 sources, not executed):
 * `build.rolldownOptions` is the current option, `codeSplitting: false` replaces
 * `inlineDynamicImports`, and with `cssCodeSplit: false` the CSS bundle is named `style.css`.
 * HYPOTHESIS until the first F5 build: that Vite forwards `codeSplitting: false` and
 * that `dist/webview/assets` ends up with only `index.js`, `index.js.map`, `style.css`.
 * Tilde ranges on `vite` because the `style.css` name is a Vite internal.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  publicDir: false,
  plugins: [solid()],
  build: {
    outDir: '../dist/webview',
    // Outside `root`, Vite does not empty the directory unless told to.
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: join(import.meta.dirname, 'src', 'index.tsx'),
      output: {
        codeSplitting: false,
        entryFileNames: 'assets/index.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
