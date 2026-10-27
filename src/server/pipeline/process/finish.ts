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
  args: { replyText: string; status: PipelineMetrics["status"]; mode: AttachmentMode },
): Promise<void> {
  const { issueKey, ruleGroupId, carModel, metrics, stages, startTime, logRoot, logger } = ctx;
  await saveStepLog(logRoot, "final_reply.md", args.replyText);
  metrics.counts.finalReplyChars = args.replyText.length;
  finalizePipelineMetrics(metrics, args.status, args.mode);
  await savePipelineMetrics(logRoot, metrics);
  await saveStagesJson(ctx, { issueKey, ruleGroupId, carModel: carModel || "unknown", mode: args.mode, stages, elapsedMs: Date.now() - startTime });
  await logger.flush(logRoot);
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
