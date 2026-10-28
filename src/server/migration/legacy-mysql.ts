import { withTemplateLock } from "@/server/templates/template-lock";
import type { RowDataPacket } from "mysql2/promise";
import { ENTITY_TABLES, recordPrimaryKey, type EntityTableName } from "@/domain/entities";
import { migrateLegacyTables, type LegacyTables, type MigrationReport } from "@/domain/migration/legacy";
import { deserializeRecord, serializeRecord } from "@/domain/storage/serialization";
import { newId } from "@/shared/lib/ids";
import { pushRecords, type MirrorRecordInput } from "@/server/db/mirror";
import { getLegacyPool, getPool } from "@/server/db/mysql";

/**
 * 旧系统 MySQL（jira_analyzer_next）→ 新库（ivacp）一键迁移。
 * - idb_records：按账号读取旧镜像，经 migrateLegacyTables 转为统一实体后写入 sync_records。
 * - team_templates：逐行复制（结构未变）。
 * - labeling_annotations：复制并按改名后的处理结果 id 重映射 item_id。
 * 默认 merge 模式只补齐新库缺失的数据，可重复执行；overwrite 模式以旧库为准覆盖。
 */

export interface LegacyMysqlMigrationOptions {
  overwrite?: boolean;
  /** 只迁移指定账号；缺省迁移全部账号 */
  owners?: string[];
  operator?: string;
  onProgress?: (message: string) => void;
}

export interface OwnerMigrationReport extends MigrationReport {
  owner: string;
  skippedExisting: number;
}

export interface LegacyMysqlMigrationReport {
  id: string;
  mode: "merge" | "overwrite";
  owners: OwnerMigrationReport[];
  templates: { read: number; written: number };
  annotations: { read: number; written: number; remapped: number };
  startedAt: string;
  finishedAt: string;
}

const PUSH_BATCH = 200;

async function tableExists(table: string): Promise<boolean> {
  const pool = await getLegacyPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [table],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function legacyOwners(filter?: string[]): Promise<string[]> {
  if (!(await tableExists("idb_records"))) return [];
  const pool = await getLegacyPool();
  const [rows] = await pool.query<RowDataPacket[]>("SELECT DISTINCT owner FROM idb_records WHERE deleted = 0 ORDER BY owner");
  const owners = rows.map((row) => String(row.owner));
  return filter?.length ? owners.filter((owner) => filter.includes(owner)) : owners;
}

async function readLegacyTables(owner: string, warnings: string[] = [], sourceCounts: Record<string, number> = {}): Promise<LegacyTables> {
  const pool = await getLegacyPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT table_name, data FROM idb_records WHERE owner = ? AND deleted = 0 AND data IS NOT NULL",
    [owner],
  );
  const tables: Record<string, unknown[]> = {};
  for (const row of rows) {
    const tableName = String(row.table_name);
    sourceCounts[tableName] = (sourceCounts[tableName] ?? 0) + 1;
    try {
      (tables[String(row.table_name)] ??= []).push(deserializeRecord(String(row.data)));
    } catch {
      warnings.push(`[${owner}] ${String(row.table_name)}：JSON 损坏，已跳过 1 条`);
    }
  }
  return tables;
}

async function existingIds(owner: string, table: EntityTableName): Promise<Set<string>> {
  const pool = await getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT record_id FROM sync_records WHERE owner = ? AND table_name = ? AND deleted = 0",
    [owner, table],
  );
  return new Set(rows.map((row) => String(row.record_id)));
}

