"use client";

import {
  EMBEDDING_SCORE_THRESHOLD,
  EMBEDDING_TEXT_VERSION,
  buildSampleQuestionEmbeddingText,
  cosineSimilarity,
  toFewShotSample,
} from "@/domain/analysis/few-shot-scoring";
import {
  RECALL_ROUTE_LIMIT,
  fuseRecallRoutes,
  recallByIdentifiers,
  recallByLexical,
  type RecallCandidate,
} from "@/domain/analysis/few-shot-recall";
import { detectIssueScene, filterBySameScene } from "@/domain/analysis/issue-scene";
import { FEW_SHOT_POOL_MAX, FEW_SHOT_POOL_TEXT_LIMIT, type FewShotPoolMeta, type FewShotSample } from "@/domain/analysis/process-contracts";
import {
  categoryShares,
  effectiveRejectReasonCode,
  summarizeErrorPatterns,
  type ErrorPattern,
} from "@/domain/analysis/reject-reasons";
import {
  extractLegacyReviewEvidence,
  normalizeReviewSampleKind,
  rankReviewSampleCandidates,
} from "@/domain/analysis/review-sample";
import type { ReviewEvidence, ReviewSample, TicketSource } from "@/domain/entities";
import { db } from "@/shared/db/database";
import { apiFetch } from "@/shared/lib/api";

/**
 * few-shot 检索（Jira / 飞书通用）：同规则组、同场景（台架 / 实车）的复核样本。
 * 标识符精确、中文词法、向量三路独立召回，RRF 融合后按证据结构与错误类型先验重排；
 * 向量不可用时降级为前两路。方案：docs/requirements/issue-rag-optimization.md。
 */

async function fetchEmbeddings(input: string[]): Promise<{ model: string; embeddings: number[][] }> {
  const data = await apiFetch<{ model?: string; embeddings?: number[][] }>("/api/embeddings", {
    method: "POST",
    json: { input },
  });
  if (!data?.model || !Array.isArray(data.embeddings)) throw new Error("Embedding 返回格式异常");
  return { model: data.model, embeddings: data.embeddings };
}

async function scoreWithEmbeddings(retrievalText: string, samples: ReviewSample[]): Promise<RecallCandidate[]> {
  const usable = (sample: ReviewSample) =>
    Boolean(sample.issueSummaryEmbedding?.length) && sample.embeddingTextVersion === EMBEDDING_TEXT_VERSION;
  let rebuilt = samples.filter((sample) => !usable(sample));
  const first = await fetchEmbeddings([retrievalText, ...rebuilt.map(buildSampleQuestionEmbeddingText)]);
  const model = first.model;
  const vectors = new Map<string, number[]>();
  rebuilt.forEach((sample, index) => vectors.set(sample.id, first.embeddings[index + 1] ?? []));
  // 不同模型的向量不可比较：缓存模型与当前模型不一致时重建
  const otherModel = samples.filter((sample) => usable(sample) && sample.embeddingModel !== model);
  if (otherModel.length > 0) {
    const second = await fetchEmbeddings(otherModel.map(buildSampleQuestionEmbeddingText));
    otherModel.forEach((sample, index) => vectors.set(sample.id, second.embeddings[index] ?? []));
    rebuilt = [...rebuilt, ...otherModel];
  }
  const now = new Date();
  await Promise.all(
    rebuilt.map((sample) =>
      db.reviewSamples.update(sample.id, {
        issueSummaryEmbedding: vectors.get(sample.id) ?? [],
        embeddingModel: model,
        embeddingTextVersion: EMBEDDING_TEXT_VERSION,
        embeddingUpdatedAt: now,
      }),
    ),
  );
  const current = first.embeddings[0] ?? [];
  return samples.map((sample) => ({
    sample,
    score: cosineSimilarity(current, vectors.get(sample.id) ?? sample.issueSummaryEmbedding ?? []),
  }));
}

export interface FewShotQuery {
  source: TicketSource;
  ruleGroupId: string;
  ticketKey: string;
  issueSummary: string;
  /** 问题描述；与标题一起组成问题表示 */
  description?: string;
  /** 证据指纹文本，优先用于向量检索 */
  evidenceText?: string;
  currentEvidence?: ReviewEvidence;
  maxSamples?: number;
}

export interface FewShotRecall {
  samples: FewShotSample[];
  /** 证据生成后再次召回用的有界快照（只随请求传递，不写入样本库） */
  pool: FewShotSample[];
  poolMeta: FewShotPoolMeta;
}

function toPoolEntry(sample: ReviewSample): FewShotSample {
  const shot = toFewShotSample(sample, 0);
  const cut = (value?: string) => value?.slice(0, FEW_SHOT_POOL_TEXT_LIMIT);
  return {
    ...shot,
    sampleId: sample.id,
    approvedConclusion: cut(shot.approvedConclusion),
    wrongConclusion: cut(shot.wrongConclusion) ?? "",
    correctConclusion: cut(shot.correctConclusion) ?? "",
  };
}

