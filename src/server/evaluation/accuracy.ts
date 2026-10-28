/**
 * 离线评测脚手架：回放 log/ 产物，算证据接地率(EGR) 与标注一致率。
 * 运行：npm run eval:accuracy
 * 产出：docs/golden-baseline/eval-report.{json,md}
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeGrounding,
  type GroundingEvidenceSource,
  type GroundingItem,
} from "@/domain/analysis/structured-evidence-validation";
import {
  getGroundingSourceValidationError,
  hasMeaningfulGroundingSource,
  withSupplementalCommentSource,
} from "@/domain/analysis/grounding-evidence-sources";
import {
  classifyEvidenceErrors,
  detectClockOffsetHours,
  type EvidenceErrorCategory,
  type EvidencePacket,
} from "@/domain/analysis/evidence-packet";
import { buildEvalSetCoverageReport } from "./coverage";
import { collectEvalTicketDirs } from "./ticket-directories";

interface EvalSetEntry {
  ruleGroupDir: string;
  carModelDir: string;
  issueKey: string;
  expectedSignals?: string[];
  expectedKeywords?: string[];
  notes?: string;
}

interface TicketResult {
  ticketDir: string;
  egr: number | null;
  groundingStatus: "evaluated" | "unknown_missing_evidence";
  total: number;
  ungrounded: string[];
  ungroundedAudit: GroundingItem[];
  missingEvidenceSources: string[];
  evidenceReadErrors: EvidenceReadError[];
  evidenceSourceErrors: EvidenceSourceError[];
  signalRecall?: number;
  keywordHitRate?: number;
  errorCategories: EvidenceErrorCategory[];
  riskFlags: string[];
  topMissingEvidence: string[];
}

interface EvidenceReadError {
  source: string;
  error: string;
}

interface EvidenceSourceError {
  source: string;
  type: "parse";
  error: string;
}

interface EvidenceSourcesResult {
  sources: GroundingEvidenceSource[];
  missingEvidenceSources: string[];
  evidenceReadErrors: EvidenceReadError[];
  evidenceSourceErrors: EvidenceSourceError[];
}

async function readTextSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function buildEvidenceSources(ticketDir: string): Promise<EvidenceSourcesResult> {
  const sourceFiles = [
    { name: "evidence_packet", filename: "evidence-packet.json" },
    { name: "can_signal_summary", filename: "can_signal_summary.txt" },
    { name: "can_trace_extracted_result", filename: "can_trace_extracted_result.txt" },
    { name: "signals_id", filename: "signals_id.json" },
    { name: "extract", filename: "extract.md" },
  ];
  const evidenceReadErrors: EvidenceReadError[] = [];
  const allSources = await Promise.all(sourceFiles.map(async (source) => {
    try {
      return { name: source.name, text: await readFile(path.join(ticketDir, source.filename), "utf8") };
    } catch (error) {
      const readError = error as NodeJS.ErrnoException;
      if (readError.code !== "ENOENT") {
        const errorText = String(error).replace(/\s+/g, " ").slice(0, 180);
        console.warn(`[eval-accuracy] 读取证据失败 ${source.name}: ${errorText}`);
        evidenceReadErrors.push({ source: source.name, error: errorText });
      }
      return { name: source.name, text: "" };
    }
  }));
  const evidenceSourceErrors = allSources.flatMap((source) => {
    const error = getGroundingSourceValidationError(source);
    if (!error) return [];
    console.warn(`[eval-accuracy] 证据格式无效 ${source.name}: ${error}`);
    return [{ source: source.name, type: "parse" as const, error }];
  });
  return {
    sources: allSources.filter(hasMeaningfulGroundingSource),
    missingEvidenceSources: allSources
      .filter((source) => !hasMeaningfulGroundingSource(source))
      .map((source) => source.name),
    evidenceReadErrors,
    evidenceSourceErrors,
  };
}

async function loadEvidencePacket(ticketDir: string): Promise<EvidencePacket | null> {
  const raw = await readTextSafe(path.join(ticketDir, "evidence-packet.json"));
  if (!raw.trim()) return null;
  try {
    const packet = JSON.parse(raw) as EvidencePacket;
    // 旧证据包没有时钟偏差字段：按当前流水线规则补算，保证回放与在线一致
    const timeWindow = packet.timeWindow;
    if (timeWindow && timeWindow.suspectedClockOffsetHours === undefined && timeWindow.overlap === false
      && timeWindow.commentStart && timeWindow.commentEnd) {
      const offset = detectClockOffsetHours({
        issueKey: packet.issueKey,
        ruleGroupId: packet.ruleGroupId,
        ruleGroupName: packet.ruleGroupName,
        carModel: packet.carModel,
        commentTimeWindow: { start: timeWindow.commentStart, end: timeWindow.commentEnd, source: timeWindow.source },
        traceStartTime: timeWindow.traceStart,
        traceEndTime: timeWindow.traceEnd,
        signalMatches: [],
        signalIdRecords: [],
      });
      if (offset !== undefined) timeWindow.suspectedClockOffsetHours = offset;
    }
    return packet;
  } catch {
    return null;
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

function matchEvalEntry(ticketDir: string, evalSet: EvalSetEntry[], logRoot: string): EvalSetEntry | undefined {
  return evalSet.find((entry) => {
    const expected = path.join(logRoot, entry.ruleGroupDir, entry.carModelDir, entry.issueKey);
    return path.resolve(ticketDir) === path.resolve(expected);
  });
}

export async function buildAccuracyReport(root = process.cwd()): Promise<void> {
  const LOG_ROOT = path.join(root, "log");
  const output = path.join(root, "docs/golden-baseline");
  await mkdir(output, { recursive: true });
  const EVAL_SET_PATH = path.join(output, "eval-set.json");
  const REPORT_JSON = path.join(output, "eval-report.json");
  const REPORT_MD = path.join(output, "eval-report.md");
  const ticketDirs = await collectEvalTicketDirs(LOG_ROOT);
  const evalSet = await loadEvalSet(EVAL_SET_PATH);
  const results: TicketResult[] = [];
  const skipped: string[] = [];

  for (const { runDir: ticketDir, ticketDir: ticketKeyDir } of ticketDirs) {
    const replyText = await readTextSafe(path.join(ticketDir, "final_reply.md"));
    const {
      sources: evidenceSources,
      missingEvidenceSources,
      evidenceReadErrors,
      evidenceSourceErrors,
    } = await buildEvidenceSources(ticketDir);
    const evidenceText = evidenceSources.map((source) => source.text).join("\n");
    if (!replyText.trim()) {
      skipped.push(path.relative(LOG_ROOT, ticketDir));
      continue;
    }
    const commentsText = await readTextSafe(path.join(ticketDir, "input_comments.txt"));
    const groundingSources = withSupplementalCommentSource(evidenceSources, commentsText);
    const grounding = computeGrounding(replyText, groundingSources);
    const groundingUnknown = evidenceSources.length === 0 && grounding.total === 0;
    const result: TicketResult = {
      ticketDir: path.relative(LOG_ROOT, ticketDir),
      egr: groundingUnknown ? null : Number(grounding.ratio.toFixed(4)),
      groundingStatus: groundingUnknown ? "unknown_missing_evidence" : "evaluated",
      total: grounding.total,
      ungrounded: grounding.ungrounded.map((u) => u.rawText),
      ungroundedAudit: grounding.ungrounded,
      missingEvidenceSources,
      evidenceReadErrors,
      evidenceSourceErrors,
      errorCategories: [],
      riskFlags: [],
      topMissingEvidence: [],
    };

    const evalEntry = matchEvalEntry(ticketKeyDir, evalSet, LOG_ROOT);
    if (evalEntry) {
      const signalsRaw = await readTextSafe(path.join(ticketDir, "signals.json"));
      const replyLower = replyText.toLowerCase();
      const expectedSignals = evalEntry.expectedSignals ?? [];
      const signalHits = expectedSignals.filter((sig) =>
        signalsRaw.toUpperCase().includes(sig.toUpperCase()),
      ).length;
      result.signalRecall = expectedSignals.length
        ? Number((signalHits / expectedSignals.length).toFixed(4))
        : undefined;
      const expectedKeywords = evalEntry.expectedKeywords ?? [];
      const keywordHits = expectedKeywords.filter((kw) =>
        replyLower.includes(kw.toLowerCase()),
      ).length;
      result.keywordHitRate = expectedKeywords.length
        ? Number((keywordHits / expectedKeywords.length).toFixed(4))
        : undefined;
    }

    const evidencePacket = await loadEvidencePacket(ticketDir);
    const classification = classifyEvidenceErrors({
      replyText,
      evidenceText,
      evidenceSources: groundingSources,
      evidencePacket,
      expectedSignals: evalEntry?.expectedSignals,
      signalRecall: result.signalRecall,
    });
    result.errorCategories = classification.errorCategories;
    result.riskFlags = classification.riskFlags;
    result.topMissingEvidence = classification.topMissingEvidence;

    results.push(result);
  }

  const egrValues = results
    .map((r) => r.egr)
    .filter((egr): egr is number => egr !== null);
  const meanEgr = egrValues.length
    ? Number((egrValues.reduce((a, b) => a + b, 0) / egrValues.length).toFixed(4))
    : null;
  const evaluatedEgrCount = egrValues.length;
  const unknownEgrCount = results.length - evaluatedEgrCount;
  const labeled = results.filter((r) => r.signalRecall !== undefined);
  const meanSignalRecall = labeled.length
    ? Number((labeled.reduce((a, b) => a + (b.signalRecall ?? 0), 0) / labeled.length).toFixed(4))
    : null;
  const keyworded = results.filter((r) => r.keywordHitRate !== undefined);
  const meanKeywordHit = keyworded.length
    ? Number((keyworded.reduce((a, b) => a + (b.keywordHitRate ?? 0), 0) / keyworded.length).toFixed(4))
    : null;
  const categoryCounts = results.reduce<Record<string, number>>((acc, item) => {
    for (const category of item.errorCategories) {
      acc[category] = (acc[category] ?? 0) + 1;
    }
    return acc;
  }, {});

  const report = {
    generatedAt: new Date().toISOString(),
    ticketCount: results.length,
    skippedCount: skipped.length,
    meanEgr,
    evaluatedEgrCount,
    unknownEgrCount,
    meanSignalRecall,
    meanKeywordHit,
    categoryCounts,
    tickets: results,
    skipped,
  };

  await writeFile(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  const mdLines: string[] = [];
  mdLines.push(`# Jira 解票准确率评测报告`);
  mdLines.push("");
  mdLines.push(`- 生成时间：${report.generatedAt}`);
  mdLines.push(`- 评测票数：${report.ticketCount}（跳过 ${report.skippedCount}）`);
  mdLines.push(`- 平均证据接地率 EGR：**${meanEgr === null ? "N/A" : `${(meanEgr * 100).toFixed(1)}%`}**`);
  mdLines.push(`- EGR 有效评测票数：${evaluatedEgrCount}；未知票数：${unknownEgrCount}（未知票不计入均值）`);
  mdLines.push(`- 平均信号召回率：${meanSignalRecall === null ? "N/A" : `${(meanSignalRecall * 100).toFixed(1)}%`}`);
  mdLines.push(`- 平均结论关键判断命中率：${meanKeywordHit === null ? "N/A" : `${(meanKeywordHit * 100).toFixed(1)}%`}`);
  mdLines.push("");
  mdLines.push("## 错误归因聚合");
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  if (sortedCategories.length === 0) {
    mdLines.push("- 未发现可归因错误分类");
  } else {
    for (const [category, count] of sortedCategories) {
      mdLines.push(`- ${category}: ${count}`);
    }
  }
  mdLines.push("");
  mdLines.push("## 证据来源审计");
  const incompleteEvidence = results.filter((result) => (
    result.missingEvidenceSources.length > 0
      || result.evidenceReadErrors.length > 0
      || result.evidenceSourceErrors.length > 0
  ));
  if (incompleteEvidence.length === 0) {
    mdLines.push("- 所有评测票均读取到完整证据来源");
  } else {
    for (const result of incompleteEvidence) {
      const readErrors = result.evidenceReadErrors
        .map((item) => `${item.source}: ${item.error}`)
        .join(" | ");
      const sourceErrors = result.evidenceSourceErrors
        .map((item) => `${item.source} (${item.type}): ${item.error}`)
        .join(" | ");
      mdLines.push(`- \`${result.ticketDir}\` missingEvidenceSources: ${result.missingEvidenceSources.join(", ") || "none"}; evidenceReadErrors: ${readErrors || "none"}; evidenceSourceErrors: ${sourceErrors || "none"}`);
    }
  }
  mdLines.push("");
  mdLines.push(`## 未接地断言热点（前 20 票）`);
  for (const r of results.filter((x) => x.ungrounded.length > 0).slice(0, 20)) {
    mdLines.push(`### \`${r.ticketDir}\``);
    const ticketEgr = r.egr === null ? "N/A" : `${(r.egr * 100).toFixed(0)}%`;
    mdLines.push(`EGR ${ticketEgr}，分类 ${r.errorCategories.join(", ") || "none"}`);
    mdLines.push(`missingEvidenceSources: ${r.missingEvidenceSources.join(", ") || "none"}`);
    for (const item of r.ungroundedAudit) {
      const rawText = item.rawText.replace(/\s+/g, " ").trim();
      mdLines.push(`- rawText: ${rawText}; missReason: ${item.missReason ?? "unknown"}; checkedEvidenceSources: ${item.checkedEvidenceSources.join(", ") || "none"}`);
    }
  }
  await writeFile(REPORT_MD, mdLines.join("\n"), "utf8");
  await buildEvalSetCoverageReport(root);

  const meanEgrLabel = meanEgr === null ? "N/A" : `${(meanEgr * 100).toFixed(1)}%`;
  console.log(`评测完成：${report.ticketCount} 票，平均 EGR ${meanEgrLabel}，跳过 ${report.skippedCount}`);
}
