import type { FewShotSample } from "@/domain/analysis/process-contracts";
import { buildEvidenceFingerprintText } from "@/domain/analysis/evidence-fingerprint";
import { effectiveRejectReasonCode } from "@/domain/analysis/reject-reasons";
import { normalizeReviewSampleKind } from "@/domain/analysis/review-sample";
import type { ReviewSample } from "@/domain/entities";

/** few-shot 召回阈值：embedding 余弦相似度 / 标题词重叠率（embedding 不可用时回退） */
export const EMBEDDING_SCORE_THRESHOLD = 0.45;
export const TITLE_SCORE_THRESHOLD = 0.3;
const FEW_SHOT_TEXT_LIMIT = 2000;

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, " ").split(/\s+/).filter(Boolean);
}

/** 词重叠率：共享词数 / 较长一方的词数 */
export function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) if (tokensB.has(token)) overlap += 1;
  return overlap / Math.max(tokensA.size, tokensB.size);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

type EmbeddingSampleFields = Pick<
  ReviewSample,
  | "issueSummary"
  | "approvedConclusion"
  | "wrongConclusion"
  | "correctConclusion"
  | "errorReason"
  | "evidenceFingerprintText"
  | "props"
  | "signalTokens"
  | "propertyIds"
  | "carModel"
>;

/** 样本向量化文本：证据指纹 + 错误原因 + 结论片段 */
export function buildSampleEmbeddingText(sample: EmbeddingSampleFields): string {
  const fingerprintText =
    sample.evidenceFingerprintText ||
    buildEvidenceFingerprintText({
      issueSummary: sample.issueSummary,
      carModel: sample.carModel,
      props: sample.props ?? [],
      signalTokens: sample.signalTokens ?? [],
      propertyIds: sample.propertyIds ?? [],
    });
  return [
    fingerprintText,
    sample.errorReason ? `错误原因：${sample.errorReason}` : "",
    sample.wrongConclusion ? `错误结论：${sample.wrongConclusion.slice(0, 500)}` : "",
    sample.correctConclusion ? `正确结论：${sample.correctConclusion.slice(0, 500)}` : "",
    sample.approvedConclusion ? `人工确认结论：${sample.approvedConclusion.slice(0, 500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 复核样本 → /api/issues/process 的 few-shot 载荷（issueKey 为旧字段名） */
export function toFewShotSample(sample: ReviewSample, relevanceScore: number): FewShotSample {
  const kind = normalizeReviewSampleKind(sample);
  return {
    issueKey: sample.ticketKey,
    ticketKey: sample.ticketKey,
    issueSummary: sample.issueSummary ?? "",
    sampleKind: kind,
    approvedConclusion: sample.approvedConclusion?.slice(0, FEW_SHOT_TEXT_LIMIT),
    wrongConclusion: sample.wrongConclusion.slice(0, FEW_SHOT_TEXT_LIMIT),
    correctConclusion: sample.correctConclusion.slice(0, FEW_SHOT_TEXT_LIMIT),
    errorReason: sample.errorReason,
    errorCategory: kind === "correction" ? effectiveRejectReasonCode(sample) : undefined,
    carModel: sample.carModel,
    props: sample.props ?? [],
    signalTokens: sample.signalTokens ?? [],
    propertyIds: sample.propertyIds ?? [],
    relevanceScore,
  };
}
