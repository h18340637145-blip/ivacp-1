import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/server/db/mysql";
import type { MonthRange } from "@/domain/analysis/annual-statistics";
import { emptyRawStatisticsTables, type RawStatisticsTables } from "@/domain/analysis/statistics-records";
import { buildTeamStatistics, type TeamStatistics } from "@/domain/analysis/team-statistics";
import { deserializeRecord, reviveDates, toDate } from "@/domain/storage/serialization";

/**
 * 团队统计：读取服务端镜像 sync_records 中全部账号的 processResults / analysisHistories，关联快照与分配的最小身份字段。
 * source / ticket_key / record_created_at 用抽取列；其余统计字段只投影所需 JSON 字段（避免回传整条结论），
 * 投影结果仍是序列化记录（Date 为 {"$date": iso}），用 deserializeRecord 还原。
 */

type StatisticsTable = keyof RawStatisticsTables;

const PROJECTED_FIELDS: Record<StatisticsTable, string[]> = {
  processResults: ["snapshotId", "assignmentId", "createdAt", "reviewStatus", "manualReviewedAt", "dwellMs", "tokenUsage", "handoverAt"],
  analysisHistories: ["sourceResultId", "sourceSnapshotId", "assignmentId", "resultCreatedAt", "reviewStatus"],
  snapshots: ["projectKey", "workItemTypeKey", "workItemId"],
  assignments: ["projectKey", "workItemTypeKey", "workItemId"],
};

/** 时区与边界余量：SQL 粗筛只为减少传输，精确的区间判断由 calculateAnnualStatistics 完成 */
const RANGE_MARGIN_MS = 2 * 24 * 60 * 60 * 1000;

function projectionSql(fields: string[]): string {
  return `JSON_OBJECT(${fields.map((field) => `'${field}', JSON_EXTRACT(data, '$.${field}')`).join(", ")}) AS data`;
}

export interface StatisticsMirrorRow {
  owner: string;
  record_id: string;
  source: string | null;
  ticket_key: string | null;
  record_created_at?: Date | string | null;
  /** 投影后的 JSON：mysql2 可能已解析为对象，也可能是字符串 */
  data: unknown;
}

