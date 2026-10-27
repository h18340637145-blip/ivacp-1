"use client";

import type { RuleGroup, TicketSnapshot } from "@/domain/entities";
import type { MeegleTransitionOption } from "@/domain/meegle/contracts";
import { canCommentResult } from "@/domain/issue-source/jira-workflow";
import { completeHandoverFields } from "@/domain/analysis/handover";
import { postJiraComment } from "@/features/jira-workflow/services/jira-api";
import { db } from "@/shared/db/database";
import { apiFetch } from "@/shared/lib/api";
import { errorMessage } from "@/shared/lib/errors";
import { jiraProviderForSnapshot } from "@/domain/issue-source/jira-provider";

export interface BackfillInput { resultId: string; snapshot: TicketSnapshot; body: string; chartImagePath?: string; group?: RuleGroup; transition?: MeegleTransitionOption; retryInterrupted?: boolean }
export const BACKFILL_LOCK_MS = 10 * 60_000;
const inflight = new Map<string, Promise<void>>();

async function execute(input: BackfillInput) {
  let result = await db.transaction("rw", "processResults", async () => {
    const row = await db.processResults.get(input.resultId);
    if (!row) throw new Error("未找到分析结果");
    if (row.snapshotId !== input.snapshot.id || row.source !== input.snapshot.source || row.ticketKey !== input.snapshot.ticketKey) throw new Error("分析结果与工单上下文不一致");
    if (row.commentStatus !== "succeeded" && (!canCommentResult(row) || (row.source === "meegle" && !row.manualReviewedAt))) throw new Error("请先完成人工复核，驳回时必须填写正确结论");
    if (!input.body.trim()) throw new Error("回填正文不能为空");
    if (row.source === "jira") jiraProviderForSnapshot(input.snapshot, input.group);
    if (row.source === "meegle" && (!input.snapshot.projectKey || input.snapshot.workItemTypeKey !== "issue" || !row.analysisReceipt)) throw new Error("缺少飞书工单身份或分析凭据，请重新分析");
    if (row.commentStatus === "commenting" || row.commentStatus === "uploading") {
      const active = row.commentStartedAt && Date.now() - row.commentStartedAt.getTime() < BACKFILL_LOCK_MS;
      if (!input.retryInterrupted || active) throw new Error("其他页面正在回填；若已中断，请核对原票后再确认重试");
    }
    if (row.commentStatus !== "succeeded") await db.processResults.update(row.id, { commentStatus: "commenting", commentStartedAt: new Date(), commentError: undefined });
    return row;
  });
  const identity = { projectKey: input.snapshot.projectKey, workItemTypeKey: input.snapshot.workItemTypeKey, workItemId: result.ticketKey };
  if (result.commentStatus !== "succeeded") {
    try {
      let commentId: string | undefined;
      if (result.source === "jira") {
        ({ commentId } = await postJiraComment({ issueKey: result.ticketKey, body: input.body, chartImagePath: input.chartImagePath, jiraProvider: jiraProviderForSnapshot(input.snapshot, input.group) }));
      } else {
        const claims = { action: "comment", ...identity, resultId: result.id, body: input.body, chartImagePath: input.chartImagePath, artifactRef: result.artifactRef, analysisReceipt: result.analysisReceipt };
        const { authorization } = await apiFetch<{ authorization: string }>("/api/meegle/authorize", { method: "POST", json: claims });
        const posted = await apiFetch<{ success: boolean; commentId?: string; error?: string }>("/api/meegle/comment", { method: "POST", json: { ...claims, authorization } });
        if (!posted.success) throw new Error(posted.error ?? "回填失败");
        commentId = posted.commentId;
      }
      const commentedAt = new Date();
      await db.processResults.update(result.id, { commentStatus: "succeeded", commentId, commentedAt, commentError: undefined, ...completeHandoverFields(result.handoverAt, commentedAt) });
    } catch (error) {
      await db.processResults.update(result.id, { commentStatus: "failed", commentError: errorMessage(error) });
      throw error;
    }
  }
  result = (await db.processResults.get(result.id))!;
  if (result.source === "meegle" && input.transition && result.transitionStatus !== "succeeded") {
    const transitionId = String(input.transition.id);
    await db.processResults.update(result.id, { transitionStatus: "pending", transitionId, transitionName: input.transition.state_name, transitionError: undefined });
    try {
      const claims = { action: "transition", ...identity, resultId: result.id, transitionId, analysisReceipt: result.analysisReceipt };
      const { authorization } = await apiFetch<{ authorization: string }>("/api/meegle/authorize", { method: "POST", json: claims });
      await apiFetch("/api/meegle/workflow", { method: "POST", json: { ...claims, authorization } });
      await db.processResults.update(result.id, { transitionStatus: "succeeded", transitionedAt: new Date(), transitionError: undefined });
    } catch (error) {
      await db.processResults.update(result.id, { transitionStatus: "failed", transitionError: errorMessage(error) });
      throw new Error(`评论已回填，状态流转失败：${errorMessage(error)}`);
    }
  }
}

export function backfillResult(input: BackfillInput): Promise<void> {
  const existing = inflight.get(input.resultId);
  if (existing) return existing;
  const promise = execute(input).finally(() => inflight.delete(input.resultId));
  inflight.set(input.resultId, promise);
  return promise;
}
