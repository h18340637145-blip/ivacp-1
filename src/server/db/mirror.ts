import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isEntityTableName, type EntityTableName } from "@/domain/entities";
import { getPool } from "./mysql";

/**
 * IndexedDB 服务端镜像（按登录账号 owner 隔离）。
 * 记录以序列化 JSON 存储（Date 编码为 {"$date": iso}），并抽取 source / ruleGroupId / ticketKey / createdAt
 * 到独立列，供团队统计与标注系统直接按列过滤，而不用解析整条 JSON。
 */

export interface MirrorRecordInput {
  table: EntityTableName;
  id: string;
  /** 序列化后的记录；删除时省略 */
  data?: string;
  deleted?: boolean;
}

export interface MirrorRecord {
  table: EntityTableName;
  id: string;
  data: string;
  updatedAt: string;
}

const MAX_ID_LENGTH = 255;
const MAX_CLIENT_ID_LENGTH = 64;

function normalizeClientId(clientId: unknown): string | null {
  if (typeof clientId !== "string") return null;
  const trimmed = clientId.trim().slice(0, MAX_CLIENT_ID_LENGTH);
  return trimmed || null;
}

export function validateRecords(records: unknown): MirrorRecordInput[] {
  if (!Array.isArray(records)) throw new Error("records 必须是数组");
  return records.map((item, index) => {
    const record = item as Partial<MirrorRecordInput>;
    if (!record || typeof record.table !== "string" || !isEntityTableName(record.table)) {
      throw new Error(`第 ${index + 1} 条记录的表名无效`);
    }
    if (typeof record.id !== "string" || !record.id || record.id.length > MAX_ID_LENGTH) {
      throw new Error(`第 ${index + 1} 条记录的 id 无效`);
    }
    if (!record.deleted && typeof record.data !== "string") {
      throw new Error(`第 ${index + 1} 条记录缺少 data`);
    }
    return { table: record.table, id: record.id, data: record.data, deleted: Boolean(record.deleted) };
  });
}

interface ExtractedColumns {
  source: string | null;
  ruleGroupId: string | null;
  ticketKey: string | null;
  createdAt: Date | null;
}

function pickString(value: unknown, max = 255): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

