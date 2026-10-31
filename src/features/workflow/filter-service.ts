"use client";

import type { FilterAudit, FilterRun, RuleGroup, TicketSnapshot, TicketSource } from "@/domain/entities";
import { getConfiguredSources, type RuleGroupSourceSummary } from "@/domain/issue-source/contracts";
import { buildSourceSummary, filterRunTimeoutMs } from "@/domain/issue-source/jira-workflow";
import { buildMeegleFilterSnapshots, latestFilterRun, meegleFilterIssueIdentityKey, meegleProjectKeyFromMql } from "@/domain/meegle/filter-results";
import { parseMeegleFilterResponse } from "@/domain/meegle/filter-response";
import { fetchJiraIssues } from "@/features/jira-workflow/services/jira-api";
import { db } from "@/shared/db/database";
import { apiFetch } from "@/shared/lib/api";
import { errorMessage } from "@/shared/lib/errors";
import { commitFilterRun, failFilterRun, startFilterRun } from "./filter-repository";

export interface RuleGroupFilters {
  summary: RuleGroupSourceSummary;
  latest: Partial<Record<TicketSource, FilterRun>>;
  snapshots: Record<TicketSource, TicketSnapshot[]>;
}

export async function loadRuleGroupFilters(group: RuleGroup): Promise<RuleGroupFilters> {
  const runs = await db.filterRuns.where("ruleGroupId").equals(group.id).toArray();
  const latest = { jira: latestFilterRun(runs.filter((run) => run.source === "jira")), meegle: latestFilterRun(runs.filter((run) => run.source === "meegle")) };
  const summary = buildSourceSummary(group, latest);
  const entries = await Promise.all((["jira", "meegle"] as const).map(async (source) => [source,
    summary[source].configured && latest[source]?.status === "completed" ? await db.snapshots.where("filterRunId").equals(latest[source]!.id).filter((row) => row.origin === "filter").toArray() : [],
  ] as const));
  const owned = new Set((await db.assignments.where("ruleGroupId").equals(group.id).toArray()).map(meegleFilterIssueIdentityKey));
  const meegle = entries[1][1].filter((row) => row.projectKey && row.workItemTypeKey && row.workItemId
    && owned.has(meegleFilterIssueIdentityKey({ projectKey: row.projectKey, workItemTypeKey: row.workItemTypeKey, workItemId: row.workItemId })));
  if (summary.meegle.status === "completed") summary.meegle.issueCount = meegle.length;
  return { summary, latest, snapshots: { jira: entries[0][1], meegle } };
}

/** Abort must also settle callers when a fetch/body reader ignores cancellation. */
function settleOnAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("筛票任务超时"));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    if (signal.aborted) aborted();
  });
}

async function filterSource(group: RuleGroup, groups: RuleGroup[], source: TicketSource): Promise<void> {
  let projectKey = source === "meegle" ? meegleProjectKeyFromMql(group.meegleMql ?? "") : undefined;
  const { run, started } = await startFilterRun(group, source, projectKey);
  if (!started) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("筛票任务超时，请重新筛选")), filterRunTimeoutMs(source));
  let audits: FilterAudit[] = [];
  try {
    await settleOnAbort((async () => {
    if (source === "jira") {
      const { issues } = await fetchJiraIssues(group.jql, group.jiraProvider, controller.signal);
      if (!Array.isArray(issues)) throw new Error("Jira 筛票响应格式无效");
      const snapshots = [...new Map(issues.map((issue) => [issue.key, issue])).values()].map((issue): TicketSnapshot => ({
        id: `${run.id}:${issue.key}`, source, jiraProvider: group.jiraProvider ?? "default", ticketKey: issue.key, ruleGroupId: group.id, origin: "filter", filterRunId: run.id,
        title: issue.summary ?? "", stateName: issue.status, rawData: issue as unknown as Record<string, unknown>, createdAt: new Date(),
      }));
      controller.signal.throwIfAborted();
      await commitFilterRun(run, snapshots);
      return;
    }
    if (!projectKey) {
      const mywork = await apiFetch<{ list?: Array<{ project_key?: string }> }>("/api/meegle/mywork?action=todo", { signal: controller.signal });
      projectKey = mywork.list?.map((row) => row.project_key?.trim()).find(Boolean);
      if (!projectKey) throw new Error("MQL 未包含项目 key，且我的待办没有可用项目，请填写含 FROM 数据源的完整 MQL");
      controller.signal.throwIfAborted();
      await db.filterRuns.update(run.id, { projectKey });
    }
    const assignments = await db.assignments.toArray();
    controller.signal.throwIfAborted();
    const peers = groups.filter((candidate) => candidate.jiraProvider !== "bosch" && candidate.meegleMql?.trim()
      && (!meegleProjectKeyFromMql(candidate.meegleMql) || meegleProjectKeyFromMql(candidate.meegleMql) === projectKey));
    const payload = parseMeegleFilterResponse(await apiFetch("/api/meegle/filter", {
      method: "POST", signal: controller.signal, json: { projectKey, ruleGroups: peers.some((row) => row.id === group.id) ? peers : [...peers, group],
        filterRuleGroupId: group.id, manualAssignments: assignments.filter((row) => row.assignmentSource === "manual").map(({ projectKey, workItemTypeKey, workItemId }) => ({ projectKey, workItemTypeKey, workItemId })) },
    }));
    controller.signal.throwIfAborted();
    audits = payload.audits;
    if (!payload.successfulRuleGroupIds.includes(group.id)) throw new Error(audits.find((row) => row.decision === "failed")?.reason ?? "飞书 MQL 未完成优先级查询，保留原归属");
    if (!Object.hasOwn(payload.filterResults, group.id)) throw new Error("飞书响应缺少目标规则组结果");
    const snapshots = buildMeegleFilterSnapshots({ taskId: run.id, ruleGroupId: group.id, createdAt: new Date(), items: payload.filterResults[group.id] });
    controller.signal.throwIfAborted();
    await commitFilterRun(run, snapshots, { ...payload, successfulRuleGroupIds: [group.id] });
    })(), controller.signal);
  } catch (error) {
    await failFilterRun(run, controller.signal.aborted ? "筛票任务超时" : errorMessage(error), audits, controller.signal.aborted ? "expired" : "failed");
  } finally { clearTimeout(timer); }
}

const inflight = new Map<string, Promise<RuleGroupSourceSummary>>();

/** 来源分别提交和失败；同页面重复点击共享 promise，跨页面重复由数据库运行门禁处理。 */
export function runGroupFilter(group: RuleGroup, groups: RuleGroup[]): Promise<RuleGroupSourceSummary> {
  const existing = inflight.get(group.id);
  if (existing) return existing;
  const promise = Promise.allSettled(getConfiguredSources(group).map((source) => filterSource(group, groups, source)))
    .then(async (results) => {
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      return (await loadRuleGroupFilters(group)).summary;
    }).finally(() => inflight.delete(group.id));
  inflight.set(group.id, promise);
  return promise;
}
