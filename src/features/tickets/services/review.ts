"use client";

import { detectIssueScene, filterBySameScene } from "@/domain/analysis/issue-scene";
import {
  formatRejectReason,
  validateRejectInput,
  type RejectReasonCode,
} from "@/domain/analysis/reject-reasons";
import { buildReviewSample, normalizeReviewSampleKind } from "@/domain/analysis/review-sample";
import type { ProcessResult, ReviewSample } from "@/domain/entities";
import { buildReviewAnalysisContext } from "@/domain/issue-source/jira-workflow";
import { db } from "@/shared/db/database";
import { apiFetch } from "@/shared/lib/api";
import { newId } from "@/shared/lib/ids";

/**
 * 复核服务（Jira / 飞书通用，入参是统一的 ProcessResult）：
 * 人工通过 → 写入正确样本；人工驳回 → 写入纠错样本 + 学习记忆；AI 复核 → /api/issues/review。
 */

export interface ReviewTarget {
  result: ProcessResult;
  ruleGroupName?: string;
  issueSummary: string;
  /** 工单原始数据（description / comments），用于 AI 复核上下文 */
  rawData?: Record<string, unknown>;
}

async function loadTicketSamples(result: ProcessResult): Promise<ReviewSample[]> {
  return db.reviewSamples
    .where("[source+ticketKey]")
    .equals([result.source, result.ticketKey])
    .filter((sample) => sample.ruleGroupId === result.ruleGroupId)
    .toArray();
}

async function reloadResult(id: string, fallback: ProcessResult): Promise<ProcessResult> {
  return (await db.processResults.get(id)) ?? fallback;
}

export async function approveResult(target: ReviewTarget): Promise<ProcessResult> {
  const { result } = target;
  const existingSamples = await loadTicketSamples(result);
  const sample = buildReviewSample({
    existing: existingSamples[0],
    id: newId(),
    ruleGroupId: result.ruleGroupId,
    ruleGroupName: target.ruleGroupName,
    source: result.source,
    ticketKey: result.ticketKey,
    issueSummary: target.issueSummary,
    sampleKind: "approved",
    aiConclusion: result.replyText,
    reviewEvidence: result.reviewEvidence,
    signalSummary: result.signalSummary,
  });
  const now = new Date();
  await db.transaction("rw", [db.processResults, db.reviewSamples, db.learningMemories], async () => {
    await db.processResults.update(result.id, {
      reviewStatus: "approved",
      manualReviewedAt: now,
      manualCorrectResult: undefined,
      errorReason: undefined,
      errorCategory: undefined,
    });
    const duplicateIds = existingSamples.map(({ id }) => id).filter((id) => id !== sample.id);
    if (duplicateIds.length > 0) await db.reviewSamples.bulkDelete(duplicateIds);
    await db.reviewSamples.put(sample);
    await db.learningMemories
      .where("[ruleGroupId+memoryKey]")
      .equals([result.ruleGroupId, result.ticketKey])
      .delete();
  });
  return reloadResult(result.id, {
    ...result,
    reviewStatus: "approved",
    manualReviewedAt: now,
    manualCorrectResult: undefined,
    errorReason: undefined,
    errorCategory: undefined,
  });
}

export interface RejectInput {
  category: RejectReasonCode | undefined;
  /** 补充说明（“其他”类型必填） */
  detail: string;
  correctResult: string;
}

