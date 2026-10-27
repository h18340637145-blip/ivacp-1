import { ENTITY_TABLES, isEntityTableName, type EntityTableName, type EntityTables } from "@/domain/entities";
import { LEGACY_BACKUP_FORMAT, migrateLegacyTables, type LegacyTables, type MigrationReport } from "@/domain/migration/legacy";
import { deserializeRecord } from "./serialization";

export const BACKUP_FILE_FORMAT = "ivacp-backup";
export const BACKUP_FILE_VERSION = 1;

export type BackupTables = { [K in EntityTableName]?: EntityTables[K][] };

export interface BackupFile {
  format: typeof BACKUP_FILE_FORMAT;
  version: number;
  exportedAt: string;
  tables: BackupTables;
}

export interface ParsedBackup {
  tables: BackupTables;
  /** 为旧版（JiraAnalyzerDB）备份时附带迁移报告 */
  legacyReport?: MigrationReport;
}

/** 解析备份文件；同时兼容旧系统导出的 jira-analyzer-indexeddb-backup，自动转换为新表结构 */
export function parseBackupFile(text: string): ParsedBackup {
  const parsed = deserializeRecord<{ format?: string; version?: number; tables?: Record<string, unknown[]> }>(text);
  if (!parsed || typeof parsed.tables !== "object" || !parsed.tables) throw new Error("不是有效的数据备份文件");
  if (parsed.format === LEGACY_BACKUP_FORMAT) {
    const { tables, report } = migrateLegacyTables(parsed.tables as LegacyTables);
    return { tables, legacyReport: report };
  }
  if (parsed.format !== BACKUP_FILE_FORMAT) throw new Error("不是有效的数据备份文件");
  if (typeof parsed.version !== "number" || parsed.version > BACKUP_FILE_VERSION) {
    throw new Error("备份文件版本过新，请升级系统后再导入");
  }
  const tables: BackupTables = {};
  for (const [name, rows] of Object.entries(parsed.tables)) {
    if (isEntityTableName(name) && Array.isArray(rows)) (tables as Record<string, unknown[]>)[name] = rows;
  }
  return { tables };
}

export const SYNC_TABLES: readonly EntityTableName[] = ENTITY_TABLES;

/** 按序列化大小与条数切批，用于分批推送到服务端镜像 */
export function chunkBySize<T extends { data?: string }>(items: T[], maxBytes: number, maxCount = 500): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const itemSize = (item.data?.length ?? 0) + 128;
    if (current.length > 0 && (size + itemSize > maxBytes || current.length >= maxCount)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