async function migrateOwner(
  owner: string,
  options: LegacyMysqlMigrationOptions,
): Promise<{ report: OwnerMigrationReport; renamedResultIds: Record<string, string> }> {
  const warnings: string[] = [];
  const sourceCounts: Record<string, number> = {};
  const legacy = await readLegacyTables(owner, warnings, sourceCounts);
  const { tables, report, renamedResultIds } = migrateLegacyTables(legacy);
  report.warnings.push(...warnings);
  Object.assign(report.read, sourceCounts);
  let skippedExisting = 0;
  const written: OwnerMigrationReport["written"] = {};

  for (const table of ENTITY_TABLES) {
    const rows = (tables[table] ?? []) as unknown as Record<string, unknown>[];
    if (rows.length === 0) continue;
    const existing = options.overwrite ? new Set<string>() : await existingIds(owner, table);
    const records: MirrorRecordInput[] = [];
    for (const row of rows) {
      const id = String(recordPrimaryKey(table, row));
      if (existing.has(id)) {
        skippedExisting += 1;
        continue;
      }
      records.push({ table, id, data: serializeRecord(row) });
    }
    for (let index = 0; index < records.length; index += PUSH_BATCH) {
      await pushRecords({ owner, clientId: "legacy-migration", records: records.slice(index, index + PUSH_BATCH) });
    }
    if (records.length > 0) written[table] = records.length;
    options.onProgress?.(`[${owner}] ${table}: 写入 ${records.length} / ${rows.length}`);
  }

  return { report: { ...report, written, owner, skippedExisting }, renamedResultIds };
}

export async function migrateTemplates(overwrite: boolean): Promise<{ read: number; written: number }> {
  if (!(await tableExists("team_templates"))) return { read: 0, written: 0 };
  const [rows] = await (await getLegacyPool()).query<RowDataPacket[]>(
    `SELECT template_key, version, name, description, tags, author, config, checksum, apply_count, deleted, created_at
     FROM team_templates`,
  );
  let written = 0;
  for (const row of rows) {
    const [result] = await withTemplateLock(String(row.template_key), connection => connection.query(
      `INSERT ${overwrite ? "" : "IGNORE"} INTO team_templates
         (template_key, version, name, description, tags, author, config, checksum, apply_count, deleted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ${overwrite ? `ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), tags = VALUES(tags),
         author = VALUES(author), config = VALUES(config), checksum = VALUES(checksum),
         apply_count = VALUES(apply_count), deleted = VALUES(deleted), created_at = VALUES(created_at)` : ""}`,
      [row.template_key, row.version, row.name, row.description, row.tags, row.author, row.config, row.checksum,
        row.apply_count, row.deleted, row.created_at],
    ));
    if ((result as { affectedRows?: number }).affectedRows) written += 1;
  }
  return { read: rows.length, written };
}

/** 旧 itemId `${source}:${resultId}`；结果 id 在迁移中被改名时同步改写 */
export function remapAnnotationItemId(itemId: string, renamedResultIds: Record<string, string>): string {
  const separator = itemId.indexOf(":");
  if (separator < 0) return itemId;
  const source = itemId.slice(0, separator);
  const renamed = renamedResultIds[itemId];
  return renamed ? `${source}:${renamed}` : itemId;
}

async function migrateAnnotations(
  overwrite: boolean,
  renamedByOwner: Map<string, Record<string, string>>,
): Promise<{ read: number; written: number; remapped: number }> {
  if (!(await tableExists("labeling_annotations"))) return { read: 0, written: 0, remapped: 0 };
  const [rows] = await (await getLegacyPool()).query<RowDataPacket[]>(
    `SELECT owner, item_id, verdict, error_codes, purposes, corrected_conclusion, difficulty, note, labeler, revision, updated_at
     FROM labeling_annotations`,
  );
  const pool = await getPool();
  let written = 0;
  let remapped = 0;
  for (const row of rows) {
    const owner = String(row.owner);
    const itemId = remapAnnotationItemId(String(row.item_id), renamedByOwner.get(owner) ?? {});
    if (itemId !== row.item_id) remapped += 1;
    const [result] = await pool.query(
      `INSERT ${overwrite ? "" : "IGNORE"} INTO labeling_annotations
         (owner, item_id, verdict, error_codes, purposes, corrected_conclusion, difficulty, note, labeler, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ${overwrite ? `ON DUPLICATE KEY UPDATE verdict = VALUES(verdict), error_codes = VALUES(error_codes),
         purposes = VALUES(purposes), corrected_conclusion = VALUES(corrected_conclusion), difficulty = VALUES(difficulty),
         note = VALUES(note), labeler = VALUES(labeler), revision = VALUES(revision), updated_at = VALUES(updated_at)` : ""}`,
      [owner, itemId, row.verdict, row.error_codes, row.purposes, row.corrected_conclusion, row.difficulty, row.note,
        row.labeler, row.revision, row.updated_at],
    );
    if ((result as { affectedRows?: number }).affectedRows) written += 1;
  }
  return { read: rows.length, written, remapped };
}

