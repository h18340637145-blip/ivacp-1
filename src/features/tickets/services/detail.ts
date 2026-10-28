"use client";

import type { TicketSnapshot, TicketSource } from "@/domain/entities";
import { db } from "@/shared/db/database";

export interface TicketLocation { source: TicketSource; ticketKey: string; groupId?: string; projectKey?: string; workItemTypeKey?: string; assignmentId?: string; jiraProvider?: TicketSnapshot["jiraProvider"] }

export async function loadTicketDetail(location: TicketLocation) {
  if (location.assignmentId && location.source === "meegle") {
    const assignment = await db.assignments.get(location.assignmentId);
    if (!assignment || assignment.ticketKey !== location.ticketKey) return { candidates: [], context: null };
    const result = assignment.latestResultId ? await db.processResults.get(assignment.latestResultId) : undefined;
    const resultSnapshot = result ? await db.snapshots.get(result.snapshotId) : undefined;
    location = { ...location, groupId: location.groupId ?? resultSnapshot?.ruleGroupId ?? (assignment.ruleGroupId || undefined),
      projectKey: assignment.projectKey, workItemTypeKey: assignment.workItemTypeKey };
  }
  let snapshots = (await db.snapshots.where("[source+ticketKey]").equals([location.source, location.ticketKey])
    .filter((row) => (!location.groupId || row.ruleGroupId === location.groupId) && (!location.projectKey || row.projectKey === location.projectKey)
      && (!location.workItemTypeKey || row.workItemTypeKey === location.workItemTypeKey)).toArray()).sort((a, b) => +b.createdAt - +a.createdAt);
  if (location.source === "jira") {
    const groups = new Map((await db.ruleGroups.bulkGet([...new Set(snapshots.map(row => row.ruleGroupId))])).filter(row => !!row).map(row => [row.id, row]));
    const site = (row: typeof snapshots[number]) => row.jiraProvider ?? (groups.has(row.ruleGroupId) ? groups.get(row.ruleGroupId)?.jiraProvider ?? "default" : undefined);
    snapshots = snapshots.filter(row => !location.jiraProvider || site(row) === location.jiraProvider)
      .map(row => row.jiraProvider || !site(row) ? row : { ...row, jiraProvider: site(row) });
  }
  const candidates = [...new Map(snapshots.map((row) => [JSON.stringify([row.ruleGroupId, row.projectKey, row.workItemTypeKey, row.jiraProvider]), row])).values()];
  if (!candidates.length || candidates.length > 1) return { candidates, context: null };
  const latestSnapshot = snapshots[0];
  const ids = new Set(snapshots.map((row) => row.id));
  const tasks = (await db.processTasks.where("[source+ticketKey]").equals([location.source, location.ticketKey]).filter((row) => ids.has(row.snapshotId)).toArray()).sort((a, b) => +b.createdAt - +a.createdAt);
  const results = tasks.length ? (await db.processResults.where("processTaskId").anyOf(tasks.map((row) => row.id)).toArray()).sort((a, b) => +b.createdAt - +a.createdAt) : [];
  const result = results[0];
  const snapshot = snapshots.find((row) => row.id === result?.snapshotId) ?? latestSnapshot;
  const group = await db.ruleGroups.get(latestSnapshot.ruleGroupId);
  const validations = result ? (await db.validationRuns.where("resultId").equals(result.id).toArray()).sort((a, b) => +b.createdAt - +a.createdAt) : [];
  const histories = await db.analysisHistories.where("[source+ticketKey]").equals([location.source, location.ticketKey])
    .filter((row) => ids.has(row.sourceSnapshotId)).reverse().sortBy("resultCreatedAt");
  return { candidates, context: { latestSnapshot, snapshot, group, task: tasks[0], result, histories, validations } };
}
