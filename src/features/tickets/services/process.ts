"use client";

import type { ProcessTask, RuleGroup, TicketSnapshot } from "@/domain/entities";
import type { ProcessResponse } from "@/domain/analysis/process-contracts";
import { detectCarModelFromSummary } from "@/domain/issue-source/jira-workflow";
import { buildMeegleWorkItemUrl } from "@/domain/meegle/work-item-url";
import { isStaleProcessTask } from "@/domain/meegle/lifecycle";
import { jiraProviderForSnapshot } from "@/domain/issue-source/jira-provider";
import { db } from "@/shared/db/database";
import { apiFetch } from "@/shared/lib/api";
import { errorMessage } from "@/shared/lib/errors";
import { createLimiter, CLIENT_CONCURRENCY } from "@/shared/lib/concurrency";
import { fetchJiraHandoverAt } from "@/features/jira-workflow/services/jira-api";
import { fetchErrorPatterns, fetchFewShotSamples } from "./few-shot";
import { beginProcessAttempt, failProcessAttempt, forceFailTicket, finishProcessAttempt } from "./process-repository";
import { notifyFeishuProcessResultSafely } from "./process-result-notify";
import { runValidation } from "./validation";

const active = new Map<string, Promise<ProcessTask | undefined>>();
const controllers = new Map<string, AbortController>();
const schedule = createLimiter(CLIENT_CONCURRENCY);

async function executeProcess(input: TicketSnapshot, group: RuleGroup, reanalyze: boolean) {
  const { task, snapshot, started } = await beginProcessAttempt(input, group, reanalyze);
  if (!started) return task;
  const controller = new AbortController();
  controllers.set(task.id, controller);
  const notify = { source: task.source, ruleGroupName: group.name, issueKey: snapshot.ticketKey, issueSummary: snapshot.title,
    issueUrl: snapshot.projectKey && snapshot.workItemTypeKey && snapshot.workItemId ? buildMeegleWorkItemUrl({ projectKey: snapshot.projectKey, workItemTypeKey: snapshot.workItemTypeKey, workItemId: snapshot.workItemId }) : undefined };
  try {
    let rawData = snapshot.rawData;
    if (snapshot.source === "meegle") {
      const context = await apiFetch<{ rawData: Record<string, unknown> }>("/api/meegle/context", { method: "POST", signal: controller.signal,
        json: { projectKey: snapshot.projectKey, workItemTypeKey: snapshot.workItemTypeKey, workItemId: snapshot.ticketKey } });
      rawData = { ...context.rawData, source: "meegle", projectKey: snapshot.projectKey, workItemTypeKey: snapshot.workItemTypeKey, workItemId: snapshot.ticketKey };
      await db.snapshots.update(snapshot.id, { rawData });
    }
    if (controller.signal.aborted) throw new Error("分析已停止");
    const carModel = detectCarModelFromSummary(snapshot.title, group.model_to_files);
    const [fewShotSamples, errorPatterns] = await Promise.all([
      fetchFewShotSamples({ source: snapshot.source, ruleGroupId: group.id, ticketKey: snapshot.ticketKey, issueSummary: snapshot.title, currentEvidence: { carModel, props: [], signalTokens: [], propertyIds: [] } }),
      fetchErrorPatterns(group.id, carModel, snapshot.title),
    ]);
    await db.processTasks.update(task.id, { stage: "ANALYZING" });
    const data = await apiFetch<ProcessResponse & { handoverAt?: string }>("/api/issues/process", { method: "POST", signal: controller.signal,
      json: { issueKey: snapshot.source === "meegle" ? `meegle-${snapshot.ticketKey}` : snapshot.ticketKey, summary: snapshot.title,
        rawData, source: snapshot.source, runId: task.id, ruleGroupId: group.id, ruleGroupName: group.name, prompts: group.prompts,
        basePaths: group.base_paths, modelToFiles: group.model_to_files, expand: group.expand, jiraProvider: snapshot.source === "jira" ? jiraProviderForSnapshot(snapshot, group) : undefined, fewShotSamples, errorPatterns } });
    if (snapshot.source === "jira") {
      const handover = await fetchJiraHandoverAt(snapshot.ticketKey, jiraProviderForSnapshot(snapshot, group));
      if (handover) data.handoverAt = handover.toISOString();
    }
    const result = await finishProcessAttempt(task, data);
    if (result) {
      await notifyFeishuProcessResultSafely({ ...notify, status: "success", replyText: result.replyText, chartImagePath: result.chartImage, issueDescription: String(rawData.description ?? "") });
      await runValidation(result).catch((error) => console.warn(`[Validation] ${task.id}: ${errorMessage(error)}`));
    }
  } catch (error) {
    const message = controller.signal.aborted ? "分析已停止" : errorMessage(error);
    await failProcessAttempt(task, message);
    await notifyFeishuProcessResultSafely({ ...notify, status: "failed", failureReason: message });
  } finally { controllers.delete(task.id); }
  return db.processTasks.get(task.id);
}

