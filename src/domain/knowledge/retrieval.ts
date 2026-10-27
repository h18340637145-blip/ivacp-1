import type { KnowledgeDoc } from "@/domain/entities";

export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (const p of clean.split(/\n{2,}/)) {
    if (p.length > size) {
      flush();
      for (let i = 0; i < p.length; i += size - overlap) {
        chunks.push(p.slice(i, i + size).trim());
        if (i + size >= p.length) break;
      }
    } else if (cur.length + p.length + 2 > size) {
      flush();
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  flush();
  return chunks.filter(Boolean);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function keywordScore(query: string, text: string): number {
  const terms = query.toLowerCase().split(/[\s,，。；;、？?]+/).filter((t) => t.length > 1);
  const lower = text.toLowerCase();
  return terms.reduce((sum, t) => sum + (lower.includes(t) ? 1 : 0), 0);
}

export interface RetrievedChunk {
  docName: string;
  text: string;
  score: number;
}

/** 有向量时按余弦相似度排序，否则回退到关键词命中数。 */
export function retrieveChunks(
  docs: KnowledgeDoc[],
  query: string,
  queryEmbedding: number[] | null,
  limit = 4,
): RetrievedChunk[] {
  const scored: RetrievedChunk[] = [];
  for (const doc of docs) {
    for (const chunk of doc.chunks) {
      const score =
        queryEmbedding && chunk.embedding
          ? cosine(queryEmbedding, chunk.embedding)
          : keywordScore(query, chunk.text);
      if (score > 0) scored.push({ docName: doc.name, text: chunk.text, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
