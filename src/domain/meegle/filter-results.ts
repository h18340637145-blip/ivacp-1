import type { FilterRun, TicketSnapshot } from "@/domain/entities";

export interface MeegleFilterSnapshotItem {
  projectKey: string;
  projectName: string;
  workItemTypeKey: string;
  workItemId: number;
  workItemName: string;
  stateName: string;
  rawData: Record<string, unknown>;
}

export function meegleProjectKeyFromMql(mql: string): string | undefined {
  const match = mql.match(/\bFROM\s+`([^`]+)`\s*\.\s*`[^`]+`/i);
  const projectKey = match?.[1]?.trim();
  return projectKey || undefined;
}

export function meegleFilterIssueIdentityKey(
  item: Pick<MeegleFilterSnapshotItem, "projectKey" | "workItemTypeKey" | "workItemId">,
): string {
  return JSON.stringify([item.projectKey, item.workItemTypeKey, item.workItemId]);
}

export function buildMeegleFilterSnapshots(input: {
  taskId: string;
  ruleGroupId: string;
  createdAt: Date;
  items: MeegleFilterSnapshotItem[];
}): TicketSnapshot[] {
  const snapshots = new Map<string, TicketSnapshot>();

  for (const item of input.items) {
    const identityKey = meegleFilterIssueIdentityKey(item);
    if (snapshots.has(identityKey)) continue;

    snapshots.set(identityKey, {
      id: JSON.stringify([input.taskId, identityKey]),
      source: "meegle",
      ticketKey: String(item.workItemId),
      ruleGroupId: input.ruleGroupId,
      origin: "filter",
      filterRunId: input.taskId,
      title: item.workItemName,
      stateName: item.stateName,
      projectKey: item.projectKey,
      projectName: item.projectName,
      workItemTypeKey: item.workItemTypeKey,
      workItemId: item.workItemId,
      rawData: item.rawData,
      createdAt: input.createdAt,
    });
  }

  return [...snapshots.values()];
}

export function latestFilterRun(
  tasks: readonly FilterRun[],
): FilterRun | undefined {
  return [...tasks]
    .sort((left, right) => {
      const timeDifference = right.createdAt.getTime() - left.createdAt.getTime();
      return timeDifference || right.id.localeCompare(left.id);
    })[0];
}

export function latestCompletedFilterRun(
  tasks: readonly FilterRun[],
): FilterRun | undefined {
  return latestFilterRun(tasks.filter((task) => task.status === "completed"));
}
