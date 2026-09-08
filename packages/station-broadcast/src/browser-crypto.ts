export function randomUUID(): ReturnType<typeof globalThis.crypto.randomUUID> {
  return globalThis.crypto.randomUUID();
}
