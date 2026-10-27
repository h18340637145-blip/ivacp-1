"use client";

import type { AnalysisHistory, ProcessResult, ProcessTask, TicketSnapshot, TicketSource } from "@/domain/entities";
import { latestBy } from "@/domain/issue-source/jira-workflow";
import { createAnalysisHistory } from "@/domain/meegle/lifecycle";
import { db } from "@/shared/db/database";

/** 中断任务的统一提示（页面刷新 / 关闭导致 running 任务失去执行者） */
export const INTERRUPTED_TASK_ERROR = "分析过程中断，请重新分析";

export interface IssueContext {
  snapshot: TicketSnapshot | null;
  task: ProcessTask | null;
  result: ProcessResult | null;
}

export async function loadTicketSnapshots(source: TicketSource, ruleGroupId: string, ticketKey: string): Promise<TicketSnapshot[]> {
  return db.snapshots
    .where("[source+ticketKey]")
    .equals([source, ticketKey])
    .filter((snapshot) => snapshot.ruleGroupId === ruleGroupId)
    .toArray();
}

export async function loadLatestTaskForSnapshot(snapshotId: string): Promise<ProcessTask | null> {
  const tasks = await db.processTasks.where("snapshotId").equals(snapshotId).toArray();
  return latestBy(tasks, (task) => task.createdAt) ?? null;
}

export async function loadResultForTask(taskId: string): Promise<ProcessResult | null> {
  const results = await db.processResults.where("processTaskId").equals(taskId).toArray();
  return latestBy(results, (result) => result.createdAt) ?? null;
}

/**
 * 读取工单最新上下文：最新快照 → 最新任务 → 结果。
 * keepRunning=false 时把残留的 running 任务标记为中断失败（详情页首次加载时使用）。
 */
export async function loadLatestIssueContext(
  source: TicketSource,
  ruleGroupId: string,
  ticketKey: string,
  options: { runningTaskIds?: ReadonlySet<string> } = {},
): Promise<IssueContext> {
  const snapshots = await loadTicketSnapshots(source, ruleGroupId, ticketKey);
  const snapshot = latestBy(snapshots, (item) => item.createdAt) ?? null;
  if (!snapshot) return { snapshot: null, task: null, result: null };

  let task = await loadLatestTaskForSnapshot(snapshot.id);
  if (task?.status === "running" && !options.runningTaskIds?.has(task.id)) {
    task = { ...task, status: "failed", error: INTERRUPTED_TASK_ERROR, completedAt: task.completedAt ?? new Date() };
    await db.processTasks.put(task);
  }
  const result = task?.status === "completed" ? await loadResultForTask(task.id) : null;
  return { snapshot, task, result };
}

export async function loadIssueAnalysisHistories(
  source: TicketSource,
  ruleGroupId: string,
  ticketKey: string,
  excludeResultId?: string,
): Promise<AnalysisHistory[]> {
  const histories = await db.analysisHistories
    .where("[source+ticketKey]")
    .equals([source, ticketKey])
    .filter((history) => history.ruleGroupId === ruleGroupId && history.sourceResultId !== excludeResultId)
    .toArray();
  return histories.sort((a, b) => new Date(b.resultCreatedAt).getTime() - new Date(a.resultCreatedAt).getTime());
}

/** 重新分析前把该工单已完成的结果归档为历史（已归档的跳过） */
export async function archiveIssueAnalysisHistory(source: TicketSource, ruleGroupId: string, ticketKey: string): Promise<void> {
  const tasks = await db.processTasks
    .where("[source+ticketKey]")
    .equals([source, ticketKey])
    .filter((task) => task.ruleGroupId === ruleGroupId && task.status === "completed")
    .toArray();
  if (tasks.length === 0) return;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const results = await db.processResults.where("processTaskId").anyOf([...taskById.keys()]).toArray();
  if (results.length === 0) return;
  const archived = new Set(
    (await db.analysisHistories.where("sourceResultId").anyOf(results.map((result) => result.id)).toArray()).map(
      (history) => history.sourceResultId,
    ),
  );
  const archivedAt = new Date();
  const histories = results.flatMap((result) => {
    const task = taskById.get(result.processTaskId);
    if (!task || archived.has(result.id)) return [];
    return [createAnalysisHistory(task, result, archivedAt)];
  });
  if (histories.length > 0) await db.analysisHistories.bulkPut(histories);
}

/** 启动恢复：把某来源残留的 running 任务标记为中断失败，返回受影响任务 */
export async function recoverInterruptedTasks(source: TicketSource, keepTaskIds: ReadonlySet<string> = new Set()): Promise<ProcessTask[]> {
  const running = await db.processTasks
    .where("status")
    .equals("running")
    .filter((task) => task.source === source && !keepTaskIds.has(task.id))
    .toArray();
  if (running.length === 0) return [];
  const now = new Date();
  const failed = running.map((task) => ({ ...task, status: "failed" as const, error: INTERRUPTED_TASK_ERROR, completedAt: now }));
  await db.processTasks.bulkPut(failed);
  return failed;
}
