"use client";

import type { Assignment, FilterAudit, FilterRun, RuleGroup, TicketSnapshot, TicketSource } from "@/domain/entities";
import { expireFilterRun, isExpiredActiveFilterRun } from "@/domain/issue-source/jira-workflow";
import { latestFilterRun, meegleFilterIssueIdentityKey } from "@/domain/meegle/filter-results";
import { autoAssignmentIdsToUnassign } from "@/domain/meegle/filter-assignment-reconciliation";
import { db } from "@/shared/db/database";
import { newId } from "@/shared/lib/ids";

export interface FilterReconciliation { runId: string; audits: FilterAudit[]; successfulRuleGroupIds: string[] }

export async function startFilterRun(group: RuleGroup, source: TicketSource, projectKey?: string) {
  return db.transaction("rw", "filterRuns", async () => {
    const latest = latestFilterRun(await db.filterRuns.where("[ruleGroupId+source]").equals([group.id, source]).toArray());
    if (latest && (latest.status === "running" || latest.status === "pending")) {
      if (!isExpiredActiveFilterRun(latest)) return { run: latest, started: false };
      await db.filterRuns.put(expireFilterRun(latest));
    }
    const run: FilterRun = { id: newId(), source, ruleGroupId: group.id, query: source === "jira" ? group.jql : group.meegleMql ?? "", projectKey,
      status: "running", issueCount: 0, createdAt: new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1)) };
    await db.filterRuns.add(run);
    return { run, started: true };
  });
}

/** 事务内重新判断最新运行，跨标签页或迟到响应不能覆盖较新的筛选结果。 */
export async function commitFilterRun(run: FilterRun, snapshots: TicketSnapshot[], reconciliation?: FilterReconciliation): Promise<FilterRun> {
  return db.transaction("rw", ["filterRuns", "snapshots", "assignments", "filterAudits"], async () => {
    const current = await db.filterRuns.get(run.id);
    if (!current) throw new Error("筛票运行已不存在");
    if (current.status !== "running") return current;
    const latest = latestFilterRun(await db.filterRuns.where("[ruleGroupId+source]").equals([run.ruleGroupId, run.source]).toArray());
    if (latest?.id !== run.id) {
      const expired: FilterRun = { ...current, status: "expired", issueCount: 0, error: "响应已过期，存在更新的筛票运行或当前运行已结束", completedAt: new Date() };
      await db.filterRuns.put(expired);
      return expired;
    }
    let retained = snapshots;
    if (reconciliation) {
      const byIdentity = new Map((await db.assignments.toArray()).map((row) => [meegleFilterIssueIdentityKey(row), row]));
      for (const audit of reconciliation.audits) {
        if (audit.decision !== "assigned" || audit.matchedRuleGroupId !== run.ruleGroupId) continue;
        const key = meegleFilterIssueIdentityKey(audit);
        const old = byIdentity.get(key);
        if (old?.assignmentSource === "manual") continue;
        const row: Assignment = { ...(old ?? { id: newId(), status: "pending", assignedAt: audit.createdAt }),
          source: "meegle", ticketKey: String(audit.workItemId), workItemId: audit.workItemId, projectKey: audit.projectKey,
          projectName: audit.projectName ?? "", workItemTypeKey: audit.workItemTypeKey, workItemName: audit.workItemName,
          stateName: audit.stateName ?? "", ruleGroupId: run.ruleGroupId, assignmentSource: "auto", lastFilterRunId: reconciliation.runId,
          ...(old && old.ruleGroupId !== run.ruleGroupId ? { status: "pending", latestAttemptTaskId: undefined, processingStartedAt: undefined, error: undefined } : {}) };
        await db.assignments.put(row);
        byIdentity.set(key, row);
      }
      const reconciled = await db.assignments.toArray();
      const staleIds = autoAssignmentIdsToUnassign({ ...reconciliation, successfulRuleGroupIds: [run.ruleGroupId], assignments: reconciled });
      for (const id of staleIds) await db.assignments.update(id, { ruleGroupId: "", latestAttemptTaskId: undefined, processingStartedAt: undefined,
        ...(reconciled.find((row) => row.id === id)?.status === "processing" ? { status: "pending" } : {}) });
      const stale = new Set(staleIds);
      const owned = new Set([...byIdentity].filter(([, row]) => row.ruleGroupId === run.ruleGroupId && !stale.has(row.id)).map(([key]) => key));
      retained = snapshots.filter((snapshot) => snapshot.projectKey && snapshot.workItemTypeKey && snapshot.workItemId
        && owned.has(meegleFilterIssueIdentityKey({ projectKey: snapshot.projectKey, workItemTypeKey: snapshot.workItemTypeKey, workItemId: snapshot.workItemId })));
      await db.filterAudits.bulkPut(reconciliation.audits);
    }
    if (retained.length) await db.snapshots.bulkPut(retained);
    const completed: FilterRun = { ...current, status: "completed", issueCount: retained.length, runId: reconciliation?.runId ?? current.runId, completedAt: new Date(), error: undefined };
    await db.filterRuns.put(completed);
    return completed;
  });
}

export async function failFilterRun(run: FilterRun, error: string, audits: FilterAudit[] = [], status: "failed" | "expired" = "failed"): Promise<FilterRun> {
  return db.transaction("rw", ["filterRuns", "filterAudits"], async () => {
    const current = await db.filterRuns.get(run.id);
    if (!current || (current.status !== "running" && current.status !== "pending")) return current ?? run;
    const failed: FilterRun = { ...current, status, issueCount: 0, error, completedAt: new Date() };
    await db.filterRuns.put(failed);
    if (audits.length) await db.filterAudits.bulkPut(audits);
    return failed;
  });
}

export async function recoverExpiredFilters() {
  await db.transaction("rw", "filterRuns", async () => {
    const active = await db.filterRuns.where("status").anyOf("running", "pending").toArray();
    const expired = active.filter((run) => isExpiredActiveFilterRun(run));
    if (expired.length) await db.filterRuns.bulkPut(expired.map((run) => expireFilterRun(run)));
  });
}
