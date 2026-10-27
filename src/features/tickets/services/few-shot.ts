"use client";

import {
  EMBEDDING_SCORE_THRESHOLD,
  TITLE_SCORE_THRESHOLD,
  buildSampleEmbeddingText,
  cosineSimilarity,
  titleSimilarity,
  toFewShotSample,
} from "@/domain/analysis/few-shot-scoring";
import { detectIssueScene, filterBySameScene } from "@/domain/analysis/issue-scene";
import type { FewShotSample } from "@/domain/analysis/process-contracts";
import {
  categoryShares,
  effectiveRejectReasonCode,
  summarizeErrorPatterns,
  type ErrorPattern,
} from "@/domain/analysis/reject-reasons";
import { normalizeReviewSampleKind, rankReviewSampleCandidates } from "@/domain/analysis/review-sample";
import type { ReviewEvidence, ReviewSample, TicketSource } from "@/domain/entities";
import { db } from "@/shared/db/database";
import { apiFetch } from "@/shared/lib/api";

/**
 * few-shot 检索（Jira / 飞书通用）：同规则组、同场景（台架 / 实车）的复核样本，
 * 优先 embedding 余弦相似度，失败回退标题词重叠，再按证据结构与错误类型先验重排。
 */

async function fetchEmbeddings(input: string[]): Promise<{ model: string; embeddings: number[][] }> {
  const data = await apiFetch<{ model?: string; embeddings?: number[][] }>("/api/embeddings", {
    method: "POST",
    json: { input },
  });
  if (!data?.model || !Array.isArray(data.embeddings)) throw new Error("Embedding 返回格式异常");
  return { model: data.model, embeddings: data.embeddings };
}

async function scoreWithEmbeddings(retrievalText: string, samples: ReviewSample[]) {
  const missing = samples.filter((sample) => !sample.issueSummaryEmbedding?.length);
  const { model, embeddings } = await fetchEmbeddings([retrievalText, ...missing.map(buildSampleEmbeddingText)]);
  const current = embeddings[0] ?? [];
  const missingById = new Map(missing.map((sample, index) => [sample.id, embeddings[index + 1] ?? []]));
  const now = new Date();
  await Promise.all(
    missing.map((sample) =>
      db.reviewSamples.update(sample.id, {
        issueSummaryEmbedding: missingById.get(sample.id) ?? [],
        embeddingModel: model,
        embeddingUpdatedAt: now,
      }),
    ),
  );
  return samples.map((sample) => ({
    sample,
    score: cosineSimilarity(current, sample.issueSummaryEmbedding?.length ? sample.issueSummaryEmbedding : (missingById.get(sample.id) ?? [])),
  }));
}

export interface FewShotQuery {
  source: TicketSource;
  ruleGroupId: string;
  ticketKey: string;
  issueSummary: string;
  /** 证据指纹文本，优先用于向量检索 */
  evidenceText?: string;
  currentEvidence?: ReviewEvidence;
  maxSamples?: number;
}

export async function fetchFewShotSamples(query: FewShotQuery): Promise<FewShotSample[]> {
  const allSamples = await db.reviewSamples.where("ruleGroupId").equals(query.ruleGroupId).toArray();
  const isSelf = (sample: ReviewSample) => sample.ticketKey === query.ticketKey && sample.source === query.source;
  const sceneSamples = filterBySameScene(detectIssueScene(query.issueSummary), allSamples, (sample) => sample.issueSummary);
  const candidates = sceneSamples.filter((sample) => !isSelf(sample) && (sample.issueSummary || sample.evidenceFingerprintText));
  if (candidates.length === 0) return [];

  let scored: Array<{ sample: ReviewSample; score: number }>;
  let threshold = EMBEDDING_SCORE_THRESHOLD;
  try {
    scored = await scoreWithEmbeddings(query.evidenceText || query.issueSummary, candidates);
  } catch (error) {
    console.warn(`[FewShot RAG] Embedding 召回失败，回退标题相似度: ${String(error).slice(0, 160)}`);
    scored = candidates.map((sample) => ({ sample, score: titleSimilarity(query.issueSummary, sample.issueSummary ?? "") }));
    threshold = TITLE_SCORE_THRESHOLD;
  }
  scored = scored.filter((item) => item.score > threshold).sort((a, b) => b.score - a.score);

  const currentEvidence: ReviewEvidence = {
    carModel: query.currentEvidence?.carModel,
    props: query.currentEvidence?.props ?? [],
    signalTokens: query.currentEvidence?.signalTokens ?? [],
    propertyIds: query.currentEvidence?.propertyIds ?? [],
  };
  // 该票之前被驳回过：优先注入同类错误的案例（自身样本不进候选，避免泄漏答案）
  const ownCorrection = allSamples.find((sample) => isSelf(sample) && normalizeReviewSampleKind(sample) === "correction");
  const ownCategory = ownCorrection ? effectiveRejectReasonCode(ownCorrection) : undefined;
  const ranked = rankReviewSampleCandidates({
    currentEvidence,
    candidates: scored.map(({ sample, score }) => ({ sample, relevanceScore: score })),
    maxSamples: query.maxSamples ?? 3,
    categoryPrior: categoryShares(sceneSamples, currentEvidence.carModel),
    focusCategories: ownCategory && ownCategory !== "other" ? [ownCategory] : undefined,
  });
  return ranked.map(({ sample, relevanceScore }) => toFewShotSample(sample, relevanceScore));
}

/** 规则组 / 车型历史上最常见的人工驳回类型（只统计同场景样本；样本不足时为空） */
export async function fetchErrorPatterns(ruleGroupId: string, carModel?: string, issueSummary?: string): Promise<ErrorPattern[]> {
  const samples = await db.reviewSamples.where("ruleGroupId").equals(ruleGroupId).toArray();
  const sceneSamples = filterBySameScene(detectIssueScene(issueSummary), samples, (sample) => sample.issueSummary);
  return summarizeErrorPatterns(sceneSamples, { carModel });
}
