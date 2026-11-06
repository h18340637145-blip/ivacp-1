import type { TicketSource } from "@/domain/entities";
import type { StatisticsAttempt, StatisticsRun } from "./annual-statistics";

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
  /** 每次开始分析都会写入一条任务（含失败、进行中），用于统计开始分析票数与分析次数 */
  processTasks?: Array<{
    id: string; snapshotId?: string; assignmentId?: string; source: TicketSource; ticketKey: string; createdAt: TimeValue;
  }>;
  processResults: Array<{
    id: string; processTaskId?: string; snapshotId?: string; assignmentId?: string; source: TicketSource; ticketKey: string; createdAt: TimeValue; reviewStatus: ReviewStatus;
    manualReviewedAt?: TimeValue | null; dwellMs?: number | null;
    tokenUsage?: number | null; handoverAt?: TimeValue | null;
  }>;
  analysisHistories: Array<{
    sourceResultId: string; sourceProcessTaskId?: string; sourceSnapshotId?: string; assignmentId?: string; source: TicketSource; ticketKey: string; resultCreatedAt: TimeValue;
    reviewStatus: ReviewStatus;
  }>;
}

export function emptyRawStatisticsTables(): RawStatisticsTables {
  return { processResults: [], analysisHistories: [] };
}

const toDwell = (value: number | null | undefined) => (value === null ? undefined : value);

function ticketKeyResolver(tables: RawStatisticsTables) {
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
  return ticketKey;
}

export function buildStatisticsRuns(tables: RawStatisticsTables): StatisticsRun[] {
  const ticketKey = ticketKeyResolver(tables);
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

/**
 * 开始分析记录：以 processTask 为准（含失败 / 进行中 / 已被替代）。
 * 找不到对应任务的结果或历史（旧数据、镜像未备份任务）按结果时间补计一次，避免漏计成功分析。
 */
export function buildStatisticsAttempts(tables: RawStatisticsTables): StatisticsAttempt[] {
  const ticketKey = ticketKeyResolver(tables);
  const attempts = new Map<string, StatisticsAttempt>();
  for (const row of tables.processTasks ?? []) {
    attempts.set(`task:${row.id}`, { source: row.source, attemptId: row.id, startedAt: row.createdAt,
      ticketKey: ticketKey(row.source, row.ticketKey, row.snapshotId, row.assignmentId) });
  }
  const fallback = (taskId: string | undefined, resultId: string, attempt: Omit<StatisticsAttempt, "attemptId">) => {
    const key = taskId && attempts.has(`task:${taskId}`) ? undefined : taskId ? `task:${taskId}` : `result:${resultId}`;
    if (key && !attempts.has(key)) attempts.set(key, { ...attempt, attemptId: key });
  };
  for (const row of tables.processResults) {
    fallback(row.processTaskId, row.id, { source: row.source, startedAt: row.createdAt,
      ticketKey: ticketKey(row.source, row.ticketKey, row.snapshotId, row.assignmentId) });
  }
  for (const row of tables.analysisHistories) {
    fallback(row.sourceProcessTaskId, row.sourceResultId, { source: row.source, startedAt: row.resultCreatedAt,
      ticketKey: ticketKey(row.source, row.ticketKey, row.sourceSnapshotId, row.assignmentId) });
  }
  return [...attempts.values()];
}
