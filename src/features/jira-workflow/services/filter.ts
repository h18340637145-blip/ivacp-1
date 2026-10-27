"use client";

import type { FilterRun, RuleGroup, TicketSnapshot } from "@/domain/entities";
import type { JiraIssue } from "@/domain/issue-source/jira";
import {
  FILTER_RUN_TIMEOUT_ERROR,
  FILTER_RUN_TIMEOUT_MS,
  expireFilterRun,
  isExpiredActiveFilterRun,
  latestBy,
} from "@/domain/issue-source/jira-workflow";
import { db } from "@/shared/db/database";
import { errorMessage } from "@/shared/lib/errors";
import { newId } from "@/shared/lib/ids";
import { fetchJiraIssues } from "./jira-api";

/** Jira 筛票：filterRuns(source=jira) + snapshots(origin=filter) */

export async function recoverExpiredJiraFilterRuns(now = Date.now()): Promise<number> {
  const active = await db.filterRuns
    .where("status")
    .anyOf(["running", "pending"])
    .filter((run) => run.source === "jira" && isExpiredActiveFilterRun(run, now))
    .toArray();
  if (active.length > 0) await db.filterRuns.bulkPut(active.map((run) => expireFilterRun(run)));
  return active.length;
}

export async function loadJiraFilterRuns(ruleGroupId: string): Promise<FilterRun[]> {
  const runs = await db.filterRuns.where("[ruleGroupId+source]").equals([ruleGroupId, "jira"]).toArray();
  return runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function loadLatestJiraFilterRun(ruleGroupId: string): Promise<FilterRun | undefined> {
  return (await loadJiraFilterRuns(ruleGroupId))[0];
}

export async function loadLatestCompletedJiraFilterRun(ruleGroupId: string): Promise<FilterRun | undefined> {
  return (await loadJiraFilterRuns(ruleGroupId)).find((run) => run.status === "completed");
}

export async function loadSnapshotsForRun(filterRunId: string): Promise<TicketSnapshot[]> {
  return db.snapshots.where("filterRunId").equals(filterRunId).toArray();
}

/** 由 Jira 工单构造快照；同一规则组 + 工单号复用已有快照 id 与创建时间 */
export function buildJiraSnapshot(input: {
  issue: JiraIssue;
  ruleGroupId: string;
  existing?: TicketSnapshot;
  filterRunId?: string;
  origin: TicketSnapshot["origin"];
  now?: Date;
}): TicketSnapshot {
  const { issue, existing } = input;
  return {
    id: existing?.id ?? newId(),
    source: "jira",
    ticketKey: issue.key,
    ruleGroupId: input.ruleGroupId,
    origin: existing?.origin === "filter" ? "filter" : input.origin,
    filterRunId: input.filterRunId ?? existing?.filterRunId,
    title: issue.summary ?? "",
    stateName: issue.status,
    rawData: issue as unknown as Record<string, unknown>,
    createdAt: existing?.createdAt ?? input.now ?? new Date(),
  };
}

export async function upsertJiraSnapshots(
  ruleGroupId: string,
  issues: JiraIssue[],
  filterRunId: string | undefined,
  origin: TicketSnapshot["origin"],
): Promise<TicketSnapshot[]> {
  const existing = await db.snapshots
    .where("ruleGroupId")
    .equals(ruleGroupId)
    .filter((snapshot) => snapshot.source === "jira")
    .toArray();
  const byKey = new Map<string, TicketSnapshot>();
  for (const snapshot of existing) {
    const current = byKey.get(snapshot.ticketKey);
    if (!current || latestBy([current, snapshot], (item) => item.createdAt) === snapshot) byKey.set(snapshot.ticketKey, snapshot);
  }
  const now = new Date();
  const snapshots = issues.map((issue) =>
    buildJiraSnapshot({ issue, ruleGroupId, existing: byKey.get(issue.key), filterRunId, origin, now }),
  );
  if (snapshots.length > 0) await db.snapshots.bulkPut(snapshots);
  return snapshots;
}

/** 执行一次 Jira 筛票（10 分钟超时 → expired） */
export async function runJiraFilter(
  group: Pick<RuleGroup, "id" | "jql" | "jiraProvider">,
  onStart?: (run: FilterRun) => void,
): Promise<FilterRun> {
  const run: FilterRun = {
    id: newId(),
    source: "jira",
    ruleGroupId: group.id,
    query: group.jql,
    status: "running",
    issueCount: 0,
    createdAt: new Date(),
  };
  await db.filterRuns.add(run);
  onStart?.(run);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FILTER_RUN_TIMEOUT_MS);
  try {
    const { issues } = await fetchJiraIssues(group.jql, group.jiraProvider, controller.signal);
    const list = Array.isArray(issues) ? issues : [];
    await upsertJiraSnapshots(group.id, list, run.id, "filter");
    const completed: FilterRun = { ...run, status: "completed", issueCount: list.length, completedAt: new Date() };
    await db.filterRuns.put(completed);
    return completed;
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const failed: FilterRun = {
      ...run,
      status: timedOut ? "expired" : "failed",
      error: timedOut ? FILTER_RUN_TIMEOUT_ERROR : errorMessage(error),
      completedAt: new Date(),
    };
    await db.filterRuns.put(failed);
    return failed;
  } finally {
    clearTimeout(timer);
  }
}