export async function fetchFewShotSamples(query: FewShotQuery): Promise<FewShotSample[]> {
  return (await fetchFewShotRecall(query)).samples;
}

export async function fetchFewShotRecall(query: FewShotQuery): Promise<FewShotRecall> {
  const allSamples = await db.reviewSamples.where("ruleGroupId").equals(query.ruleGroupId).toArray();
  const isSelf = (sample: ReviewSample) => sample.ticketKey === query.ticketKey && sample.source === query.source;
  const sceneSamples = filterBySameScene(detectIssueScene(query.issueSummary), allSamples, (sample) => sample.issueSummary);
  const candidates = sceneSamples.filter((sample) => !isSelf(sample) && (sample.issueSummary || sample.evidenceFingerprintText));
  if (candidates.length === 0) return { samples: [], pool: [], poolMeta: { eligible: 0, sent: 0, truncated: false } };

  const queryText = [query.issueSummary, query.description].filter(Boolean).join("\n");
  // 标题 / 描述中的技术标识符只作检索线索，与已解析证据合并
  const hinted = extractLegacyReviewEvidence([query.issueSummary, query.description]);
  const currentEvidence: ReviewEvidence = {
    carModel: query.currentEvidence?.carModel,
    props: query.currentEvidence?.props ?? [],
    signalTokens: [...new Set([...(query.currentEvidence?.signalTokens ?? []), ...(hinted.signalTokens ?? [])])],
    propertyIds: [...new Set([...(query.currentEvidence?.propertyIds ?? []), ...(hinted.propertyIds ?? [])])],
  };

  const routes: Parameters<typeof fuseRecallRoutes<ReviewSample>>[0] = [
    { name: "identifier", candidates: recallByIdentifiers(currentEvidence, candidates) },
    { name: "lexical", candidates: recallByLexical(queryText, candidates) },
  ];
  try {
    const vectorScored = await scoreWithEmbeddings(query.evidenceText || queryText, candidates);
    routes.push({
      name: "vector",
      candidates: vectorScored
        .filter((item) => item.score > EMBEDDING_SCORE_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, RECALL_ROUTE_LIMIT),
    });
  } catch (error) {
    console.warn(`[FewShot RAG] 向量召回不可用，仅使用标识符与词法召回: ${String(error).slice(0, 160)}`);
  }
  const fused = fuseRecallRoutes<ReviewSample>(routes);

  // 该票之前被驳回过：优先注入同类错误的案例（自身样本不进候选，避免泄漏答案）
  const ownCorrection = allSamples.find((sample) => isSelf(sample) && normalizeReviewSampleKind(sample) === "correction");
  const ownCategory = ownCorrection ? effectiveRejectReasonCode(ownCorrection) : undefined;
  const ranked = rankReviewSampleCandidates<ReviewSample>({
    currentEvidence,
    candidates: fused.map(({ sample, score }) => ({ sample, relevanceScore: score })),
    maxSamples: query.maxSamples ?? 3,
    categoryPrior: categoryShares(sceneSamples, currentEvidence.carModel),
    focusCategories: ownCategory && ownCategory !== "other" ? [ownCategory] : undefined,
  });
  const samples = ranked.map(({ sample, relevanceScore }) => toFewShotSample(sample, relevanceScore));

  // 快照：初次入选与各路召回优先，其余按创建时间倒序补足；超过上限时明确标记截断
  const ordered = new Map<string, ReviewSample>();
  for (const { sample } of ranked) ordered.set(sample.id, sample);
  for (const { sample } of fused) ordered.set(sample.id, sample);
  const rest = candidates.filter((sample) => !ordered.has(sample.id)).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  for (const sample of rest) ordered.set(sample.id, sample);
  const pool = Array.from(ordered.values()).slice(0, FEW_SHOT_POOL_MAX).map(toPoolEntry);
  return { samples, pool, poolMeta: { eligible: candidates.length, sent: pool.length, truncated: candidates.length > pool.length } };
}

/** 规则组 / 车型历史上最常见的人工驳回类型（只统计同场景样本；样本不足时为空） */
export async function fetchErrorPatterns(ruleGroupId: string, carModel?: string, issueSummary?: string): Promise<ErrorPattern[]> {
  const samples = await db.reviewSamples.where("ruleGroupId").equals(ruleGroupId).toArray();
  const sceneSamples = filterBySameScene(detectIssueScene(issueSummary), samples, (sample) => sample.issueSummary);
  return summarizeErrorPatterns(sceneSamples, { carModel });
}
