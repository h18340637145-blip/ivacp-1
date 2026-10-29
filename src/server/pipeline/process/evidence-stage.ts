import { buildEvidencePacket, type EvidencePacket } from "@/domain/analysis/evidence-packet";
import { reviewEvidenceFromEvidencePacket } from "@/domain/analysis/review-sample";
import type { ReviewEvidence } from "@/domain/entities";
import { buildExtractMarkdown, buildFilteredLogsBySignalIds, extractCommentTimeWindow } from "@/server/pipeline/log-extract";
import { extractLogVersions, formatLogVersions } from "@/server/pipeline/log-versions";
import { extractVhalVersion, formatVhalVersion } from "@/server/pipeline/vhal-version";
import { recordMetricStage } from "@/server/pipeline/metrics";
import { saveStepLog } from "@/server/pipeline/paths-logging";
import { awaitCanSignalExtraction } from "@/server/pipeline/signals";
import { summarizeCanTraceForStep5 } from "@/server/pipeline/step5";
import type { ClassifiedAttachments, PlotResult } from "@/server/pipeline/types";
import type { ProcessContext } from "@/server/pipeline/process/context";
import { buildSignalsJson, type SignalMatchResult } from "@/server/pipeline/process/signals-stage";

export interface EvidenceBundle {
  canPlotResult: PlotResult;
  extractMarkdown: string;
  androidLog: string;
  qnxLog: string;
  evidencePacket: EvidencePacket;
  evidencePacketText: string;
  reviewEvidence: ReviewEvidence;
  step5CanTrace: ReturnType<typeof summarizeCanTraceForStep5>;
  canTraceExtractedResult: string;
  rawCanTracePreview: string;
}

/**
 * 等待 CAN 信号绘图完成 → 按评论时间窗筛选日志（extract.md / Android+QNX）→ 生成结构化证据包，
 * 并准备 Step 5 的 CAN 输入。
 */
