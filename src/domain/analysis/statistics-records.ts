import type { TicketSource } from "@/domain/entities";
import type { StatisticsRun } from "./annual-statistics";

type ReviewStatus = StatisticsRun["reviewStatus"];
type TimeValue = Date | string;

/**
 * 统计所需的最小字段集：Dexie 行和 MySQL 镜像投影行都满足该结构。
 * 飞书 ticketKey 仅为工作项 ID，必须关联快照 / 分配补齐项目与类型。
 */
export interface StatisticsIdentity {
  id: string;
  source?: TicketSource;
  projectKey?: string;
  workItemTypeKey?: string;
  workItemId?: number | string;
}

export interface RawStatisticsTables {
  snapshots?: StatisticsIdentity[];
  assignments?: StatisticsIdentity[];
  processResults: Array<{
    id: string; snapshotId?: string; assignmentId?: string; source: TicketSource; ticketKey: string; createdAt: TimeValue; reviewStatus: ReviewStatus;
    manualReviewedAt?: TimeValue | null; dwellMs?: number | null;
    tokenUsage?: number | null; handoverAt?: TimeValue | null;
  }>;
  analysisHistories: Array<{
    sourceResultId: string; sourceSnapshotId?: string; assignmentId?: string; source: TicketSource; ticketKey: string; resultCreatedAt: TimeValue;
    reviewStatus: ReviewStatus;
  }>;
}

export function emptyRawStatisticsTables(): RawStatisticsTables {
  return { processResults: [], analysisHistories: [] };
}

const toDwell = (value: number | null | undefined) => (value === null ? undefined : value);

export function buildStatisticsRuns(tables: RawStatisticsTables): StatisticsRun[] {
  const snapshots = new Map((tables.snapshots ?? []).filter(row => row.source === "meegle").map(row => [row.id, row]));
  const assignments = new Map((tables.assignments ?? []).map(row => [row.id, row]));
  const completeKey = (row: StatisticsIdentity | undefined): string | undefined => {
    if (!row?.projectKey || !row.workItemTypeKey || row.workItemId == null || String(row.workItemId).trim() === "") return undefined;
    return JSON.stringify([row.projectKey, row.workItemTypeKey, String(row.workItemId)]);
  };
  const ticketKey = (source: TicketSource, key: string, snapshotId?: string, assignmentId?: string) => {
    if (source === "jira") return key;
    return completeKey(snapshots.get(snapshotId ?? ""))
      ?? completeKey(assignments.get(assignmentId ?? ""))
      ?? (assignmentId ? `assignment:${assignmentId}` : key);
  };
  return [
    ...tables.analysisHistories.map((row): StatisticsRun => ({
      source: row.source, resultId: row.sourceResultId, ticketKey: ticketKey(row.source, row.ticketKey, row.sourceSnapshotId, row.assignmentId),
      processedAt: row.resultCreatedAt, reviewStatus: row.reviewStatus, historical: true,
      ...(row.source === "meegle" ? { manualReviewed: false } : {}),
    })),
    ...tables.processResults.map((row): StatisticsRun => ({
      source: row.source, resultId: row.id, ticketKey: ticketKey(row.source, row.ticketKey, row.snapshotId, row.assignmentId),
      processedAt: row.createdAt, reviewStatus: row.reviewStatus, dwellMs: toDwell(row.dwellMs),
      tokenUsage: row.tokenUsage ?? undefined, handoverAt: row.handoverAt ?? undefined,
      ...(row.source === "meegle" ? { manualReviewed: Boolean(row.manualReviewedAt) } : {}),
    })),
  ];
}
