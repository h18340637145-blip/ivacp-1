import type { TicketSource } from "@/domain/entities";
import type { StatisticsRun } from "./annual-statistics";

type ReviewStatus = StatisticsRun["reviewStatus"];
type TimeValue = Date | string;

/**
 * 统计所需的最小字段集：Dexie 行和 MySQL 镜像投影行都满足该结构。
 * 统一模型下 Jira / 飞书结果同表，按 `source` 区分，`ticketKey` 即工单唯一标识。
 */
export interface RawStatisticsTables {
  processResults: Array<{
    id: string; source: TicketSource; ticketKey: string; createdAt: TimeValue; reviewStatus: ReviewStatus;
    manualReviewedAt?: TimeValue | null; dwellMs?: number | null;
    tokenUsage?: number | null; handoverAt?: TimeValue | null;
  }>;
  analysisHistories: Array<{
    sourceResultId: string; source: TicketSource; ticketKey: string; resultCreatedAt: TimeValue;
    reviewStatus: ReviewStatus;
  }>;
}

export function emptyRawStatisticsTables(): RawStatisticsTables {
  return { processResults: [], analysisHistories: [] };
}

const toDwell = (value: number | null | undefined) => (value === null ? undefined : value);

export function buildStatisticsRuns(tables: RawStatisticsTables): StatisticsRun[] {
  return [
    ...tables.analysisHistories.map((row): StatisticsRun => ({
      source: row.source, resultId: row.sourceResultId, ticketKey: row.ticketKey,
      processedAt: row.resultCreatedAt, reviewStatus: row.reviewStatus, historical: true,
      ...(row.source === "meegle" ? { manualReviewed: false } : {}),
    })),
    ...tables.processResults.map((row): StatisticsRun => ({
      source: row.source, resultId: row.id, ticketKey: row.ticketKey,
      processedAt: row.createdAt, reviewStatus: row.reviewStatus, dwellMs: toDwell(row.dwellMs),
      tokenUsage: row.tokenUsage ?? undefined, handoverAt: row.handoverAt ?? undefined,
      ...(row.source === "meegle" ? { manualReviewed: Boolean(row.manualReviewedAt) } : {}),
    })),
  ];
}
