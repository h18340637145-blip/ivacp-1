import type { ReviewEvidence, ReviewSample } from "@/domain/entities";

/** 召回所需的最小样本形状：客户端 ReviewSample 与请求内快照条目都满足 */
export type RecallSample = Pick<ReviewSample, "issueSummary" | "evidenceFingerprintText" | "props" | "signalTokens" | "propertyIds"> & { id: string };

/**
 * 问题 RAG 多路召回（结构化精确 / 中文词法 / 向量）与倒数排名融合。
 * 方案：docs/requirements/issue-rag-optimization.md 第 6 节。
 */

export const RECALL_ROUTE_LIMIT = 20;
export const LEXICAL_SCORE_THRESHOLD = 0.2;
const RRF_K = 60;

/** 中文按字符二元组、技术标识符保留完整 token */
export function lexicalFeatures(text: string): Set<string> {
  const features = new Set<string>();
  const lowered = text.toLowerCase();
  for (const match of lowered.matchAll(/[a-z0-9_]{2,}/g)) features.add(match[0]);
  for (const match of lowered.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = match[0];
    if (run.length === 1) features.add(run);
    for (let index = 0; index < run.length - 1; index += 1) features.add(run.slice(index, index + 2));
  }
  return features;
}

/** Dice 系数；任一侧无特征为 0 */
export function lexicalSimilarity(a: string, b: string): number {
  const left = lexicalFeatures(a);
  const right = lexicalFeatures(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const feature of left) if (right.has(feature)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/** Property ID：十六进制与十进制统一为十进制字符串，其余原样小写 */
export function normalizePropertyId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(trimmed)) return String(parseInt(trimmed, 16));
  if (/^[0-9a-f]{2,}h$/.test(trimmed)) return String(parseInt(trimmed.slice(0, -1), 16));
  return trimmed;
}

type MarkerKind = "prop" | "signal" | "propertyId";

/** 命名空间前缀避免 prop / 信号 / Property ID 数值相同混为一个标记 */
function markers(evidence: Partial<Pick<ReviewEvidence, "props" | "signalTokens" | "propertyIds">>): Set<string> {
  const result = new Set<string>();
  const add = (kind: MarkerKind, value: string) => {
    const normalized = kind === "propertyId" ? normalizePropertyId(value) : value.trim().toLowerCase();
    if (normalized) result.add(`${kind}:${normalized}`);
  };
  for (const value of evidence.props ?? []) add("prop", value);
  for (const value of evidence.signalTokens ?? []) add("signal", value);
  for (const value of evidence.propertyIds ?? []) add("propertyId", value);
  return result;
}

export interface RecallCandidate<T extends RecallSample = ReviewSample> {
  sample: T;
  score: number;
}

/** 样本问题侧文本：不含历史结论，避免答案影响问题相似度 */
export function sampleQuestionText(sample: Pick<RecallSample, "issueSummary" | "evidenceFingerprintText">): string {
  return [sample.issueSummary, sample.evidenceFingerprintText].filter(Boolean).join("\n");
}

/** 结构化精确召回：IDF 加权的标识符覆盖率，不受语义阈值限制 */
export function recallByIdentifiers<T extends RecallSample>(
  current: Pick<ReviewEvidence, "props" | "signalTokens" | "propertyIds">,
  samples: T[],
  limit = RECALL_ROUTE_LIMIT,
): Array<RecallCandidate<T>> {
  const currentMarkers = markers(current);
  if (currentMarkers.size === 0) return [];
  const sampleMarkers = samples.map((sample) => markers(sample));
  const documentFrequency = new Map<string, number>();
  for (const set of sampleMarkers) for (const marker of set) documentFrequency.set(marker, (documentFrequency.get(marker) ?? 0) + 1);
  const idf = (marker: string) => Math.log(1 + samples.length / (documentFrequency.get(marker) ?? 1));
  let total = 0;
  for (const marker of currentMarkers) total += idf(marker);
  if (total === 0) return [];

  const scored: Array<RecallCandidate<T>> = [];
  samples.forEach((sample, index) => {
    let hit = 0;
    for (const marker of currentMarkers) if (sampleMarkers[index].has(marker)) hit += idf(marker);
    if (hit > 0) scored.push({ sample, score: hit / total });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 中文词法召回 */
export function recallByLexical<T extends RecallSample>(
  queryText: string,
  samples: T[],
  limit = RECALL_ROUTE_LIMIT,
  threshold = LEXICAL_SCORE_THRESHOLD,
): Array<RecallCandidate<T>> {
  return samples
    .map((sample) => ({ sample, score: lexicalSimilarity(queryText, sampleQuestionText(sample)) }))
    .filter((item) => item.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface FusedCandidate<T extends RecallSample = ReviewSample> {
  sample: T;
  /** 归一化到 0-1：各路 RRF 之和 / 路数上限 */
  score: number;
  routes: Array<"identifier" | "lexical" | "vector" | "initial">;
}

/** 倒数排名融合：按样本 id 合并去重，不直接相加未校准的分数 */
export function fuseRecallRoutes<T extends RecallSample = ReviewSample>(
  routes: Array<{ name: FusedCandidate["routes"][number]; candidates: Array<RecallCandidate<T>> }>,
  poolLimit = 60,
): Array<FusedCandidate<T>> {
  const merged = new Map<string, FusedCandidate<T>>();
  const best = routes.length / (RRF_K + 1);
  for (const route of routes) {
    route.candidates.forEach(({ sample }, rank) => {
      const entry = merged.get(sample.id) ?? { sample, score: 0, routes: [] };
      entry.score += 1 / (RRF_K + rank + 1) / best;
      entry.routes.push(route.name);
      merged.set(sample.id, entry);
    });
  }
  return Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, poolLimit);
}
