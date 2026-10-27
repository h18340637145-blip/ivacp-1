import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/server/db/mysql";
import { MAX_TEMPLATE_BYTES, parseTemplate, type RuleGroupTemplate } from "@/domain/templates/rule-group-template";
import type { TemplateSummary } from "@/domain/templates/summary";

/**
 * 团队模板库（表 team_templates，由 @/server/db/mysql 建立）。
 * 同一 templateKey 的每次发布生成新版本；删除为软删除（所有版本）。
 */

export type { TemplateSummary };

export interface TemplateActor {
  username: string;
  isAdmin: boolean;
}

function parseTags(raw: unknown): string[] {
  try {
    const value = JSON.parse(String(raw));
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** 列出每个模板的最新版本，附累计应用次数与版本数 */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const pool = await getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.template_key, t.version, t.name, t.description, t.tags, t.author, t.checksum, t.created_at,
            s.apply_count, s.version_count
       FROM team_templates t
       JOIN (SELECT template_key, MAX(version) AS max_version, SUM(apply_count) AS apply_count, COUNT(*) AS version_count
               FROM team_templates WHERE deleted = 0 GROUP BY template_key) s
         ON s.template_key = t.template_key AND s.max_version = t.version
      WHERE t.deleted = 0
      ORDER BY t.created_at DESC`,
  );
  return rows.map((row) => ({
    templateKey: String(row.template_key),
    version: Number(row.version),
    name: String(row.name),
    description: String(row.description),
    tags: parseTags(row.tags),
    author: String(row.author),
    createdAt: new Date(row.created_at).toISOString(),
    checksum: String(row.checksum),
    applyCount: Number(row.apply_count),
    versionCount: Number(row.version_count),
  }));
}

export async function getTemplate(templateKey: string, version?: number): Promise<RuleGroupTemplate | null> {
  const pool = await getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM team_templates WHERE template_key = ? AND deleted = 0 ${version ? "AND version = ?" : ""}
      ORDER BY version DESC LIMIT 1`,
    version ? [templateKey, version] : [templateKey],
  );
  const row = rows[0];
  if (!row) return null;
  return parseTemplate({
    kind: "rule-group-template",
    schemaVersion: 1,
    templateKey: row.template_key,
    version: row.version,
    name: row.name,
    description: row.description,
    tags: parseTags(row.tags),
    author: row.author,
    createdAt: new Date(row.created_at).toISOString(),
    config: JSON.parse(String(row.config)),
  });
}

/**
 * 发布模板。templateKey 已存在时作者必须是原作者或管理员，版本号由服务端递增；
 * 配置与上一版完全相同则不生成新版本。
 */
export async function publishTemplate(
  input: unknown,
  actor: TemplateActor,
): Promise<{ template: RuleGroupTemplate; created: boolean }> {
  if (JSON.stringify(input ?? null).length > MAX_TEMPLATE_BYTES) throw new Error("模板过大（上限 1MB）");
  const parsed = parseTemplate(input);
  const pool = await getPool();
  const [latestRows] = await pool.query<RowDataPacket[]>(
    "SELECT version, author, checksum FROM team_templates WHERE template_key = ? ORDER BY version DESC LIMIT 1",
    [parsed.templateKey],
  );
  const latest = latestRows[0];
  if (latest && latest.author !== actor.username && !actor.isAdmin) {
    throw new Error(`模板标识已被 ${String(latest.author)} 使用，请更换名称`);
  }
  if (latest && latest.checksum === parsed.checksum) {
    const existing = await getTemplate(parsed.templateKey);
    if (existing) return { template: existing, created: false };
  }
  const version = latest ? Number(latest.version) + 1 : 1;
  const author = latest ? String(latest.author) : actor.username;
  await pool.query(
    `INSERT INTO team_templates (template_key, version, name, description, tags, author, config, checksum, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      parsed.templateKey,
      version,
      parsed.name,
      parsed.description,
      JSON.stringify(parsed.tags),
      author,
      JSON.stringify(parsed.config),
      parsed.checksum,
    ],
  );
  const template = await getTemplate(parsed.templateKey, version);
  if (!template) throw new Error("模板保存失败");
  return { template, created: true };
}

export async function markTemplateApplied(templateKey: string, version: number): Promise<boolean> {
  const pool = await getPool();
  const [result] = await pool.query(
    "UPDATE team_templates SET apply_count = apply_count + 1 WHERE template_key = ? AND version = ? AND deleted = 0",
    [templateKey, version],
  );
  return (result as { affectedRows: number }).affectedRows > 0;
}

/** 软删除整个模板（所有版本）；仅作者或管理员 */
export async function deleteTemplate(
  templateKey: string,
  actor: TemplateActor,
): Promise<"deleted" | "not_found" | "forbidden"> {
  const pool = await getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT author FROM team_templates WHERE template_key = ? AND deleted = 0 LIMIT 1",
    [templateKey],
  );
  if (!rows[0]) return "not_found";
  if (rows[0].author !== actor.username && !actor.isAdmin) return "forbidden";
  await pool.query("UPDATE team_templates SET deleted = 1 WHERE template_key = ?", [templateKey]);
  return "deleted";
}
