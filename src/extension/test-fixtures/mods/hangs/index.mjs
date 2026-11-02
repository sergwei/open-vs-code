// Test fixture mod (E10-mods): a synchronous infinite loop. Only the host's heartbeat plus
// `worker.terminate()` can stop it; the mod must end in `failed` (hung) without freezing the host.
export function activate() {
  while (true) {
    // spin
  }
}
