import type { ReviewSample } from "@/domain/entities";

export interface EvalSetEntry {
  ruleGroupDir: string;
  carModelDir: string;
  issueKey: string;
  expectedSignals?: string[];
  expectedKeywords?: string[];
  notes?: string;
  /** 真值来源；人工手写条目没有该字段 */
  source?: "mysql-review-sample";
}

/** 关键判断类别：与 Step 5 回复模板中的固定结论措辞一致。 */
const VERDICT_PATTERNS: Array<{ keyword: string; pattern: RegExp }> = [
  { keyword: "转对应模块", pattern: /转对应模块/ },
  { keyword: "转对手件", pattern: /转对手件|对手件是否正常搭载/ },
  { keyword: "再转给VHAL分析", pattern: /再转给\s*VHAL\s*分析/i },
];

const SIGNAL_TOKEN = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g;
const MAX_SIGNALS = 6;

/** 评测目录名：Jira 票号原样，飞书 `meegle-<project>-<type>-<id>` 折叠为 `meegle-<id>`。 */
export function ticketDirNameFromIssueKey(issueKey: string): string {
  const match = /^meegle-.+-(\d+)$/.exec(issueKey);
  return match ? `meegle-${match[1]}` : issueKey;
}

/** 统一模型下的评测目录名：飞书工单为 `meegle-<workItemId>`，Jira 为票号。 */
export function ticketDirName(sample: Pick<ReviewSample, "source" | "ticketKey">): string {
  return sample.source === "meegle" ? `meegle-${sample.ticketKey}` : ticketDirNameFromIssueKey(sample.ticketKey);
}

export function getTruthConclusion(sample: ReviewSample): string {
  const text = sample.sampleKind === "approved" ? sample.approvedConclusion : sample.correctConclusion;
  return (text ?? "").trim();
}

export function extractVerdictKeywords(conclusion: string): string[] {
  return VERDICT_PATTERNS.filter(({ pattern }) => pattern.test(conclusion)).map(({ keyword }) => keyword);
}

/** 优先用样本中人工确认过的信号标记；缺失时退回结论里的信号名写法，且必须出现在结论中。 */
export function extractExpectedSignals(sample: ReviewSample, conclusion: string): string[] {
  const upper = conclusion.toUpperCase();
  const fromSample = (sample.signalTokens ?? []).filter((token) => token && upper.includes(token.toUpperCase()));
  const candidates = fromSample.length > 0 ? fromSample : conclusion.match(SIGNAL_TOKEN) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of candidates) {
    const key = token.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(token);
    if (result.length >= MAX_SIGNALS) break;
  }
  return result;
}

export interface ReviewSampleExportContext {
  ruleGroupDir: string;
  carModelDir: string;
}

export function buildEvalEntryFromSample(
  sample: ReviewSample,
  context: ReviewSampleExportContext,
): EvalSetEntry | null {
  const conclusion = getTruthConclusion(sample);
  if (!conclusion) return null;
  const expectedSignals = extractExpectedSignals(sample, conclusion);
  const expectedKeywords = extractVerdictKeywords(conclusion);
  if (expectedSignals.length === 0 && expectedKeywords.length === 0) return null;
  const kind = sample.sampleKind === "approved" ? "人工确认通过" : "人工改判";
  const entry: EvalSetEntry = {
    ruleGroupDir: context.ruleGroupDir,
    carModelDir: context.carModelDir,
    issueKey: ticketDirName(sample),
    source: "mysql-review-sample",
    notes: `${kind}：${conclusion.replace(/\s+/g, " ").slice(-160)}`,
  };
  if (expectedSignals.length > 0) entry.expectedSignals = expectedSignals;
  if (expectedKeywords.length > 0) entry.expectedKeywords = expectedKeywords;
  return entry;
}

function entryKey(entry: Pick<EvalSetEntry, "ruleGroupDir" | "carModelDir" | "issueKey">): string {
  return `${entry.ruleGroupDir}/${entry.carModelDir}/${entry.issueKey}`;
}

/** 合并：人工手写条目优先，导出条目只补充新票；同票重复导出以新结果覆盖旧的导出条目。 */
export function mergeEvalSet(existing: EvalSetEntry[], exported: EvalSetEntry[]): EvalSetEntry[] {
  const manual = existing.filter((entry) => entry.source !== "mysql-review-sample");
  const manualKeys = new Set(manual.map(entryKey));
  const manualTickets = new Set(manual.map((entry) => `${entry.ruleGroupDir}/${entry.issueKey}`));
  const additions = exported.filter(
    (entry) => !manualKeys.has(entryKey(entry)) && !manualTickets.has(`${entry.ruleGroupDir}/${entry.issueKey}`),
  );
  return [...manual, ...additions];
}

/** 同一张票多次复核时，只取最新一条样本。 */
export function pickLatestSamplePerTicket(samples: ReviewSample[]): ReviewSample[] {
  const latest = new Map<string, ReviewSample>();
  for (const sample of samples) {
    const key = `${sample.ruleGroupId}/${ticketDirName(sample)}`;
    const current = latest.get(key);
    const time = new Date(sample.createdAt).getTime() || 0;
    if (!current || time >= (new Date(current.createdAt).getTime() || 0)) latest.set(key, sample);
  }
  return [...latest.values()];
}