function pickDate(value: unknown): Date | null {
  const raw = value && typeof value === "object" && "$date" in value ? (value as { $date: unknown }).$date : value;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 从序列化记录中抽取索引列；解析失败时全部置空，不影响写入 */
export function extractColumns(data: string | undefined): ExtractedColumns {
  if (!data) return { source: null, ruleGroupId: null, ticketKey: null, createdAt: null };
  try {
    const record = JSON.parse(data) as Record<string, unknown>;
    return {
      source: pickString(record.source, 16),
      ruleGroupId: pickString(record.ruleGroupId),
      ticketKey: pickString(record.ticketKey),
      createdAt: pickDate(record.createdAt),
    };
  } catch {
    return { source: null, ruleGroupId: null, ticketKey: null, createdAt: null };
  }
}

async function upsertRecord(
  connection: PoolConnection,
  owner: string,
  record: MirrorRecordInput,
  clientId: string | null,
  runId: string | null,
  now: Date,
) {
  if (record.deleted) {
    await connection.query(
      `INSERT INTO sync_records (owner, table_name, record_id, data, deleted, client_id, backup_run_id, updated_at)
       VALUES (?, ?, ?, NULL, 1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data = NULL, deleted = 1, client_id = VALUES(client_id),
         backup_run_id = VALUES(backup_run_id), updated_at = VALUES(updated_at)`,
      [owner, record.table, record.id, clientId, runId, now],
    );
    return;
  }
  const columns = extractColumns(record.data);
  await connection.query(
    `INSERT INTO sync_records (owner, table_name, record_id, data, deleted, source, rule_group_id, ticket_key,
       record_created_at, client_id, backup_run_id, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data), deleted = 0, source = VALUES(source),
       rule_group_id = VALUES(rule_group_id), ticket_key = VALUES(ticket_key),
       record_created_at = VALUES(record_created_at), client_id = VALUES(client_id),
       backup_run_id = VALUES(backup_run_id), updated_at = VALUES(updated_at)`,
    [owner, record.table, record.id, record.data, columns.source, columns.ruleGroupId, columns.ticketKey,
      columns.createdAt, clientId, runId, now],
  );
}

export async function pushRecords(input: {
  owner: string;
  clientId?: unknown;
  backupRunId?: unknown;
  records: MirrorRecordInput[];
}): Promise<{ upserted: number; deleted: number }> {
  const pool = await getPool();
  const clientId = normalizeClientId(input.clientId);
  const runId = normalizeClientId(input.backupRunId);
  const now = new Date();
  const connection = await pool.getConnection();
  let upserted = 0;
  let deleted = 0;
  try {
    await connection.beginTransaction();
    for (const record of input.records) {
      await upsertRecord(connection, input.owner, record, clientId, runId, now);
      if (record.deleted) deleted += 1;
      else upserted += 1;
    }
    if (clientId) {
      await connection.query(
        `INSERT INTO sync_clients (owner, client_id, last_push_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_push_at = VALUES(last_push_at)`,
        [input.owner, clientId, now],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { upserted, deleted };
}

/**
 * 完整备份结束后，把本浏览器此前写入、但本次未上传的记录标记为已删除，
 * 让镜像与当前 IndexedDB 一致；同账号其他浏览器写入的数据不受影响。
 */
export async function finalizeFullBackup(input: {
  owner: string;
  clientId: string;
  backupRunId: string;
  startedAt: Date;
  tables: EntityTableName[];
}): Promise<{ markedDeleted: number }> {
  const clientId = normalizeClientId(input.clientId);
  if (input.tables.length === 0 || !clientId) return { markedDeleted: 0 };
  const pool = await getPool();
  const now = new Date();
  const [result] = await pool.query(
    `UPDATE sync_records SET deleted = 1, data = NULL, updated_at = ?
     WHERE owner = ? AND client_id = ? AND table_name IN (?) AND deleted = 0
       AND (backup_run_id IS NULL OR backup_run_id <> ?) AND updated_at < ?`,
    [now, input.owner, clientId, input.tables, input.backupRunId, input.startedAt],
  );
  await pool.query(
    `INSERT INTO sync_clients (owner, client_id, last_full_backup_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE last_full_backup_at = VALUES(last_full_backup_at)`,
    [input.owner, clientId, now],
  );
  return { markedDeleted: (result as { affectedRows?: number }).affectedRows ?? 0 };
}

export async function pullRecords(input: {
  owner: string;
  table: EntityTableName;
  afterId?: string;
  limit: number;
}): Promise<{ records: MirrorRecord[]; nextAfterId: string | null }> {
  const pool = await getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT record_id, data, updated_at FROM sync_records
     WHERE owner = ? AND table_name = ? AND deleted = 0 AND record_id > ?
     ORDER BY record_id ASC LIMIT ?`,
    [input.owner, input.table, input.afterId ?? "", input.limit],
  );
  const records = rows.map((row) => ({
    table: input.table,
    id: String(row.record_id),
    data: String(row.data),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
  return { records, nextAfterId: records.length === input.limit ? records[records.length - 1].id : null };
}

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

export async function readMirrorStatus(owner: string) {
  const pool = await getPool();
  const [counts] = await pool.query<RowDataPacket[]>(
    `SELECT table_name, COUNT(*) AS total, MAX(updated_at) AS last_updated
     FROM sync_records WHERE owner = ? AND deleted = 0 GROUP BY table_name`,
    [owner],
  );
  const [clients] = await pool.query<RowDataPacket[]>(
    `SELECT client_id, last_push_at, last_full_backup_at FROM sync_clients WHERE owner = ?
     ORDER BY COALESCE(last_push_at, last_full_backup_at) DESC LIMIT 20`,
    [owner],
  );
  const [owners] = await pool.query<RowDataPacket[]>(
    `SELECT owner, COUNT(*) AS total, MAX(updated_at) AS last_updated
     FROM sync_records WHERE deleted = 0 GROUP BY owner ORDER BY owner`,
  );
  return {
    tables: counts.map((row) => ({ table: String(row.table_name), total: Number(row.total), lastUpdated: iso(row.last_updated) })),
    clients: clients.map((row) => ({
      clientId: String(row.client_id),
      lastPushAt: iso(row.last_push_at),
      lastFullBackupAt: iso(row.last_full_backup_at),
    })),
    owners: owners.map((row) => ({ owner: String(row.owner), total: Number(row.total), lastUpdated: iso(row.last_updated) })),
  };
}

/** 跨账号读取某表全部未删除记录（团队统计 / 标注 / 服务端 few-shot 样本使用） */
export async function readTableRows(
  table: EntityTableName,
  options: { owner?: string; columns?: string } = {},
): Promise<RowDataPacket[]> {
  const pool = await getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT owner, record_id, ${options.columns ?? "data"} FROM sync_records
     WHERE table_name = ? AND deleted = 0 ${options.owner ? "AND owner = ?" : ""}`,
    options.owner ? [table, options.owner] : [table],
  );
  return rows;
}