export async function collectEvidence(
  ctx: ProcessContext,
  args: {
    classified: ClassifiedAttachments;
    plotPromise: Promise<PlotResult> | null;
    signals: SignalMatchResult;
    commentsText: string;
    extractDir: string;
    canTraceText: string;
    parsingStarted: number | null;
  },
): Promise<EvidenceBundle> {
  const { logger, metrics, logRoot, issueKey, ruleGroupId, groupDirName, carModel } = ctx;
  const { signals, extractDir } = args;

  const canPlotResult = await awaitCanSignalExtraction(args.plotPromise, logger, logRoot);
  if (canPlotResult.msg_characteristics) {
    await saveStepLog(logRoot, "signals.json", buildSignalsJson(signals, canPlotResult.msg_characteristics));
    logger.log("PLOTTING", `已将 ${Object.keys(canPlotResult.msg_characteristics).length} 个报文的特性追加到 signals.json`);
  }
  logger.log("PLOTTING", `CAN trace 录制时间窗: ${canPlotResult.traceStartTime || "unknown"} ~ ${canPlotResult.traceEndTime || "unknown"}`);
  const commentTimeWindow = extractCommentTimeWindow(
    args.commentsText,
    canPlotResult.traceStartTime,
    canPlotResult.traceEndTime,
  );
  metrics.evidenceCompleteness.canSignalSummaryFound = Boolean(canPlotResult.summary);
  metrics.evidenceCompleteness.commentTimeWindowFound = commentTimeWindow.source === "comment_timestamp" || commentTimeWindow.source === "comment_time_only";
  logger.log("PARSING", `日志筛选时间窗(${commentTimeWindow.source}): ${commentTimeWindow.start} ~ ${commentTimeWindow.end}`);

  let extractMarkdown = "";
  let androidLog = "";
  let qnxLog = "";
  let versionFooter = "";
  const hasExtractedLogs = Boolean(args.classified.latestZip && extractDir);
  const logVersions = hasExtractedLogs
    ? await extractLogVersions(extractDir, message => logger.log("VERSION_EXTRACT", message))
    : [];
  logger.log("VERSION_EXTRACT", `日志软件版本提取完成：Buildinfo=${logVersions.length}，SCC=${logVersions.reduce((sum, record) => sum + record.sccVersions.length, 0)}`);
  // Read the rule group's current configuration only after SOC/SCC extraction.
  const vhal = await extractVhalVersion(ctx.request?.basePaths?.proto_dir);
  logger.log("VERSION_EXTRACT", vhal.status === "ok"
    ? `当前配置 VHAL版本：${vhal.version}，VER_PRO_CFG=${vhal.raw}，来源：${vhal.file}`
    : vhal.status === "unavailable" ? `VHAL版本提取失败：${vhal.file}：${vhal.error}` : "未配置 Proto 根目录，跳过 VHAL版本提取");
  let boschVehicleHalHashLines: string[] = [];
  versionFooter = formatLogVersions(logVersions) + formatVhalVersion(vhal);
  if (hasExtractedLogs) {
    extractMarkdown = await buildExtractMarkdown(extractDir, commentTimeWindow, signals.signalIdRecords);
    const filteredLogs = await buildFilteredLogsBySignalIds(extractDir, commentTimeWindow, signals.signalIdRecords);
    boschVehicleHalHashLines = filteredLogs.boschVehicleHalHashLines;
    androidLog = filteredLogs.android;
    qnxLog = filteredLogs.qnx;
  } else {
    extractMarkdown = "# CAN Trace Window Extract\n\n未生成筛选结果：没有解压日志目录。\n";
  }
  await saveStepLog(logRoot, "log-versions.json", JSON.stringify({ schemaVersion: 1, records: logVersions, vhal, boschVehicleHalHashLines }, null, 2));
  metrics.evidenceCompleteness.androidQnxLogLinesFound = Boolean(androidLog.trim() || qnxLog.trim());
  extractMarkdown += versionFooter;
  androidLog += versionFooter;
  metrics.counts.androidLogChars = androidLog.length;
  metrics.counts.qnxLogChars = qnxLog.length;
  await saveStepLog(logRoot, "extract.md", extractMarkdown);
  if (hasExtractedLogs || versionFooter) {
    await saveStepLog(logRoot, "step4_android_qnx_input.md", [
      "<Android日志筛选结果>", androidLog || "空", "</Android日志筛选结果>", "",
      "<QNX日志筛选结果>", qnxLog || "空", "</QNX日志筛选结果>",
    ].join("\n"));
  }

  const evidencePacket = buildEvidencePacket({
    issueKey,
    ruleGroupId,
    ruleGroupName: groupDirName,
    carModel: carModel || "unknown",
    commentTimeWindow,
    traceStartTime: canPlotResult.traceStartTime,
    traceEndTime: canPlotResult.traceEndTime,
    signalMatches: signals.exactMatches.concat(signals.recoveredMatches).map((match) => ({
      prop: match.prop,
      sourceToken: match.sourceToken,
      matchedBy: match.matchedBy,
      matchedSignal: match.matchedSignal,
    })),
    signalIdRecords: signals.signalIdRecords,
    signalSummary: canPlotResult.summary,
    // Version metadata must not turn an empty signal extraction into log evidence.
    extractMarkdown: versionFooter ? extractMarkdown.slice(0, -versionFooter.length) : extractMarkdown,
    androidLog: versionFooter ? androidLog.slice(0, -versionFooter.length) : androidLog,
    qnxLog,
    unmatchedTokens: signals.unmatchedTokens,
  });
  const evidencePacketText = JSON.stringify(evidencePacket, null, 2);
  const reviewEvidence = reviewEvidenceFromEvidencePacket(evidencePacket);
  await saveStepLog(logRoot, "evidence-packet.json", evidencePacketText);
  logger.log("PARSING", `结构化证据包已生成：props=${evidencePacket.matchedProps.length} intervals=${evidencePacket.signalIntervals.length} risks=${evidencePacket.riskFlags.length}`);

  const step5CanTrace = summarizeCanTraceForStep5(canPlotResult.summary, args.canTraceText);
  if (step5CanTrace.trimmed.length > 0) {
    logger.log("AI_STEP5", `Step5 CAN 输入预裁剪：${step5CanTrace.trimmed.join("；")}`);
  }
  const canTraceExtractedResult = step5CanTrace.decodedSummary
    ? `<CAN Trace提取结果>\n${step5CanTrace.decodedSummary}\n</CAN Trace提取结果>`
    : "";
  const rawCanTracePreview = step5CanTrace.rawPreview
    ? `<CAN Trace日志片段>\n${step5CanTrace.rawPreview}\n</CAN Trace日志片段>`
    : "";
  if (args.parsingStarted !== null) {
    recordMetricStage(metrics, "PARSING", args.parsingStarted);
  }

  return {
    canPlotResult,
    extractMarkdown,
    androidLog,
    qnxLog,
    evidencePacket,
    evidencePacketText,
    reviewEvidence,
    step5CanTrace,
    canTraceExtractedResult,
    rawCanTracePreview,
  };
}
