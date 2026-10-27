import { hasMeaningfulGroundingSource, withSupplementalCommentSource } from "@/domain/analysis/grounding-evidence-sources";
import { buildErrorPatternBlock, buildReviewSamplePromptBlocks } from "@/domain/analysis/review-sample";
import type { GroundingEvidenceSource } from "@/domain/analysis/structured-evidence-validation";
import { chat } from "@/server/ai/qwen";
import { MAX_STEP5_CAN_SUMMARY_CHARS, MAX_STEP5_RAW_CAN_CHARS, MIN_STEP5_CAN_SUMMARY_CHARS } from "@/server/pipeline/constants";
import { recordMetricStage, setPromptMetric } from "@/server/pipeline/metrics";
import { saveStepLog } from "@/server/pipeline/paths-logging";
import {
  buildStep5MergedPrompt,
  isHighPriorityIssue,
  rerankFewShotSamplesByEvidence,
  runEvidenceSelfCritique,
  runStep5Conclusion,
  stripThinkTags,
} from "@/server/pipeline/step5";
import type { ClassifiedAttachments } from "@/server/pipeline/types";
import type { ProcessContext } from "@/server/pipeline/process/context";
import type { EvidenceBundle } from "@/server/pipeline/process/evidence-stage";
import { logSummaryPrompt } from "@/server/pipeline/process/log-summary-stage";
import type { SignalMatchResult } from "@/server/pipeline/process/signals-stage";

export interface ConclusionInputs {
  classified: ClassifiedAttachments;
  commentsText: string;
  aiRequirements: string;
  aiSignals: string;
  aiUpperSummary: string;
  aiAndroidQnxSummary: string;
  upperBundle: string;
  canTraceText: string;
  signals: SignalMatchResult;
  evidence: EvidenceBundle;
}

function buildSignalsJsonBlock(signals: SignalMatchResult, evidence: EvidenceBundle): string {
  return [
    "<信号配置与特性映射 (signals.json)>",
    JSON.stringify({
      rawTokens: signals.rawSignalTokens,
      matches: signals.exactMatches,
      recovered: signals.recoveredMatches.map((match) => ({
        sourceToken: match.sourceToken,
        matchedBy: match.matchedBy,
        prop: match.prop,
        similarity: match.similarity,
      })),
      unmatched: signals.unmatchedTokens,
      messageCharacteristics: evidence.canPlotResult?.msg_characteristics,
    }, null, 2),
    "</信号配置与特性映射 (signals.json)>",
  ].join("\n");
}

