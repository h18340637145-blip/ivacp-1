export interface ScoredMemory {
  score: number;
  importance: number;
  lastAccessedAt: number;
  pinned?: boolean;
}

const DAY = 86_400_000;
export const HALF_LIFE_DAYS = 90;
export const NEIGHBOR_THRESHOLD = 0.75;

export function decay(lastAccessedAt: number, now = Date.now()) {
  return Math.pow(0.5, Math.max(0, now - lastAccessedAt) / DAY / HALF_LIFE_DAYS);
}

export function rankScore(m: ScoredMemory, now = Date.now()) {
  const base = m.score * (0.6 + 0.2 * m.importance + 0.2 * decay(m.lastAccessedAt, now));
  return m.pinned ? base * 1.25 : base;
}

export function shouldForget(importance: number, lastAccessedAt: number, pinned = false, now = Date.now()) {
  return !pinned && importance < 0.3 && decay(lastAccessedAt, now) < 0.1;
}

export type Decision =
  | { action: "ADD" }
  | { action: "NOOP" }
  | { action: "UPDATE"; index: number; content: string };

export function parseDecision(raw: string, neighbours: number): Decision {
  try {
    const d = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    if (d.action === "NOOP") return { action: "NOOP" };
    if (
      d.action === "UPDATE" &&
      Number.isInteger(d.index) &&
      d.index >= 0 &&
      d.index < neighbours &&
      typeof d.content === "string" &&
      d.content.trim()
    ) {
      return { action: "UPDATE", index: d.index, content: d.content.trim() };
    }
  } catch {
    // 解析失败按新增处理
  }
  return { action: "ADD" };
}

export interface MemoryCandidate {
  content: string;
  type: "fact" | "preference" | "episode";
  importance: number;
}

const TYPES = ["fact", "preference", "episode"];

export function parseCandidates(raw: string): MemoryCandidate[] {
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return (Array.isArray(parsed.memories) ? parsed.memories : [])
      .filter((m: { content?: unknown }) => typeof m?.content === "string" && m.content.trim())
      .slice(0, 5)
      .map((m: { content: string; type: string; importance: number }) => ({
        content: m.content.trim().slice(0, 300),
        type: (TYPES.includes(m.type) ? m.type : "fact") as MemoryCandidate["type"],
        importance: Math.min(1, Math.max(0, Number(m.importance) || 0.5)),
      }));
  } catch {
    return [];
  }
}
