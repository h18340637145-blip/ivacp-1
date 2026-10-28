/**
 * 评测集覆盖报告：只读人工真值 eval-set.json 和本地 log/ 目录。
 * 运行：npm run eval:coverage
 * 产出：docs/golden-baseline/eval-set-coverage.{json,md}
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectEvalTicketDirs } from "./ticket-directories";

interface EvalSetEntry {
  ruleGroupDir: string;
  carModelDir: string;
  issueKey: string;
  expectedSignals?: string[];
  expectedKeywords?: string[];
}

interface EvalSetCoverageReport {
  generatedAt: string;
  evalSetCount: number;
  evaluatedTicketCount: number;
  coverageRatio: number;
  byRuleGroup: Record<string, number>;
  byCarModel: Record<string, number>;
  expectedSignalsCount: number;
  expectedKeywordsCount: number;
  recommendation: string;
}

async function readTextSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function loadEvalSet(filePath: string): Promise<EvalSetEntry[]> {
  const raw = await readTextSafe(filePath);
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvalSetEntry[]) : [];
  } catch {
    return [];
  }
}

async function countEvaluatedTickets(logRoot: string): Promise<number> {
  return (await collectEvalTicketDirs(logRoot)).length;
}

function increment(map: Record<string, number>, key: string): void {
  const normalizedKey = key.trim() || "(未填写)";
  map[normalizedKey] = (map[normalizedKey] ?? 0) + 1;
}

function countValues(values: string[] | undefined): number {
  return values?.filter((value) => value.trim().length > 0).length ?? 0;
}

function buildRecommendation(report: Omit<EvalSetCoverageReport, "recommendation">): string {
  if (report.evaluatedTicketCount === 0) {
    return "本地 log/ 中没有可统计票据，覆盖率暂不可解释；请先生成或保留分析日志后再评估人工真值覆盖。";
  }
  if (report.evalSetCount === 0) {
    return "当前没有人工真值，信号召回率和关键判断命中率无法作为准确率依据；建议先按高频车型补充 eval-set.json。";
  }
  if (report.coverageRatio < 0.1) {
    return "人工真值覆盖仍较稀疏，信号召回率和关键判断命中率只能作为样例指标；建议按车型、规则组和错误类型持续补样。";
  }
  return "人工真值已有基础覆盖，仍建议继续按低覆盖车型和高频错误类型补充样本。";
}

export async function buildEvalSetCoverageReport(root = process.cwd()): Promise<void> {
  const output = path.join(root, "docs/golden-baseline");
  await mkdir(output, { recursive: true });
  const REPORT_JSON = path.join(output, "eval-set-coverage.json");
  const REPORT_MD = path.join(output, "eval-set-coverage.md");
  const evalSet = await loadEvalSet(path.join(output, "eval-set.json"));
  const evaluatedTicketCount = await countEvaluatedTickets(path.join(root, "log"));
  const byRuleGroup: Record<string, number> = {};
  const byCarModel: Record<string, number> = {};
  let expectedSignalsCount = 0;
  let expectedKeywordsCount = 0;

  for (const entry of evalSet) {
    increment(byRuleGroup, entry.ruleGroupDir);
    increment(byCarModel, entry.carModelDir);
    expectedSignalsCount += countValues(entry.expectedSignals);
    expectedKeywordsCount += countValues(entry.expectedKeywords);
  }

  const reportBase = {
    generatedAt: new Date().toISOString(),
    evalSetCount: evalSet.length,
    evaluatedTicketCount,
    coverageRatio:
      evaluatedTicketCount > 0 ? Number((evalSet.length / evaluatedTicketCount).toFixed(4)) : 0,
    byRuleGroup,
    byCarModel,
    expectedSignalsCount,
    expectedKeywordsCount,
  };
  const report: EvalSetCoverageReport = {
    ...reportBase,
    recommendation: buildRecommendation(reportBase),
  };

  await writeFile(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  const mdLines = [
    "# Jira 解票评测集覆盖报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 人工真值数量：${report.evalSetCount}`,
    `- 本地日志票数：${report.evaluatedTicketCount}`,
    `- 覆盖比例：${(report.coverageRatio * 100).toFixed(1)}%`,
    `- expectedSignals 数量：${report.expectedSignalsCount}`,
    `- expectedKeywords 数量：${report.expectedKeywordsCount}`,
    `- 建议：${report.recommendation}`,
    "",
    "## 按规则组覆盖",
    ...Object.entries(report.byRuleGroup)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([ruleGroup, count]) => `- ${ruleGroup}: ${count}`),
    "",
    "## 按车型覆盖",
    ...Object.entries(report.byCarModel)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([carModel, count]) => `- ${carModel}: ${count}`),
  ];

  await writeFile(REPORT_MD, mdLines.join("\n"), "utf8");
}
