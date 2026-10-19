# src/shared

Typed host <-> webview message protocol (issue #3) will live here.

Rules for everything in this folder:

- No `vscode` imports.
- No DOM types or APIs.
- No Node-only APIs.

Both the extension host and the webview import from here, so it must compile and run in both.
