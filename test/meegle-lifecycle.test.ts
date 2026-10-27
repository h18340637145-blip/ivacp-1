import { describe, expect, it } from "vitest";
import type { ProcessResult, ProcessTask } from "@/domain/entities";
import {
  applyMeegleAiReview,
  canBackfillMeegleResult,
  createAnalysisHistory,
  isStaleProcessTask,
  markMeegleTransitionFailure,
} from "@/domain/meegle/lifecycle";
import { buildMeegleCommentAddArgs, buildMeegleCommentContent } from "@/server/meegle/comment";
import {
  createMeegleAnalysisReceipt,
  createMeegleWriteAuthorization,
  verifyMeegleAnalysisReceipt,
  verifyMeegleWriteAuthorization,
} from "@/server/meegle/write-authorization";

const createdAt = new Date("2026-08-07T10:00:00Z");
const result: ProcessResult = {
  id: "result-1",
  source: "meegle",
  ticketKey: "7067629186",
  ruleGroupId: "group-1",
  processTaskId: "task-1",
  snapshotId: "snapshot-1",
  assignmentId: "assignment-1",
  replyText: "AI conclusion",
  reviewStatus: "pending",
  aiReviewVerdict: "pass",
  commentStatus: "not_started",
  transitionStatus: "not_selected",
  createdAt,
};
const task: ProcessTask = {
  id: "task-1",
  source: "meegle",
  ticketKey: "7067629186",
  snapshotId: "snapshot-1",
  assignmentId: "assignment-1",
  ruleGroupId: "group-1",
  status: "completed",
  createdAt,
};

describe("飞书处理生命周期", () => {
  it("陈旧处理中任务判定", () => {
    const runningTask = { ...task, status: "running" as const };
    expect(isStaleProcessTask(runningTask, new Date("2026-08-07T11:59:59Z"))).toBe(false);
    expect(isStaleProcessTask(runningTask, new Date("2026-08-07T12:00:00Z"))).toBe(true);
    expect(isStaleProcessTask({ ...runningTask, status: "completed" }, new Date("2026-08-08T12:00:00Z"))).toBe(false);
  });

  it("AI 复核建议不能解锁回填，人工通过或驳回并给出正确结论才可回填", () => {
    expect(canBackfillMeegleResult(result)).toBe(false);
    expect(canBackfillMeegleResult({ ...result, reviewStatus: "approved" })).toBe(true);
    expect(canBackfillMeegleResult({ ...result, reviewStatus: "rejected", manualCorrectResult: "" })).toBe(false);
    expect(canBackfillMeegleResult({ ...result, reviewStatus: "rejected", manualCorrectResult: "correct" })).toBe(true);
  });

  it("AI 复核不改变人工复核门禁", () => {
    const aiReviewed = applyMeegleAiReview(result, "FAIL", "evidence conflict", new Date("2026-08-07T10:30:00Z"));
    expect(aiReviewed.reviewStatus).toBe("pending");
    expect(aiReviewed.aiReviewVerdict).toBe("fail");
    expect(aiReviewed.aiReviewReason).toBe("evidence conflict");
    expect(aiReviewed.aiReviewedAt?.toISOString()).toBe("2026-08-07T10:30:00.000Z");
  });

  it("归档历史与流转失败标记", () => {
    const history = createAnalysisHistory(task, result, new Date("2026-08-07T11:00:00Z"));
    expect(history.id).toBe("result-1:history");
    expect(history.sourceResultId).toBe("result-1");
    expect(history.ticketKey).toBe("7067629186");
    expect(history.artifactRef).toBe(result.artifactRef);

    const partial = markMeegleTransitionFailure({ ...result, commentStatus: "succeeded", commentId: "comment-1" }, "transition rejected");
    expect(partial.commentStatus).toBe("succeeded");
    expect(partial.commentId).toBe("comment-1");
    expect(partial.transitionStatus).toBe("failed");
    expect(partial.transitionError).toBe("transition rejected");
  });
});

describe("飞书评论回填", () => {
  it("评论内容包含图片与结果标记，多行 Markdown 走 JSON params 通道", () => {
    const content = buildMeegleCommentContent("analysis", "result-1", { url: "https://project.feishu.cn/image.png", fileToken: "token-1" });
    expect(content).toMatch(/analysis/);
    expect(content).toMatch(/!\[CAN 信号时序图\]\(https:\/\/project\.feishu\.cn\/image\.png\)<!--token-1-->/);
    expect(content).toMatch(/<!-- analyzer-result:result-1 -->$/);

    const args = buildMeegleCommentAddArgs("project-1", "7067629186", content, "token-1");
    expect(args.slice(0, 3)).toEqual(["comment", "add", "--params"]);
    expect(args.includes("--content")).toBe(false);
    expect(JSON.parse(args[3] ?? "")).toEqual({
      project_key: "project-1",
      work_item_id: "7067629186",
      content,
      file_token: "token-1",
    });
  });

  it("分析凭据与评论写授权绑定工作项与内容", () => {
    const receiptClaims = { projectKey: "project-1", workItemTypeKey: "issue" as const, workItemId: "7067629186", artifactRef: "artifact-1" };
    const analysisReceipt = createMeegleAnalysisReceipt(receiptClaims);
    expect(() => verifyMeegleAnalysisReceipt(analysisReceipt, receiptClaims)).not.toThrow();
    expect(() => verifyMeegleAnalysisReceipt(analysisReceipt, { ...receiptClaims, projectKey: "project-2" })).toThrow();

    const writeClaims = {
      action: "comment" as const,
      projectKey: "project-1",
      workItemTypeKey: "issue" as const,
      workItemId: "7067629186",
      resultId: "result-1",
      body: "approved conclusion",
      artifactRef: "artifact-1",
      analysisReceipt,
    };
    const authorization = createMeegleWriteAuthorization(writeClaims);
    expect(() => verifyMeegleWriteAuthorization(authorization, writeClaims)).not.toThrow();
    expect(() => verifyMeegleWriteAuthorization(authorization, { ...writeClaims, body: "changed conclusion" })).toThrow();
  });
});
