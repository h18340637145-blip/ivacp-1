import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import type { ReviewSample, RuleGroup } from "@/domain/entities";
import { buildEvalEntryFromSample, mergeEvalSet, pickLatestSamplePerTicket, ticketDirName, type EvalSetEntry } from "@/domain/analysis/eval-truth";
import { deserializeRecord } from "@/domain/storage/serialization";
import { getPool } from "@/server/db/mysql";
import { sanitizeName } from "@/server/pipeline/paths-logging";
import { collectEvalTicketDirs } from "./ticket-directories";

async function fetchTable<T>(owner: string, table: "reviewSamples" | "ruleGroups"): Promise<T[]> {
  const pool = await getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT record_id, data FROM sync_records WHERE owner = ? AND table_name = ? AND deleted = 0", [owner, table],
  );
  return rows.map(row => ({ ...deserializeRecord<object>(row.data), id: row.record_id })) as T[];
}

/** 只读新库镜像；人工手写真值优先，dryRun不改评测集。 */
export async function exportReviewTruth(options: { root?: string; owner: string; dryRun?: boolean }) {
  const root = options.root ?? process.cwd();
  const file = path.join(root, "docs/golden-baseline/eval-set.json");
  const [samples, groups] = await Promise.all([fetchTable<ReviewSample>(options.owner, "reviewSamples"), fetchTable<RuleGroup>(options.owner, "ruleGroups")]);
  const groupNames = new Map(groups.map(group => [group.id, sanitizeName(group.name)]));
  const locations = new Map<string, string>();
  for (const { ticketDir } of await collectEvalTicketDirs(path.join(root, "log"))) {
    const model = path.dirname(ticketDir);
    locations.set(`${path.basename(path.dirname(model))}/${path.basename(ticketDir)}`, path.basename(model));
  }
  const exported: EvalSetEntry[] = [];
  const skipped = { noRuleGroup: 0, noLog: 0, noTruthSignal: 0 };
  for (const sample of pickLatestSamplePerTicket(samples)) {
    const group = groupNames.get(sample.ruleGroupId);
    if (!group) { skipped.noRuleGroup++; continue; }
    const model = locations.get(`${group}/${ticketDirName(sample)}`);
    if (!model) { skipped.noLog++; continue; }
    const entry = buildEvalEntryFromSample(sample, { ruleGroupDir: group, carModelDir: model });
    if (!entry) { skipped.noTruthSignal++; continue; }
    exported.push(entry);
  }
  let existing: EvalSetEntry[] = [];
  try { existing = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!Array.isArray(existing)) throw new Error("eval-set.json 必须为数组");
  const merged = mergeEvalSet(existing, exported);
  const report = { owner: options.owner, reviewSamples: samples.length, exportable: exported.length, skipped,
    manualEntries: existing.filter(entry => entry.source !== "mysql-review-sample").length, total: merged.length, dryRun: !!options.dryRun };
  if (!options.dryRun) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`); }
  return report;
}