export function processTicket(snapshot: TicketSnapshot, group: RuleGroup, options: { reanalyze?: boolean; shouldStart?: () => Promise<boolean> } = {}): Promise<ProcessTask | undefined> {
  const key = JSON.stringify([group.id, snapshot.source, snapshot.projectKey, snapshot.workItemTypeKey, snapshot.ticketKey, snapshot.source === "jira" ? snapshot.jiraProvider ?? group.jiraProvider ?? "default" : undefined]);
  const pending = active.get(key);
  if (pending) return pending;
  const promise = schedule(async () => {
    if (options.shouldStart && !(await options.shouldStart())) return;
    return executeProcess(snapshot, group, Boolean(options.reanalyze));
  }).finally(() => active.delete(key));
  active.set(key, promise);
  return promise;
}

function runIdentity(task: ProcessTask, snapshot: TicketSnapshot, group: RuleGroup) {
  return { runId: task.id, issueKey: `meegle-${task.ticketKey}`, projectKey: snapshot.projectKey, workItemTypeKey: snapshot.workItemTypeKey, workItemId: task.ticketKey, ruleGroupName: group.name };
}

export async function stopProcess(task: ProcessTask | undefined, snapshot: TicketSnapshot, group: RuleGroup) {
  if (task?.status === "running") {
    if (task.source === "meegle") await apiFetch("/api/meegle/cancel", { method: "POST", json: runIdentity(task, snapshot, group) }).catch((error) => console.warn(`[Stop] ${task.id}: ${errorMessage(error)}`));
    controllers.get(task.id)?.abort();
    await failProcessAttempt(task, "分析已停止");
  }
  await forceFailTicket(snapshot, group, "分析已手动停止");
}

export async function recoverPendingProcesses() {
  const tasks = await db.processTasks.where("status").equals("running").toArray();
  await Promise.all(tasks.filter((task) => !controllers.has(task.id)).map(async (task) => {
    if (task.source === "jira") {
      if (isStaleProcessTask(task)) await failProcessAttempt(task, "分析已中断，超过 2 小时未完成，请重新分析");
      return;
    }
    const [snapshot, group] = await Promise.all([db.snapshots.get(task.snapshotId), db.ruleGroups.get(task.ruleGroupId)]);
    if (!snapshot || !group) return;
    try {
      const data = await apiFetch<ProcessResponse & { recoverable?: boolean; handoverAt?: string }>("/api/meegle/recover", { method: "POST", json: runIdentity(task, snapshot, group) });
      if (data.recoverable === false) {
        if (isStaleProcessTask(task)) await failProcessAttempt(task, "分析已中断，超过 2 小时未生成完整可恢复结果");
      } else if (data.replyText && data.artifactRef && data.analysisReceipt) await finishProcessAttempt(task, data);
    } catch (error) { console.warn(`[Recovery] ${task.id}: ${errorMessage(error)}`); }
  }));
}
