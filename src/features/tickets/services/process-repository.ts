"use client";

import type { ProcessResult, ProcessTask, RuleGroup, TicketSnapshot } from "@/domain/entities";
import type { ProcessResponse } from "@/domain/analysis/process-contracts";
import { completeHandoverFields } from "@/domain/analysis/handover";
import { createAnalysisHistory, isStaleProcessTask } from "@/domain/meegle/lifecycle";
import { db } from "@/shared/db/database";
import { newId } from "@/shared/lib/ids";

/** 创建 task 前锁住相同工单；重跑仅归档，不删除原 result。 */
export async function beginProcessAttempt(input: TicketSnapshot, group: RuleGroup, reanalyze: boolean) {
  return db.transaction("rw", ["processTasks", "processResults", "snapshots", "assignments", "analysisHistories"], async () => {
    let assignment = input.source === "meegle" ? await db.assignments.where("ticketKey").equals(input.ticketKey)
      .filter((row) => row.projectKey === input.projectKey && row.workItemTypeKey === input.workItemTypeKey && row.ruleGroupId === group.id).first() : undefined;
    if (input.source === "meegle" && !assignment) throw new Error("工作项当前未归属此规则组，请重新筛票");
    if (assignment?.status === "processing" && assignment.latestAttemptTaskId) {
      const active = await db.processTasks.get(assignment.latestAttemptTaskId);
      if (active?.status === "running" && !isStaleProcessTask(active)) return { task: active, snapshot: input, started: false };
    }
    const tasks = (await db.processTasks.where("[source+ticketKey]").equals([input.source, input.ticketKey])
      .filter((row) => row.ruleGroupId === group.id && (!assignment || row.assignmentId === assignment.id)).toArray()).sort((a, b) => +b.createdAt - +a.createdAt);
    const latest = tasks[0];
    if (latest?.status === "running" && !isStaleProcessTask(latest)) return { task: latest, snapshot: input, started: false };
    if (!reanalyze && latest?.status === "completed") return { task: latest, snapshot: input, started: false };
    if (latest?.status === "running") await db.processTasks.update(latest.id, { status: "failed", error: "已由新的分析运行替代", completedAt: new Date() });
    const oldResults = await db.processResults.where("[source+ticketKey]").equals([input.source, input.ticketKey])
      .filter((row) => row.ruleGroupId === group.id && (!assignment || row.assignmentId === assignment.id)).toArray();
    for (const result of oldResults) {
      const oldTask = await db.processTasks.get(result.processTaskId);
      if (oldTask && !(await db.analysisHistories.get(`${result.id}:history`))) await db.analysisHistories.put(createAnalysisHistory(oldTask, result));
    }
    const now = new Date(Math.max(Date.now(), +(latest?.createdAt ?? 0) + 1));
    const snapshot: TicketSnapshot = { ...input, id: newId(), origin: "process", filterRunId: undefined, assignmentId: assignment?.id, createdAt: now,
      ...(input.source === "jira" ? { jiraProvider: input.jiraProvider ?? group.jiraProvider ?? "default" } : {}) };
    const task: ProcessTask = { id: newId(), source: input.source, ticketKey: input.ticketKey, snapshotId: snapshot.id, ruleGroupId: group.id,
      assignmentId: assignment?.id, status: "running", stage: input.source === "meegle" ? "FETCHING_CONTEXT" : "PREPARING", createdAt: now };
    await db.snapshots.add(snapshot);
    await db.processTasks.add(task);
    if (assignment) {
      assignment = { ...assignment, status: "processing", processingStartedAt: now, latestAttemptTaskId: task.id, error: undefined };
      await db.assignments.put(assignment);
    }
    return { task, snapshot, started: true };
  });
}

export async function finishProcessAttempt(task: ProcessTask, data: ProcessResponse & { handoverAt?: string }): Promise<ProcessResult | undefined> {
  if (!data.replyText?.trim()) throw new Error("分析接口未返回完整结论");
  if (task.source === "meegle" && (!data.artifactRef || !data.analysisReceipt)) throw new Error("飞书分析缺少可恢复产物与回填凭据");
  return db.transaction("rw", ["processTasks", "processResults", "assignments"], async () => {
    const current = await db.processTasks.get(task.id);
    if (!current || current.status !== "running") return undefined;
    const latest = (await db.processTasks.where("[source+ticketKey]").equals([task.source, task.ticketKey])
      .filter((row) => row.ruleGroupId === task.ruleGroupId && row.assignmentId === task.assignmentId).toArray()).sort((a, b) => +b.createdAt - +a.createdAt)[0];
    if (latest?.id !== task.id) return undefined;
    const assignment = task.assignmentId ? await db.assignments.get(task.assignmentId) : undefined;
    if (assignment?.ruleGroupId === task.ruleGroupId && assignment.latestAttemptTaskId !== task.id) return undefined;
    const now = new Date();
    const result: ProcessResult = { id: newId(), source: task.source, ticketKey: task.ticketKey, ruleGroupId: task.ruleGroupId,
      processTaskId: task.id, snapshotId: task.snapshotId, assignmentId: task.assignmentId,
      replyText: data.replyText, model: data.model, chartImage: data.chartImage, signalSummary: data.signalSummary,
      reviewEvidence: data.reviewEvidence, traceData: data.traceData, ticks: data.ticks, artifactRef: data.artifactRef,
      analysisReceipt: data.analysisReceipt, tokenUsage: data.tokenUsage, reviewStatus: "pending", commentStatus: "not_started", transitionStatus: "not_selected",
      ...completeHandoverFields(data.handoverAt ? new Date(data.handoverAt) : undefined, now), createdAt: now };
    await db.processResults.add(result);
    await db.processTasks.put({ ...current, status: "completed", stage: "SAVING_RESULT", stages: data.stages, elapsedMs: data.elapsedMs, mode: data.mode, completedAt: now, error: undefined });
    if (assignment?.latestAttemptTaskId === task.id && assignment.ruleGroupId === task.ruleGroupId) await db.assignments.update(assignment.id, { status: "completed", latestTaskId: task.id, latestResultId: result.id, error: undefined, completedAt: now });
    return result;
  });
}

export async function failProcessAttempt(task: ProcessTask, error: string) {
  await db.transaction("rw", ["processTasks", "assignments"], async () => {
    const current = await db.processTasks.get(task.id);
    if (!current || current.status !== "running") return;
    const completedAt = new Date();
    await db.processTasks.update(task.id, { status: "failed", error, completedAt });
    const assignment = task.assignmentId ? await db.assignments.get(task.assignmentId) : undefined;
    if (assignment?.latestAttemptTaskId === task.id && assignment.ruleGroupId === task.ruleGroupId) await db.assignments.update(assignment.id, { status: "failed", error, completedAt });
  });
}
