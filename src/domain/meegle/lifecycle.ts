import type { AnalysisHistory, ProcessResult, ProcessTask } from "@/domain/entities";

export const MEEGLE_PROCESS_STALE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export function isStaleProcessTask(
  task: Pick<ProcessTask, "status" | "createdAt">,
  now = new Date(),
): boolean {
  return task.status === "running" && now.getTime() - task.createdAt.getTime() >= MEEGLE_PROCESS_STALE_TIMEOUT_MS;
}

export function canBackfillMeegleResult(result: ProcessResult): boolean {
  return result.reviewStatus === "approved" ||
    (result.reviewStatus === "rejected" && Boolean(result.manualCorrectResult?.trim()));
}

export function meegleResultMarker(resultId: string): string {
  return `<!-- analyzer-result:${resultId} -->`;
}

export function applyMeegleAiReview(
  result: ProcessResult,
  verdict: "PASS" | "FAIL",
  reason: string,
  reviewedAt = new Date(),
): ProcessResult {
  return {
    ...result,
    aiReviewVerdict: verdict === "PASS" ? "pass" : "fail",
    aiReviewReason: reason,
    aiReviewedAt: reviewedAt,
  };
}

/** 重新分析前把当前结果归档为历史（Jira 与飞书通用） */
export function createAnalysisHistory(
  task: Pick<ProcessTask, "id">,
  result: ProcessResult,
  archivedAt = new Date(),
): AnalysisHistory {
  return {
    id: `${result.id}:history`,
    source: result.source,
    ticketKey: result.ticketKey,
    ruleGroupId: result.ruleGroupId,
    assignmentId: result.assignmentId,
    sourceSnapshotId: result.snapshotId,
    sourceProcessTaskId: task.id,
    sourceResultId: result.id,
    replyText: result.replyText,
    reviewStatus: result.reviewStatus,
    aiConclusionTime: result.aiConclusionTime,
    manualCorrectResult: result.manualCorrectResult,
    errorReason: result.errorReason,
    errorCategory: result.errorCategory,
    commentStatus: result.commentStatus,
    transitionStatus: result.transitionStatus,
    artifactRef: result.artifactRef,
    resultCreatedAt: result.createdAt,
    archivedAt,
  };
}

export function markMeegleTransitionFailure(result: ProcessResult, error: string): ProcessResult {
  return {
    ...result,
    transitionStatus: "failed",
    transitionError: error,
  };
}
