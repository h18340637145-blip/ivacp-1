import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/server/db/mysql";
import { detectIssueScene } from "@/domain/analysis/issue-scene";
import {
  suggestLabels,
  toExportRecord,
  validateAnnotation,
  type Annotation,
  type AnnotationInput,
} from "@/domain/labeling/schema";
import {
  displayIssueKey,
  filterLabelItems,
  makeItemId,
  parseItemId,
  type ItemSource,
  type LabelItemDetail,
  type LabelItemSummary,
  type LabelListFilter,
  type LabelListResult,
} from "@/domain/labeling/items";

/**
 * 数据标注服务端：条目来自服务端镜像 sync_records 中的 processResults（按 source 列区分 Jira / 飞书），
 * 标注结果写 labeling_annotations（按 owner 隔离；表由 @/server/db/mysql 建立）。
 */

const SOURCES: ItemSource[] = ["jira", "meegle"];

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function parseJsonArray(raw: unknown): string[] {
  try {
    const value = JSON.parse(typeof raw === "string" && raw ? raw : "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rowToAnnotation(row: RowDataPacket): Annotation {
  return {
    itemId: String(row.item_id),
    verdict: row.verdict,
    errorCodes: parseJsonArray(row.error_codes) as Annotation["errorCodes"],
    purposes: parseJsonArray(row.purposes) as Annotation["purposes"],
    correctedConclusion: row.corrected_conclusion ?? "",
    difficulty: row.difficulty,
    note: row.note ?? "",
    labeler: String(row.labeler),
    revision: Number(row.revision),
    updatedAt: iso(row.updated_at),
  };
}

async function loadAnnotations(pool: Pool, owner: string, itemId?: string): Promise<Map<string, Annotation>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM labeling_annotations WHERE owner = ? ${itemId ? "AND item_id = ?" : ""}`,
    itemId ? [owner, itemId] : [owner],
  );
  return new Map(rows.map((row) => [String(row.item_id), rowToAnnotation(row)]));
}

const LIST_FIELDS = `
  record_id, source, ticket_key, updated_at,
  JSON_UNQUOTE(JSON_EXTRACT(data, '$.snapshotId')) AS snapshot_id,
  JSON_UNQUOTE(JSON_EXTRACT(data, '$.reviewStatus')) AS review_status,
  JSON_UNQUOTE(JSON_EXTRACT(data, '$.errorCategory')) AS error_category,
  LEFT(JSON_UNQUOTE(JSON_EXTRACT(data, '$.replyText')), 160) AS excerpt`;

interface TitleIndex {
  bySnapshotId: Map<string, string>;
  /** `${source}:${ticketKey}` → 最新快照标题（结果引用的快照被清理时兜底） */
  byTicket: Map<string, string>;
}

async function loadTitles(pool: Pool, owner: string, source?: ItemSource): Promise<TitleIndex> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT record_id, source, ticket_key, JSON_UNQUOTE(JSON_EXTRACT(data, '$.title')) AS title
     FROM sync_records WHERE owner = ? AND table_name = 'snapshots' AND deleted = 0 ${source ? "AND source = ?" : ""}
     ORDER BY record_created_at ASC`,
    source ? [owner, source] : [owner],
  );
  const index: TitleIndex = { bySnapshotId: new Map(), byTicket: new Map() };
  for (const row of rows) {
    const title = text(row.title);
    if (!title) continue;
    index.bySnapshotId.set(String(row.record_id), title);
    index.byTicket.set(`${text(row.source)}:${text(row.ticket_key)}`, title);
  }
  return index;
}

