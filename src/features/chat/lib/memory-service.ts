import { db } from "@/shared/db/database";
import type { MemoryRecord } from "@/domain/entities";
import { cosine } from "@/domain/knowledge/retrieval";
import {
  NEIGHBOR_THRESHOLD,
  rankScore,
  shouldForget,
  type Decision,
  type MemoryCandidate,
} from "@/domain/knowledge/memory-core";
import { apiFetch } from "@/shared/lib/api";
import { newId } from "@/shared/lib/ids";
import { embedOne, embedTexts } from "./embed";

export const MAX_MEMORY_LENGTH = 300;

export function listMemories(userId: string): Promise<MemoryRecord[]> {
  return db.memories.where("userId").equals(userId).toArray();
}

/** 置顶优先，其余按创建时间倒序 */
export function sortMemories(list: MemoryRecord[]): MemoryRecord[] {
  return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt - a.createdAt);
}

export async function forgetStaleMemories(userId: string) {
  const all = await listMemories(userId);
  const stale = all.filter((m) => shouldForget(m.importance, m.lastAccessedAt, m.pinned)).map((m) => m.id);
  if (stale.length) await db.memories.bulkDelete(stale);
}

function keywordHit(query: string, content: string) {
  return query
    .toLowerCase()
    .split(/[\s,，。；;、？?]+/)
    .some((t) => t.length > 1 && content.toLowerCase().includes(t));
}

export async function recallMemories(userId: string, query: string, qv: number[] | null, limit = 5) {
  const all = await listMemories(userId);
  const now = Date.now();
  const ranked = all
    .map((m) => {
      const score = qv && m.embedding ? cosine(qv, m.embedding) : keywordHit(query, m.content) ? 0.5 : 0;
      return { m, rank: rankScore({ score, importance: m.importance, lastAccessedAt: m.lastAccessedAt, pinned: m.pinned }, now) };
    })
    .filter((x) => x.rank > 0.25 || x.m.pinned)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((x) => x.m);
  await Promise.all(ranked.map((m) => db.memories.update(m.id, { lastAccessedAt: now })));
  return ranked;
}

/** 抽取 → 相邻记忆 → LLM 判定 ADD/UPDATE/NOOP；失败时静默跳过，不影响对话。 */
export async function rememberExchange(userId: string, user: string, assistant: string) {
  const { memories } = await apiFetch<{ memories?: MemoryCandidate[] }>("/api/memory", {
    method: "POST",
    json: { action: "extract", user, assistant },
  });
  if (!memories?.length) return;

  const vectors = await embedTexts(memories.map((m) => m.content));
  for (const [i, c] of memories.entries()) {
    const embedding = vectors?.[i];
    const existing = await listMemories(userId);
    const neighbours = embedding
      ? existing
          .filter((m) => m.embedding && cosine(embedding, m.embedding) >= NEIGHBOR_THRESHOLD)
          .sort((a, b) => cosine(embedding, b.embedding!) - cosine(embedding, a.embedding!))
          .slice(0, 3)
      : [];
    let decision: Decision = { action: "ADD" };
    if (neighbours.length) {
      try {
        const data = await apiFetch<{ decision: Decision }>("/api/memory", {
          method: "POST",
          json: { action: "decide", candidate: c.content, neighbours: neighbours.map((n) => n.content) },
        });
        decision = data.decision;
      } catch {
        // 判定失败按新增处理
      }
    }
    const now = Date.now();
    if (decision.action === "NOOP") {
      await db.memories.update(neighbours[0].id, { lastAccessedAt: now });
    } else if (decision.action === "UPDATE" && neighbours[decision.index]) {
      const target = neighbours[decision.index];
      await db.memories.update(target.id, {
        content: decision.content,
        embedding: await embedOne(decision.content),
        importance: Math.max(target.importance, c.importance),
        lastAccessedAt: now,
      });
    } else {
      await db.memories.put({
        id: newId(),
        userId,
        content: c.content,
        type: c.type,
        importance: c.importance,
        embedding,
        createdAt: now,
        lastAccessedAt: now,
      });
    }
  }
}

/** 手动添加记忆（类型 manual，重要度 0.8） */
export async function addManualMemory(userId: string, content: string): Promise<{ embedded: boolean }> {
  const text = content.trim().slice(0, MAX_MEMORY_LENGTH);
  const embedding = await embedOne(text);
  const now = Date.now();
  await db.memories.put({
    id: newId(),
    userId,
    content: text,
    type: "manual",
    importance: 0.8,
    embedding,
    createdAt: now,
    lastAccessedAt: now,
  });
  return { embedded: !!embedding };
}

export async function toggleMemoryPin(memory: MemoryRecord) {
  await db.memories.update(memory.id, { pinned: !memory.pinned });
}

export async function deleteMemory(id: string) {
  await db.memories.delete(id);
}