export async function migrateLegacyMysql(options: LegacyMysqlMigrationOptions = {}): Promise<LegacyMysqlMigrationReport> {
  const startedAt = new Date();
  const overwrite = Boolean(options.overwrite);
  const owners = await legacyOwners(options.owners);
  options.onProgress?.(`发现 ${owners.length} 个账号的旧数据`);

  const ownerReports: OwnerMigrationReport[] = [];
  const renamedByOwner = new Map<string, Record<string, string>>();
  for (const owner of owners) {
    const { report, renamedResultIds } = await migrateOwner(owner, options);
    ownerReports.push(report);
    renamedByOwner.set(owner, renamedResultIds);
  }
  const templates = await migrateTemplates(overwrite);
  options.onProgress?.(`团队模板：写入 ${templates.written} / ${templates.read}`);
  const annotations = await migrateAnnotations(overwrite, renamedByOwner);
  options.onProgress?.(`标注：写入 ${annotations.written} / ${annotations.read}（重映射 ${annotations.remapped}）`);

  const report: LegacyMysqlMigrationReport = {
    id: newId(),
    mode: overwrite ? "overwrite" : "merge",
    owners: ownerReports,
    templates,
    annotations,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
  await (await getPool()).query(
    "INSERT INTO migration_runs (id, kind, operator, report, created_at) VALUES (?, 'legacy-mysql', ?, ?, ?)",
    [report.id, options.operator ?? "system", JSON.stringify(report), new Date()],
  );
  return report;
}

export async function listMigrationRuns(limit = 10): Promise<LegacyMysqlMigrationReport[]> {
  const [rows] = await (await getPool()).query<RowDataPacket[]>(
    "SELECT report FROM migration_runs ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map((row) => (typeof row.report === "string" ? JSON.parse(row.report) : row.report));
}

/** 只读预检：查询源镜像并转换，不调用迁移写入或记录 migration_runs。 */
export async function previewLegacyMysql() {
  const owners: Array<{ owner: string; report: MigrationReport; conflicts: number; conflictsByTable: Partial<Record<EntityTableName, number>> }> = [];
  for (const owner of await legacyOwners()) {
    const warnings: string[] = [];
    const sourceCounts: Record<string, number> = {};
    const { tables, report } = migrateLegacyTables(await readLegacyTables(owner, warnings, sourceCounts));
    Object.assign(report.read, sourceCounts);
    report.warnings.push(...warnings);
    let conflicts = 0;
    const conflictsByTable: Partial<Record<EntityTableName, number>> = {};
    for (const table of ENTITY_TABLES) {
      const rows = (tables[table] ?? []) as unknown as Record<string, unknown>[];
      if (!rows.length) continue;
      const existing = await existingIds(owner, table);
      const count = rows.filter(row => existing.has(recordPrimaryKey(table, row))).length;
      if (count) conflictsByTable[table] = count;
      conflicts += count;
    }
    owners.push({ owner, report, conflicts, conflictsByTable });
  }
  const count = async (table: string) => {
    if (!(await tableExists(table))) return { read: 0 };
    const [rows] = await (await getLegacyPool()).query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${table}`);
    return { read: Number(rows[0]?.total ?? 0) };
  };
  return { owners, templates: await count('team_templates'), annotations: await count('labeling_annotations'), checkedAt: new Date().toISOString() };
}