function decode(data: unknown): Record<string, unknown> {
  if (typeof data === "string") return deserializeRecord<Record<string, unknown>>(data) ?? {};
  if (data && typeof data === "object") return reviveDates<Record<string, unknown>>(data);
  return {};
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const reviewStatus = (value: unknown) =>
  value === "approved" || value === "rejected" || value === "pending" ? value : "pending";

/** 镜像行 → 按账号分组的统计原始表（纯函数，便于测试） */
export function groupStatisticsRows(
  rows: { processResults: StatisticsMirrorRow[]; analysisHistories: StatisticsMirrorRow[]; snapshots?: StatisticsMirrorRow[]; assignments?: StatisticsMirrorRow[] },
): Map<string, RawStatisticsTables> {
  const byOwner = new Map<string, RawStatisticsTables>();
  const tablesOf = (owner: string) => {
    let tables = byOwner.get(owner);
    if (!tables) {
      tables = emptyRawStatisticsTables();
      byOwner.set(owner, tables);
    }
    return tables;
  };
  for (const row of rows.processResults) {
    const source = row.source;
    if (source !== "jira" && source !== "meegle") continue;
    const data = decode(row.data);
    const createdAt = toDate(data.createdAt) ?? toDate(row.record_created_at) ?? "";
    tablesOf(String(row.owner)).processResults.push({
      id: String(row.record_id),
      snapshotId: typeof data.snapshotId === "string" ? data.snapshotId : undefined,
      assignmentId: typeof data.assignmentId === "string" ? data.assignmentId : undefined,
      source,
      ticketKey: row.ticket_key ?? "",
      createdAt,
      reviewStatus: reviewStatus(data.reviewStatus),
      manualReviewedAt: toDate(data.manualReviewedAt) ?? null,
      dwellMs: num(data.dwellMs) ?? null,
      tokenUsage: num(data.tokenUsage) ?? null,
      handoverAt: toDate(data.handoverAt) ?? null,
    });
  }
  for (const row of rows.analysisHistories) {
    const source = row.source;
    if (source !== "jira" && source !== "meegle") continue;
    const data = decode(row.data);
    tablesOf(String(row.owner)).analysisHistories.push({
      sourceResultId: typeof data.sourceResultId === "string" ? data.sourceResultId : "",
      sourceSnapshotId: typeof data.sourceSnapshotId === "string" ? data.sourceSnapshotId : undefined,
      assignmentId: typeof data.assignmentId === "string" ? data.assignmentId : undefined,
      source,
      ticketKey: row.ticket_key ?? "",
      resultCreatedAt: toDate(data.resultCreatedAt) ?? "",
      reviewStatus: reviewStatus(data.reviewStatus),
    });
  }
  for (const name of ["snapshots", "assignments"] as const) {
    for (const row of rows[name] ?? []) {
      if (row.source !== "meegle") continue;
      const data = decode(row.data);
      const tables = tablesOf(String(row.owner));
      (tables[name] ??= []).push({
        id: String(row.record_id), source: "meegle",
        projectKey: typeof data.projectKey === "string" ? data.projectKey : undefined,
        workItemTypeKey: typeof data.workItemTypeKey === "string" ? data.workItemTypeKey : undefined,
        workItemId: typeof data.workItemId === "number" || typeof data.workItemId === "string" ? data.workItemId : undefined,
      });
    }
  }
  return byOwner;
}

function rangeBounds(range: MonthRange): { start: Date; end: Date } {
  return {
    start: new Date(new Date(range.year, range.startMonth - 1, 1).getTime() - RANGE_MARGIN_MS),
    end: new Date(new Date(range.year, range.endMonth, 1).getTime() + RANGE_MARGIN_MS),
  };
}

export async function readTeamRawStatistics(range?: MonthRange): Promise<Map<string, RawStatisticsTables>> {
  const pool = await getPool();
  const bounds = range ? rangeBounds(range) : null;
  // 结果按创建时间粗筛；历史的归档时间晚于原结果时间，只能按下界筛；时间列缺失的保留（计入无效记录）
  const [processResults] = await pool.query<RowDataPacket[]>(
    `SELECT owner, record_id, source, ticket_key, record_created_at, ${projectionSql(PROJECTED_FIELDS.processResults)}
       FROM sync_records
      WHERE table_name = 'processResults' AND deleted = 0
        ${bounds ? "AND (record_created_at IS NULL OR record_created_at BETWEEN ? AND ?)" : ""}`,
    bounds ? [bounds.start, bounds.end] : [],
  );
  const [analysisHistories] = await pool.query<RowDataPacket[]>(
    `SELECT owner, record_id, source, ticket_key, ${projectionSql(PROJECTED_FIELDS.analysisHistories)}
       FROM sync_records
      WHERE table_name = 'analysisHistories' AND deleted = 0
        ${bounds ? "AND (record_created_at IS NULL OR record_created_at >= ?)" : ""}`,
    bounds ? [bounds.start] : [],
  );
  // 身份上下文可能早于统计区间，不能按快照创建时间筛掉；只取最小身份投影。
  const identityRows = await Promise.all((["snapshots", "assignments"] as const).map(async table => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT owner, record_id, source, ticket_key, ${projectionSql(PROJECTED_FIELDS[table])}
         FROM sync_records WHERE table_name = ? AND source = 'meegle' AND deleted = 0`, [table],
    );
    return rows as StatisticsMirrorRow[];
  }));
  return groupStatisticsRows({
    processResults: processResults as StatisticsMirrorRow[],
    analysisHistories: analysisHistories as StatisticsMirrorRow[],
    snapshots: identityRows[0], assignments: identityRows[1],
  });
}

export async function readTeamStatistics(range?: MonthRange, now = new Date()): Promise<TeamStatistics> {
  return buildTeamStatistics(await readTeamRawStatistics(range), now, range);
}
