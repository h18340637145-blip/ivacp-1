import fs from "node:fs/promises";
import { applyIssueSceneReplyTag } from "@/domain/analysis/issue-scene";
import { chat } from "@/server/ai/qwen";
import { DEFAULT_LOG_SUMMARY, MEEGLE_MISSING_ANALYSIS_ATTACHMENTS_REPLY } from "@/server/pipeline/constants";
import { scheduleSuccessArchiveToDocupedia } from "@/server/pipeline/docupedia-archive";
import { recordMetricStage, setPromptMetric } from "@/server/pipeline/metrics";
import { saveStepLog } from "@/server/pipeline/paths-logging";
import { stripThinkTags } from "@/server/pipeline/step5";
import type { ClassifiedAttachments, ProcessResponse } from "@/server/pipeline/types";
import type { ProcessContext } from "@/server/pipeline/process/context";
import { buildEarlyResponse, finishEarly } from "@/server/pipeline/process/finish";
import { commentStagingRoot } from "@/server/pipeline/process/prepare";

/** 飞书项目工单缺少 CAN trace / 日志包：直接返回固定结论 */
export async function finishMeegleMissingAttachments(
  ctx: ProcessContext,
  classified: ClassifiedAttachments,
  commentsText: string,
): Promise<ProcessResponse> {
  await fs.rm(commentStagingRoot(ctx), { recursive: true, force: true });
  ctx.stages.GENERATING_REPLY = "缺少 CAN trace 或日志包，返回固定结论";
  await saveStepLog(ctx.logRoot, "input_comments.txt", commentsText);
  await finishEarly(ctx, { replyText: MEEGLE_MISSING_ANALYSIS_ATTACHMENTS_REPLY, status: "rejected", mode: classified.mode });
  return buildEarlyResponse(ctx, {
    replyText: MEEGLE_MISSING_ANALYSIS_ATTACHMENTS_REPLY,
    model: process.env.QWEN_MODEL ?? "",
    mode: classified.mode,
  });
}

/** 附件时间关系不满足分析条件（reject）：返回拒绝原因 */
export async function finishRejected(ctx: ProcessContext, classified: ClassifiedAttachments): Promise<ProcessResponse> {
  await fs.rm(commentStagingRoot(ctx), { recursive: true, force: true });
  ctx.logger.log("REJECT", classified.reason);
  await finishEarly(ctx, { replyText: classified.reason, status: "rejected", mode: classified.mode });
  return buildEarlyResponse(ctx, {
    replyText: classified.reason,
    model: process.env.QWEN_MODEL ?? "Qwen3-32B-FP16",
    mode: classified.mode,
  });
}

/** 无附件：仅基于评论做一次 AI 摘要分析 */
export async function finishWithoutAttachments(ctx: ProcessContext, commentsText: string): Promise<ProcessResponse> {
  const { logger, metrics, logRoot, request, issueScene, issueScenePromptBlock } = ctx;
  logger.log("AI_SUMMARY", "无附件，仅基于评论进行 AI 分析…");
  const systemPrompt = request.prompts.LOG_SUMMARY_SYSTEM?.trim() || DEFAULT_LOG_SUMMARY;
  const aiSummaryStarted = Date.now();
  const summaryInput = [issueScenePromptBlock, commentsText].filter(Boolean).join("\n\n");
  let replyText = await chat(systemPrompt, summaryInput);
  recordMetricStage(metrics, "AI_SUMMARY", aiSummaryStarted);
  setPromptMetric(metrics, "AI_SUMMARY", summaryInput, replyText);
  logger.log("AI_SUMMARY", `AI 分析完成，${replyText.length} 字符`);

  // Strip <think> tags
  await saveStepLog(logRoot, "final_reply_raw.md", replyText);
  const stripped = stripThinkTags(replyText);
  if (stripped.thinking) await saveStepLog(logRoot, "final_thinking.md", stripped.thinking);
  replyText = applyIssueSceneReplyTag(stripped.cleaned, issueScene);

  ctx.stages.GENERATING_REPLY = "AI 分析完成";
  await finishEarly(ctx, { replyText, status: "success", mode: "no_attachments" });
  scheduleSuccessArchiveToDocupedia({
    issueKey: ctx.issueKey,
    summary: ctx.summary,
    ruleGroupName: ctx.groupDirName,
    carModel: ctx.carModel || "unknown",
    logRoot,
    logger,
  });
  return buildEarlyResponse(ctx, { replyText, model: process.env.QWEN_MODEL ?? "", mode: "no_attachments" });
}
