# webview-ui

SolidJS + Vite app rendered inside the `openVsCode.chat` webview view (issue #2).

- The webview never talks to the opencode server: it only exchanges typed messages with the
  extension host (see `src/shared`).
- Vite does not serve or generate the HTML. The host builds it in `src/extension/webviewHtml.ts`
  (strict CSP, nonce, `asWebviewUri`).

## Layout

```text
webview-ui/
  build.mjs          wrapper over Vite's build() with the [watch]/[ERROR] contract
  vite.config.mts    fixed output names, single chunk
  tsconfig.json      typecheck of src/ (DOM lib, Solid JSX)
  tsconfig.node.json typecheck of vite.config.mts (Node)
  src/index.tsx      entry point
  src/App.tsx        root component
  src/vscode.ts      the only call to acquireVsCodeApi()
  src/index.css      styles, only --vscode-* variables
```

## Scripts

| Script | What it does |
|---|---|
| `npm run build:webview` | One-shot build into `dist/webview` |
| `npm run package:webview` | Production build (no sourcemaps); run by the aggregate `npm run package` (`package:*`) |
| `npm run watch:webview` | Rebuild on change; started by the `watch` task (F5) |
| `npm run check-types:webview` | `tsc --noEmit` for `src/` and for `vite.config.mts` |

## Contract with the host

The output names are fixed: `dist/webview/assets/index.js` and `dist/webview/assets/style.css`.
`src/extension/chatViewProvider.ts` references them, so change both together. The bundle is a
single chunk because the CSP allows scripts only by nonce.

## Development loop

There is no HMR inside the webview: it would require opening the CSP to localhost and websockets.
Instead:

1. F5 starts `watch:host`, `watch:types` and `watch:webview`.
2. Edit the webview; `watch:webview` rebuilds.
3. Run "Developer: Reload Webviews" in the Extension Development Host to see the change.
4. "Developer: Open Webview Developer Tools" shows the console, where CSP violations appear.

A standalone page with a simulated host (HMR in the browser) can be added once the store and the
protocol exist; there is nothing to simulate yet.