export async function rejectResult(target: ReviewTarget, input: RejectInput): Promise<ProcessResult> {
  const { result } = target;
  const checked = validateRejectInput(input);
  const errorCategory = checked.category;
  const correctResult = checked.correctResult;
  const errorReason = formatRejectReason(errorCategory, checked.detail);
  const existingSamples = await loadTicketSamples(result);
  const sample = buildReviewSample({
    existing: existingSamples[0],
    id: newId(),
    ruleGroupId: result.ruleGroupId,
    ruleGroupName: target.ruleGroupName,
    source: result.source,
    ticketKey: result.ticketKey,
    issueSummary: target.issueSummary,
    sampleKind: "correction",
    aiConclusion: result.replyText,
    correctConclusion: correctResult,
    errorReason,
    errorCategory,
    reviewEvidence: result.reviewEvidence,
    signalSummary: result.signalSummary,
  });
  const content = JSON.stringify({
    errorReason,
    errorCategory,
    correctResult,
    issueSummary: target.issueSummary,
    wrongConclusion: result.replyText,
    evidenceFingerprintText: sample.evidenceFingerprintText,
  });
  const now = new Date();
  await db.transaction("rw", [db.processResults, db.reviewSamples, db.learningMemories], async () => {
    await db.processResults.update(result.id, {
      reviewStatus: "rejected",
      manualReviewedAt: now,
      errorReason,
      errorCategory,
      manualCorrectResult: correctResult,
    });
    const duplicateIds = existingSamples.map(({ id }) => id).filter((id) => id !== sample.id);
    if (duplicateIds.length > 0) await db.reviewSamples.bulkDelete(duplicateIds);
    await db.reviewSamples.put(sample);
    const memory = await db.learningMemories
      .where("[ruleGroupId+memoryKey]")
      .equals([result.ruleGroupId, result.ticketKey])
      .first();
    await db.learningMemories.put({
      id: memory?.id ?? newId(),
      ruleGroupId: result.ruleGroupId,
      memoryKey: result.ticketKey,
      content,
      updatedAt: now,
    });
  });
  return reloadResult(result.id, {
    ...result,
    reviewStatus: "rejected",
    manualReviewedAt: now,
    errorReason,
    errorCategory,
    manualCorrectResult: correctResult,
  });
}

/** AI 复核：飞书只保存建议，保留人工复核门禁；Jira 沿用原 AI 复核状态。 */
export async function aiReviewResult(target: ReviewTarget): Promise<ProcessResult> {
  const { result } = target;
  const samples = await db.reviewSamples.where("ruleGroupId").equals(result.ruleGroupId).toArray();
  samples.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const fewShot = filterBySameScene(detectIssueScene(target.issueSummary), samples, (sample) => sample.issueSummary)
    .filter((sample) => normalizeReviewSampleKind(sample) === "correction")
    .slice(0, 3)
    .map((sample) => ({
      wrongConclusion: sample.wrongConclusion,
      correctConclusion: sample.correctConclusion,
      errorReason: sample.errorReason,
    }));

  const data = await apiFetch<{ verdict?: string; reason?: string }>("/api/issues/review", {
    method: "POST",
    json: {
      conclusion: result.replyText,
      issueSummary: target.issueSummary,
      issueKey: result.source === "meegle" ? `meegle-${result.ticketKey}` : result.ticketKey,
      runId: result.source === "jira" ? result.analysisRunId : undefined,
      artifactRef: result.source === "meegle" ? result.artifactRef : undefined,
      ruleGroupId: result.ruleGroupId,
      ruleGroupName: result.source === "jira" && result.analysisRunId ? result.analysisGroupName ?? target.ruleGroupName : target.ruleGroupName,
      analysisContext: buildReviewAnalysisContext(target.rawData ?? {}, result.signalSummary),
      samples: fewShot,
    },
  });
  if (data?.verdict !== "PASS" && data?.verdict !== "FAIL") throw new Error("AI 复核响应未给出有效判定");
  const failed = data.verdict === "FAIL";
  const patch: Partial<ProcessResult> = {
    ...(result.source === "jira" ? { reviewStatus: failed ? "rejected" as const : "approved" as const } : {}),
    aiReviewVerdict: failed ? "fail" : "pass",
    aiReviewReason: data?.reason,
    aiReviewedAt: new Date(),
  };
  await db.processResults.update(result.id, patch);
  return reloadResult(result.id, { ...result, ...patch });
}
