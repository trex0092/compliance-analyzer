export function createId(prefix: string): string {
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  const rand = Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now().toString(36);
  return `${prefix}_${now}_${rand}`;
}
