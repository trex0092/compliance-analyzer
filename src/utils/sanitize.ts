const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

export function sanitizeText(input: string): string {
  return escapeHtml(input.trim());
}

export function sanitizeRecord<T extends Record<string, unknown>>(
  obj: T
): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (typeof val === "string") {
      (result as Record<string, unknown>)[key] = sanitizeText(val);
    }
  }
  return result;
}
