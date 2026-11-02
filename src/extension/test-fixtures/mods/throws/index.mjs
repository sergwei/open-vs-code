// Test fixture mod (E10-mods): must end in `failed` with the message below and nothing else.
export function activate() {
  throw new Error('boom from the throws fixture');
}
