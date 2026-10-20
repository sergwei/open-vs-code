/**
 * Placeholder root component of the chat webview.
 *
 * It has no logic yet; it exists so the Vite + Solid + CSP pipeline can be
 * checked end to end in the Extension Development Host. Replaced by the real
 * chat UI in later issues.
 * UNVERIFIED: that it renders under the CSP in light, dark and high-contrast
 * themes (checklist F5 of the issue #2 plan).
 */
export function App() {
  return (
    <main class="app">
      <h1 class="app-title">OpenCode</h1>
      <p class="app-hint">Chat coming soon</p>
    </main>
  );
}
