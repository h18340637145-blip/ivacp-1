import fs from "node:fs/promises";
import { publishPipelineSuccess, throwIfPipelineCancelled } from "./runtime";
import path from "node:path";
import { applyIssueSceneReplyTag } from "@/domain/analysis/issue-scene";
import { scheduleSuccessArchiveToDocupedia } from "@/server/pipeline/docupedia-archive";
import { currentQwenTokenUsage } from "@/server/ai/qwen";
import { finalizePipelineMetrics, savePipelineMetrics } from "@/server/pipeline/metrics";
import { saveStepLog } from "@/server/pipeline/paths-logging";
import type { AttachmentMode, PipelineMetrics, ProcessResponse } from "@/server/pipeline/types";
import type { ProcessContext } from "@/server/pipeline/process/context";

/** 写入 stages.json（字段顺序与旧版一致，由调用方组装） */
export async function saveStagesJson(ctx: ProcessContext, payload: Record<string, unknown>): Promise<void> {
  await saveStepLog(ctx.logRoot, "stages.json", JSON.stringify(payload, null, 2));
}

/** 提前结束（拒绝 / 无附件）路径：落盘最终回复 + 指标 + stages.json 并刷新日志 */
export async function finishEarly(
  ctx: ProcessContext,
  args: { replyText: string; status: PipelineMetrics["status"]; mode: AttachmentMode; model?: string },
): Promise<ProcessResponse> {
  const response = buildEarlyResponse(ctx, { ...args, model: args.model ?? process.env.QWEN_MODEL ?? "" });
  if (args.status === "success") {
    await persistSuccess(ctx, response);
    return response;
  }
  const { issueKey, ruleGroupId, carModel, metrics, stages, startTime, logRoot, logger } = ctx;
  await saveStepLog(logRoot, "final_reply.md", args.replyText);
  metrics.counts.finalReplyChars = args.replyText.length;
  finalizePipelineMetrics(metrics, args.status, args.mode);
  await savePipelineMetrics(logRoot, metrics);
  await saveStagesJson(ctx, { issueKey, ruleGroupId, carModel: carModel || "unknown", mode: args.mode, stages, elapsedMs: Date.now() - startTime });
  await logger.flush(logRoot);
  return response;
}

/** 无信号证据时的响应（提前结束路径） */
export function buildEarlyResponse(
  ctx: ProcessContext,
  args: { replyText: string; model: string; mode: AttachmentMode },
): ProcessResponse {
  return {
    tokenUsage: currentQwenTokenUsage(),
    replyText: args.replyText,
    model: args.model,
    issueKey: ctx.issueKey,
    mode: args.mode,
    stages: ctx.stages,
    elapsedMs: Date.now() - ctx.startTime,
    artifactRef: ctx.artifactRef,
    analysisReceipt: ctx.analysisReceipt,
    reviewEvidence: {
      carModel: ctx.carModel || undefined,
      props: [],
      signalTokens: [],
      propertyIds: [],
    },
  };
}

/** 全部阶段成功后持久化当前 run；后台归档只读取当前日志目录。 */
export async function finishSuccess(
  ctx: ProcessContext,
  args: {
    reply: string;
    classified: import("@/server/pipeline/types").ClassifiedAttachments;
    evidence: import("./evidence-stage").EvidenceBundle;
    aiStages: Record<string, string>;
  },
): Promise<ProcessResponse> {
  const replyText = applyIssueSceneReplyTag(args.reply, ctx.issueScene);
  const elapsedMs = Date.now() - ctx.startTime;
  const plot = args.evidence.canPlotResult;
  ctx.metrics.counts.finalReplyChars = replyText.length;
  ctx.logger.log("DONE", `全流程完成，最终结果 ${replyText.length} 字符，总耗时 ${(elapsedMs / 1000).toFixed(1)}s`);
  ctx.logger.log("RESULT", `${ctx.issueKey} ${ctx.summary} 分析摘要：${replyText.slice(0, 300)}`);

  const response: ProcessResponse = {
    tokenUsage: currentQwenTokenUsage(), replyText, model: process.env.QWEN_MODEL ?? "", issueKey: ctx.issueKey,
    mode: args.classified.mode, chartImage: plot.image ? `/api/charts/${path.relative(process.cwd(), plot.image).split(path.sep).join("/")}` : undefined,
    signalSummary: plot.summary || undefined, traceData: plot.trace_data, ticks: plot.ticks, reviewEvidence: args.evidence.reviewEvidence,
    elapsedMs, artifactRef: ctx.artifactRef, analysisReceipt: ctx.analysisReceipt,
    stages: { ...ctx.stages, ...Object.fromEntries(Object.entries(args.aiStages).map(([key, value]) => [key, `${value.slice(0, 100)}…`])) },
  };
  await persistSuccess(ctx, response, args.aiStages);
  scheduleSuccessArchiveToDocupedia({ issueKey: ctx.issueKey, summary: ctx.summary, ruleGroupName: ctx.groupDirName, carModel: ctx.carModel || "unknown", logRoot: ctx.logRoot, logger: ctx.logger });
  return response;
}

/** full / early 成功共用严格落盘顺序；指标是唯一完成标记。 */
async function persistSuccess(ctx: ProcessContext, response: ProcessResponse, aiStages: Record<string, string> = {}): Promise<void> {
  const storedResponse = { ...response, artifactRef: undefined, analysisReceipt: undefined };
  ctx.metrics.counts.finalReplyChars = response.replyText.length;
  await fs.writeFile(path.join(ctx.logRoot, "final_reply.md"), response.replyText, "utf8");
  await fs.writeFile(path.join(ctx.logRoot, "stages.json"), JSON.stringify({
    issueKey: ctx.issueKey, ruleGroupId: ctx.ruleGroupId, carModel: ctx.carModel || "unknown",
    mode: response.mode, elapsedMs: response.elapsedMs, stages: response.stages,
    aiStages: Object.fromEntries(Object.entries(aiStages).map(([key, value]) => [key, value.slice(0, 200)])),
  }, null, 2), "utf8");
  await fs.writeFile(path.join(ctx.logRoot, "process-response.json"), JSON.stringify(storedResponse, null, 2), "utf8");
  await ctx.logger.flush(ctx.logRoot);
  throwIfPipelineCancelled();
  ctx.metrics.responseArtifactVersion = 1;
  finalizePipelineMetrics(ctx.metrics, "success", response.mode as AttachmentMode);
  const pendingMetrics = path.join(ctx.logRoot, "pipeline-metrics.json.pending");
  await publishPipelineSuccess(async () => {
    try {
      await fs.writeFile(pendingMetrics, JSON.stringify(ctx.metrics, null, 2), "utf8");
      throwIfPipelineCancelled();
      await fs.rename(pendingMetrics, path.join(ctx.logRoot, "pipeline-metrics.json"));
    } finally { await fs.rm(pendingMetrics, { force: true }).catch(() => undefined); }
  });
}
