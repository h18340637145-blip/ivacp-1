export const MAX_TAGS = 10;
export const MAX_VERSIONS = 20;

export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of input) {
    if (typeof t !== "string") continue;
    const tag = t.trim().replace(/^#+/, "").trim().slice(0, 30);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function noteIndexText(title: string, content: string) {
  return content.trim() ? `${title}\n\n${content}` : "";
}