/** Step 5：最终结论（一致性分析 / CAN 对比 / 摘要兜底） */
export async function runFinalConclusion(ctx: ProcessContext, input: ConclusionInputs): Promise<string> {
  const { logger, metrics, rawData, request, issueScenePromptBlock, fewShotSamples } = ctx;
  const { classified, commentsText, aiRequirements, aiSignals, aiUpperSummary, aiAndroidQnxSummary, upperBundle, canTraceText, evidence } = input;
  const { canTraceExtractedResult, rawCanTracePreview } = evidence;
  const summaryPrompt = logSummaryPrompt(ctx);
  let finalReply = "";

  // High-priority issues use self-consistency voting in Step 5 for accuracy.
  const highPriority = isHighPriorityIssue(rawData.priority);
  if (highPriority) {
    logger.log("AI_STEP5", `检测到高优先级票（priority=${String(rawData.priority ?? "—")}），Step5 将启用自洽投票`);
  }

  const evidenceRerankedFewShotSamples = rerankFewShotSamplesByEvidence(fewShotSamples, evidence.evidencePacket);
  const { correctionBlock, approvedBlock } = buildReviewSamplePromptBlocks(evidenceRerankedFewShotSamples);
  const errorPatternBlock = buildErrorPatternBlock(request.errorPatterns);
  logger.log(
    "AI_STEP5",
    `注入 ${evidenceRerankedFewShotSamples.length} 条证据精召回案例（纠错与人工确认案例分区）`,
  );

  const signalsJsonBlock = buildSignalsJsonBlock(input.signals, evidence);
  const evidencePacketBlock = [
    "<结构化证据包>",
    evidence.evidencePacketText,
    "</结构化证据包>",
  ].join("\n");

  if (classified.mode === "both" || classified.mode === "can_in_zip") {
    const consistencyPrompt = request.prompts.CONSISTENCY_SYSTEM?.trim();
    if (consistencyPrompt && canTraceText) {
      logger.log("AI_STEP5", "正在进行一致性分析（CAN + 日志联合）…");
      const t0 = Date.now();
      const merged = buildStep5MergedPrompt([
        { name: "问题场景", content: issueScenePromptBlock, minChars: issueScenePromptBlock.length, trimPriority: 0 },
        { name: "历史纠错案例", content: correctionBlock, minChars: 750, trimPriority: 50 },
        { name: "历史正确案例", content: approvedBlock, minChars: 750, trimPriority: 50 },
        { name: "历史错误模式", content: errorPatternBlock, minChars: 300, trimPriority: 45 },
        { name: "结构化证据包", content: evidencePacketBlock, minChars: 2_000, trimPriority: 5 },
        { name: "信号配置与特性映射 (signals.json)", content: signalsJsonBlock, minChars: 1_000, trimPriority: 40 },
        { name: "需求描述", content: aiRequirements ? `<需求描述>\n${aiRequirements}\n</需求描述>` : "", minChars: 1_500, trimPriority: 60 },
        { name: "上层日志摘要", content: `<上层日志摘要>\n${aiUpperSummary}\n</上层日志摘要>`, minChars: 1_500, trimPriority: 80 },
        { name: "Android+QNX日志", content: aiAndroidQnxSummary ? `<Android+QNX日志>\n${aiAndroidQnxSummary}\n</Android+QNX日志>` : "", minChars: 2_000, trimPriority: 90 },
        { name: "CAN Trace提取结果", content: canTraceExtractedResult, minChars: MIN_STEP5_CAN_SUMMARY_CHARS, maxChars: MAX_STEP5_CAN_SUMMARY_CHARS + 200, trimPriority: 10 },
        { name: "CAN Trace日志片段", content: rawCanTracePreview, minChars: 0, maxChars: MAX_STEP5_RAW_CAN_CHARS + 200, trimPriority: 100 },
      ], logger);
      finalReply = await runStep5Conclusion(consistencyPrompt, merged, highPriority, logger);
      recordMetricStage(metrics, "AI_STEP5", t0);
      setPromptMetric(metrics, "AI_STEP5", merged, finalReply);
      logger.log("AI_STEP5", `一致性分析完成，${finalReply.length} 字符，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else {
      const t0 = Date.now();
      finalReply = aiAndroidQnxSummary || aiUpperSummary ||
        await chat(summaryPrompt, [issueScenePromptBlock, upperBundle].filter(Boolean).join("\n\n"));
      recordMetricStage(metrics, "AI_STEP5", t0);
      setPromptMetric(metrics, "AI_STEP5", upperBundle, finalReply);
      logger.log("AI_STEP5", "使用日志摘要作为最终结果（无 CAN trace 或无一致性 prompt）");
    }
  } else if (classified.mode === "can_only") {
    const comparePrompt = request.prompts.COMPARE_CANTRACE?.trim();
    if (comparePrompt && canTraceText) {
      logger.log("AI_STEP5", "正在进行一致性分析（CAN trace 对比）…");
      const t0 = Date.now();
      const merged = buildStep5MergedPrompt([
        { name: "问题场景", content: issueScenePromptBlock, minChars: issueScenePromptBlock.length, trimPriority: 0 },
        { name: "历史纠错案例", content: correctionBlock, minChars: 750, trimPriority: 50 },
        { name: "历史正确案例", content: approvedBlock, minChars: 750, trimPriority: 50 },
        { name: "历史错误模式", content: errorPatternBlock, minChars: 300, trimPriority: 45 },
        { name: "结构化证据包", content: evidencePacketBlock, minChars: 2_000, trimPriority: 5 },
        { name: "信号配置与特性映射 (signals.json)", content: signalsJsonBlock, minChars: 1_000, trimPriority: 40 },
        { name: "信号提取", content: aiSignals ? `<信号提取>\n${aiSignals}\n</信号提取>` : "", minChars: 1_000, trimPriority: 60 },
        { name: "上层评论", content: `<上层评论>\n${commentsText}\n</上层评论>`, minChars: 2_000, trimPriority: 90 },
        { name: "CAN Trace提取结果", content: canTraceExtractedResult, minChars: MIN_STEP5_CAN_SUMMARY_CHARS, maxChars: MAX_STEP5_CAN_SUMMARY_CHARS + 200, trimPriority: 10 },
        { name: "CAN Trace日志片段", content: rawCanTracePreview, minChars: 0, maxChars: MAX_STEP5_RAW_CAN_CHARS + 200, trimPriority: 100 },
      ], logger);
      finalReply = await runStep5Conclusion(comparePrompt, merged, highPriority, logger);
      recordMetricStage(metrics, "AI_STEP5", t0);
      setPromptMetric(metrics, "AI_STEP5", merged, finalReply);
      logger.log("AI_STEP5", `CAN 对比分析完成，${finalReply.length} 字符，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else {
      const t0 = Date.now();
      const fallbackPrompt = [issueScenePromptBlock, commentsText].filter(Boolean).join("\n\n") + (canTraceText ? `\n<CAN Trace>\n${canTraceText}\n</CAN Trace>` : "");
      finalReply = await chat(summaryPrompt, fallbackPrompt);
      recordMetricStage(metrics, "AI_STEP5", t0);
      setPromptMetric(metrics, "AI_STEP5", fallbackPrompt, finalReply);
      logger.log("AI_STEP5", "使用摘要 prompt 完成分析（无对比 prompt）");
    }
  }

  if (!finalReply) {
    logger.log("AI_STEP5", "兜底：仅基于评论进行摘要分析…");
    const t0 = Date.now();
    finalReply = await chat(summaryPrompt, [issueScenePromptBlock, commentsText].filter(Boolean).join("\n\n"));
    recordMetricStage(metrics, "AI_STEP5", t0);
    setPromptMetric(metrics, "AI_STEP5", commentsText, finalReply);
  }
  return finalReply;
}

/** 剥离 <think>（思考过程落盘），再基于证据源做自我批判校正（U3 grounding） */
export async function refineFinalReply(
  ctx: ProcessContext,
  finalReply: string,
  args: { commentsText: string; signals: SignalMatchResult; evidence: EvidenceBundle },
): Promise<string> {
  const { logRoot, metrics, logger } = ctx;
  const { commentsText, signals, evidence } = args;

  /* ── Strip <think> tags — save thinking to log, keep only conclusion ── */
  await saveStepLog(logRoot, "final_reply_raw.md", finalReply);
  const finalStripped = stripThinkTags(finalReply);
  if (finalStripped.thinking) {
    await saveStepLog(logRoot, "final_thinking.md", finalStripped.thinking);
  }
  let reply = finalStripped.cleaned;

  const u3AllEvidenceSources: GroundingEvidenceSource[] = [
    { name: "evidence_packet", text: evidence.evidencePacketText },
    { name: "can_signal_summary", text: evidence.canPlotResult.summary },
    { name: "can_trace_extracted_result", text: evidence.canPlotResult.summary },
    { name: "signals_id", text: JSON.stringify(signals.signalIdRecords) },
    { name: "extract", text: evidence.extractMarkdown },
  ];
  const u3EvidenceSources = withSupplementalCommentSource(
    u3AllEvidenceSources.filter(hasMeaningfulGroundingSource),
    commentsText,
  );
  const missingEvidenceSources = u3AllEvidenceSources
    .filter((source) => !hasMeaningfulGroundingSource(source))
    .map((source) => source.name);
  const u3PromptEvidenceSources: GroundingEvidenceSource[] = [
    { name: "evidence_packet", text: evidence.evidencePacketText },
    { name: "can_signal_summary", text: evidence.step5CanTrace.decodedSummary },
    { name: "signals_id", text: JSON.stringify(signals.signalIdRecords) },
    { name: "extract", text: evidence.extractMarkdown },
  ];
  const u3EvidenceText = withSupplementalCommentSource(
    u3PromptEvidenceSources.filter(hasMeaningfulGroundingSource),
    commentsText,
  )
    .map((source) => source.text)
    .join("\n");
  reply = await runEvidenceSelfCritique(
    reply,
    u3EvidenceText,
    u3EvidenceSources,
    missingEvidenceSources,
    logRoot,
    metrics,
    logger,
  );
  return reply;
}
