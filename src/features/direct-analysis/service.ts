"use client";

import type { JiraProvider, ProcessTask, RuleGroup, TicketSnapshot } from "@/domain/entities";
import { extractCarModelFromTitle, isValidIssueKey, matchRuleGroupsByModel, normalizeIssueKey } from "@/domain/issue-source/jira-workflow";
import { fetchJiraIssues } from "@/features/jira-workflow/services/jira-api";
import { processTicket } from "@/features/tickets/services/process";
import { ticketHref } from "@/features/tickets/use-process-action";
import { db } from "@/shared/db/database";
import { newId } from "@/shared/lib/ids";
import { errorMessage } from "@/shared/lib/errors";

export type DirectJiraSite = JiraProvider | "default";
export interface DirectAnalysisRow { groupId: string; groupName: string; status: "queued" | "running" | "completed" | "failed" | "skipped"; href: string; taskId?: string; error?: string }
export interface DirectAnalysisReport { key: string; provider: DirectJiraSite; title: string; model: string; rows: DirectAnalysisRow[] }
export interface DirectAnalysisUpdate { phase: "loading" | "processing" | "complete"; report?: DirectAnalysisReport }
type Listener = (update: DirectAnalysisUpdate) => void;
interface Options { signal?: AbortSignal; onUpdate?: Listener }
const inflight = new Map<string, { promise: Promise<DirectAnalysisReport>; listeners: Set<Listener>; latest?: DirectAnalysisUpdate }>();
function configSignature(group: RuleGroup): string {
  return JSON.stringify([group.id, group.name, group.jiraProvider ?? "default", group.expand, group.base_paths, group.model_to_files, group.prompts]);
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("工单查询已取消", "AbortError"); }

async function execute(key: string, provider: DirectJiraSite, signal: AbortSignal | undefined, update: Listener): Promise<DirectAnalysisReport> {
  checkAbort(signal); update({ phase: "loading" });
  const result = await fetchJiraIssues(`issue = ${key}`, provider === "bosch" ? "bosch" : undefined, signal);
  checkAbort(signal);
  if (!Array.isArray(result?.issues)) throw new Error("Jira 查询响应缺少工单列表");
  const issue = result.issues.find(issue => typeof issue?.key === "string" && normalizeIssueKey(issue.key) === key);
  if (!issue) throw new Error(`未找到 Jira 工单 ${key}`);
  if (typeof issue.summary !== "string") throw new Error("Jira 返回的工单标题格式无效");
  const model = extractCarModelFromTitle(issue.summary);
  if (!model) throw new Error("无法从标题的 [] 或【】中提取车型，请核对工单标题");
  const groups = matchRuleGroupsByModel((await db.ruleGroups.toArray()).filter(group => (group.jiraProvider ?? "default") === provider), model)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  checkAbort(signal);
  if (!groups.length) throw new Error(`当前 Jira 站点没有匹配车型「${model}」的规则组`);
  const snapshots = groups.map((group): TicketSnapshot => ({ id: newId(), source: "jira", jiraProvider: provider, ticketKey: key, ruleGroupId: group.id,
    origin: "process", analysisTrigger: "direct", title: issue.summary, stateName: issue.status, rawData: { ...issue, key }, createdAt: new Date() }));
  const report: DirectAnalysisReport = { key, provider, title: issue.summary, model, rows: groups.map((group, index) => ({ groupId: group.id, groupName: group.name, status: "queued", href: ticketHref(snapshots[index]) })) };
  const publish = (phase: DirectAnalysisUpdate["phase"] = "processing") => update({ phase, report: { ...report, rows: report.rows.map(row => ({ ...row })) } });
  publish();
  await Promise.all(groups.map(async (group: RuleGroup, index) => {
    const row = report.rows[index];
    try {
      const task = await processTicket(snapshots[index], group, { reanalyze: true, shouldStart: async () => {
        const current = await db.ruleGroups.get(group.id);
        if (signal?.aborted || !current || (current.jiraProvider ?? "default") !== provider || configSignature(current) !== configSignature(group) || !matchRuleGroupsByModel([current], model).length) return false;
        row.status = "running"; publish(); return true;
      } });
      row.taskId = task?.id;
      row.status = !task ? "skipped" : task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : "running";
      row.error = task?.error ?? (!task ? "规则组已删除、分析配置已变化或查询已取消，未启动分析" : undefined);
    } catch (error) { row.status = "failed"; row.error = errorMessage(error); }
    publish();
  }));
  publish("complete");
  return report;
}

/** 单页相同站点/票号共享运行，跨标签页由统一任务事务门禁协调。 */
export function runDirectJiraAnalysis(value: string, provider: DirectJiraSite, options: Options = {}): Promise<DirectAnalysisReport> {
  const key = normalizeIssueKey(value);
  if (key.length > 120 || !isValidIssueKey(key)) return Promise.reject(new Error("请输入有效的 Jira 票号，例如 CHER-129770"));
  if (provider !== "default" && provider !== "bosch") return Promise.reject(new Error("请选择有效的 Jira 站点"));
  const identity = JSON.stringify([provider, key]);
  const existing = inflight.get(identity);
  if (existing) { if (options.onUpdate) { existing.listeners.add(options.onUpdate); if (existing.latest) options.onUpdate(existing.latest); } return existing.promise; }
  const listeners = new Set<Listener>(options.onUpdate ? [options.onUpdate] : []);
  const publish: Listener = update => {
    const entry = inflight.get(identity); if (entry) entry.latest = update;
    for (const listener of listeners) { try { listener(update); } catch (error) { console.warn("单票分析进度更新失败", error); } }
  };
  const promise = Promise.resolve().then(() => execute(key, provider, options.signal, publish)).finally(() => { inflight.delete(identity); listeners.clear(); });
  inflight.set(identity, { promise, listeners });
  return promise;
}

export interface RecentDirectAnalysis { ticketKey: string; provider: DirectJiraSite; groupName: string; href: string; status: ProcessTask["status"]; createdAt: Date; error?: string }
export async function loadRecentDirectAnalyses(): Promise<RecentDirectAnalysis[]> {
  return db.transaction("r", [db.snapshots, db.processTasks, db.ruleGroups], async () => {
    const snapshots = await db.snapshots.where("origin").equals("process").filter(row => row.source === "jira" && row.analysisTrigger === "direct").toArray();
    if (!snapshots.length) return [];
    const byId = new Map(snapshots.map(row => [row.id, row]));
    const tasks = (await db.processTasks.where("snapshotId").anyOf([...byId.keys()]).toArray()).sort((a, b) => +b.createdAt - +a.createdAt || b.id.localeCompare(a.id));
    const groups = new Map((await db.ruleGroups.bulkGet([...new Set(tasks.map(row => row.ruleGroupId))])).filter(row => !!row).map(row => [row.id, row]));
    const seen = new Set<string>(); const rows: RecentDirectAnalysis[] = [];
    for (const task of tasks) {
      const snapshot = byId.get(task.snapshotId)!;
      const provider = snapshot.jiraProvider ?? groups.get(task.ruleGroupId)?.jiraProvider ?? "default";
      const key = JSON.stringify([provider, task.ticketKey, task.ruleGroupId]);
      if (seen.has(key)) continue; seen.add(key);
      rows.push({ ticketKey: task.ticketKey, provider, groupName: groups.get(task.ruleGroupId)?.name ?? task.ruleGroupId,
        href: ticketHref({ ...snapshot, jiraProvider: provider }), status: task.status, createdAt: task.createdAt, error: task.error });
      if (rows.length === 8) break;
    }
    return rows;
  });
}