/** 单条目只查自己的标题：优先引用的快照，其次同工单最新快照，避免扫描整个来源的快照 */
async function loadTitleFor(pool: Pool, owner: string, source: ItemSource, row: RowDataPacket): Promise<TitleIndex> {
  const index: TitleIndex = { bySnapshotId: new Map(), byTicket: new Map() };
  const snapshotId = text(row.snapshot_id);
  const ticketKey = text(row.ticket_key);
  const [byId, byTicket] = await Promise.all([
    snapshotId
      ? pool.query<RowDataPacket[]>(
          `SELECT JSON_UNQUOTE(JSON_EXTRACT(data, '$.title')) AS title FROM sync_records
           WHERE owner = ? AND table_name = 'snapshots' AND record_id = ? AND source = ? AND deleted = 0`,
          [owner, snapshotId, source],
        )
      : null,
    pool.query<RowDataPacket[]>(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(data, '$.title')) AS title FROM sync_records
       WHERE owner = ? AND table_name = 'snapshots' AND source = ? AND ticket_key = ? AND deleted = 0
         AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.title')) <> ''
       ORDER BY record_created_at DESC LIMIT 1`,
      [owner, source, ticketKey],
    ),
  ]);
  const idTitle = byId ? text(byId[0][0]?.title) : "";
  if (idTitle) index.bySnapshotId.set(snapshotId, idTitle);
  const ticketTitle = text(byTicket[0][0]?.title);
  if (ticketTitle) index.byTicket.set(`${source}:${ticketKey}`, ticketTitle);
  return index;
}

function titleOf(titles: TitleIndex, source: ItemSource, row: RowDataPacket): string {
  return titles.bySnapshotId.get(text(row.snapshot_id)) ?? titles.byTicket.get(`${source}:${text(row.ticket_key)}`) ?? "";
}

function rowSource(row: RowDataPacket): ItemSource | null {
  const source = text(row.source);
  return source === "jira" || source === "meegle" ? source : null;
}

function toSummary(row: RowDataPacket, source: ItemSource, titles: TitleIndex, annotation?: Annotation): LabelItemSummary {
  const title = titleOf(titles, source, row);
  return {
    itemId: makeItemId(source, String(row.record_id)),
    source,
    issueKey: displayIssueKey(source, text(row.ticket_key)),
    title,
    scene: detectIssueScene(title),
    reviewStatus: text(row.review_status) || "pending",
    errorCategory: text(row.error_category) || undefined,
    excerpt: text(row.excerpt),
    annotated: Boolean(annotation),
    verdict: annotation?.verdict,
    updatedAt: iso(row.updated_at),
  };
}

export async function listItems(owner: string, filter: LabelListFilter = {}): Promise<LabelListResult> {
  const pool = await getPool();
  const [annotations, titles, [rows]] = await Promise.all([
    loadAnnotations(pool, owner),
    loadTitles(pool, owner, filter.source),
    pool.query<RowDataPacket[]>(
      `SELECT ${LIST_FIELDS} FROM sync_records
       WHERE owner = ? AND table_name = 'processResults' AND deleted = 0 AND source IN (?)
       ORDER BY updated_at DESC`,
      [owner, filter.source ? [filter.source] : SOURCES],
    ),
  ]);
  const all: LabelItemSummary[] = [];
  for (const row of rows) {
    const source = rowSource(row);
    if (!source) continue;
    all.push(toSummary(row, source, titles, annotations.get(makeItemId(source, String(row.record_id)))));
  }
  return filterLabelItems(all, filter);
}

export async function getItem(owner: string, itemId: string): Promise<LabelItemDetail | null> {
  const { source, recordId } = parseItemId(itemId);
  const pool = await getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${LIST_FIELDS},
       JSON_UNQUOTE(JSON_EXTRACT(data, '$.replyText')) AS reply_text,
       JSON_UNQUOTE(JSON_EXTRACT(data, '$.signalSummary')) AS signal_summary,
       JSON_UNQUOTE(JSON_EXTRACT(data, '$.errorReason')) AS error_reason,
       JSON_UNQUOTE(JSON_EXTRACT(data, '$.manualCorrectResult')) AS manual_correct,
       JSON_UNQUOTE(JSON_EXTRACT(data, '$.aiReviewVerdict')) AS ai_verdict,
       JSON_UNQUOTE(JSON_EXTRACT(data, '$.aiReviewReason')) AS ai_reason
     FROM sync_records
     WHERE owner = ? AND table_name = 'processResults' AND record_id = ? AND source = ? AND deleted = 0`,
    [owner, recordId, source],
  );
  const row = rows[0];
  if (!row) return null;
  const [annotations, titles] = await Promise.all([loadAnnotations(pool, owner, itemId), loadTitleFor(pool, owner, source, row)]);
  const annotation = annotations.get(itemId);
  const summary = toSummary(row, source, titles, annotation);
  const detail = {
    replyText: text(row.reply_text),
    signalSummary: text(row.signal_summary),
    errorReason: text(row.error_reason),
    manualCorrectResult: text(row.manual_correct),
    aiReviewVerdict: text(row.ai_verdict) || undefined,
    aiReviewReason: text(row.ai_reason) || undefined,
  };
  return {
    ...summary,
    ...detail,
    suggestion: suggestLabels({ ...detail, reviewStatus: summary.reviewStatus, errorCategory: summary.errorCategory }),
    annotation,
  };
}

export async function saveAnnotation(owner: string, labeler: string, itemId: string, raw: unknown): Promise<Annotation> {
  parseItemId(itemId);
  const input: AnnotationInput = validateAnnotation(raw);
  const item = await getItem(owner, itemId);
  if (!item) throw new Error("条目不存在或已被删除");
  const pool = await getPool();
  await pool.query(
    `INSERT INTO labeling_annotations
       (owner, item_id, verdict, error_codes, purposes, corrected_conclusion, difficulty, note, labeler, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(3))
     ON DUPLICATE KEY UPDATE verdict = VALUES(verdict), error_codes = VALUES(error_codes), purposes = VALUES(purposes),
       corrected_conclusion = VALUES(corrected_conclusion), difficulty = VALUES(difficulty), note = VALUES(note),
       labeler = VALUES(labeler), revision = revision + 1, updated_at = NOW(3)`,
    [
      owner,
      itemId,
      input.verdict,
      JSON.stringify(input.errorCodes),
      JSON.stringify(input.purposes),
      input.correctedConclusion,
      input.difficulty,
      input.note,
      labeler,
    ],
  );
  const saved = (await loadAnnotations(pool, owner, itemId)).get(itemId);
  if (!saved) throw new Error("保存失败");
  return saved;
}

export async function deleteAnnotation(owner: string, itemId: string): Promise<void> {
  parseItemId(itemId);
  const pool = await getPool();
  await pool.query("DELETE FROM labeling_annotations WHERE owner = ? AND item_id = ?", [owner, itemId]);
}

/** 导出 JSONL：无法标注、排除或未选用途的标注不导出；条目已被删除的跳过 */
export async function exportJsonl(owner: string): Promise<string> {
  const pool = await getPool();
  const annotations = await loadAnnotations(pool, owner);
  const exportable = [...annotations.values()].filter(
    (annotation) => annotation.verdict !== "unusable" && annotation.purposes.length > 0 && !annotation.purposes.includes("exclude"),
  );
  const lines: string[] = [];
  // 分批并发读取条目，保持输出顺序且不超过连接池容量
  for (let offset = 0; offset < exportable.length; offset += 4) {
    const batch = exportable.slice(offset, offset + 4);
    const items = await Promise.all(batch.map((annotation) => getItem(owner, annotation.itemId).catch(() => null)));
    batch.forEach((annotation, index) => {
      const item = items[index];
      if (!item) return;
      const record = toExportRecord(
        { itemId: item.itemId, source: item.source, issueKey: item.issueKey, scene: item.scene, aiConclusion: item.replyText },
        annotation,
      );
      if (record) lines.push(JSON.stringify(record));
    });
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
