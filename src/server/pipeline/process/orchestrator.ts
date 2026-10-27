import { HttpError } from "@/server/http/route";
import { fetchMeegleHandoverAt } from "@/server/handover/handover";
import { randomUUID } from "node:crypto";
import { registerAnalysisRun } from "@/server/artifacts/analysis-run-registry";
import { terminatePipelineChildren, withAnalysisRun } from "./runtime";
import fs from "node:fs/promises";
import { runQwenRequest } from "@/server/ai/qwen";
import { getJiraConnection } from "@/server/jira/connection";
import { MAX_COMMENTS_CHARS } from "@/server/pipeline/constants";
import { classifyAttachments, processImageAttachments } from "@/server/pipeline/jira-attachments";
import { finalizePipelineMetrics, savePipelineMetrics } from "@/server/pipeline/metrics";
import { saveStepLog } from "@/server/pipeline/paths-logging";
import type { ProcessRequest, ProcessResponse } from "@/server/pipeline/types";
import { createProcessContext, type ProcessContext } from "./context";
import { prepareIssueData, loadModelConfig, stageCommentAttachments, commentStagingRoot } from "./prepare";
import { finishMeegleMissingAttachments, finishRejected, finishWithoutAttachments } from "./early-exit";
import { downloadAndExtractAttachments } from "./fetch-attachments";
import { runRequirementStep, runSignalExtractStep, matchSignalsToConfig, readCanTracePreview, startCanSignalPlot } from "./signals-stage";
import { buildUpperBundle, runUpperSummaryStep, runAndroidQnxStep } from "./log-summary-stage";
import { collectEvidence } from "./evidence-stage";
import { runFinalConclusion, refineFinalReply } from "./conclusion-stage";
import { appendBoschMainVersion } from "./version-extract";
import { finishSuccess, saveStagesJson } from "./finish";

/** 各阶段共享同一个取消信号；取消后不再启动后续模型或归档。 */
export async function processIssue(request: ProcessRequest, signal?: AbortSignal): Promise<ProcessResponse> {
  // 飞书运行跨刷新保留，只接受 registry 的显式停止。
  if (request.source === "meegle") signal = undefined;
  signal?.throwIfAborted();
  request = request.source === "meegle" ? { ...request, runId: request.runId || randomUUID() } : request;
  let handle: ReturnType<typeof registerAnalysisRun> | undefined;
  if (request.source === "meegle") {
    try { handle = registerAnalysisRun({ runId: request.runId!, source: "meegle", issueKey: request.issueKey }); }
    catch { throw new HttpError(409, "该分析运行已登记，请恢复结果或使用新的 runId"); }
  }
  const combinedSignal = handle?.signal ?? signal;
  try {
    return await withAnalysisRun(handle, () => runQwenRequest(async () => {
      combinedSignal?.throwIfAborted();
      const ctx = await createProcessContext(request);
      handle?.setLogRoot(ctx.logRoot);
      try {
        const result = await runStages(ctx, combinedSignal);
        const { projectKey, workItemId } = request.rawData;
        const handover = request.source === "meegle" && typeof projectKey === "string" && typeof workItemId === "string"
          ? await fetchMeegleHandoverAt(projectKey, workItemId)
          : undefined;
        return handover ? { ...result, handoverAt: handover.toISOString() } : result;
      } catch (caught) {
        const error = combinedSignal?.aborted ? combinedSignal.reason : caught;
        ctx.stages.ERROR = String(error).slice(0, 200);
        ctx.logger.log("ERROR", ctx.stages.ERROR);
        finalizePipelineMetrics(ctx.metrics, "failed", ctx.metrics.mode);
        await savePipelineMetrics(ctx.logRoot, ctx.metrics);
        await saveStagesJson(ctx, { issueKey: ctx.issueKey, ruleGroupId: ctx.ruleGroupId, error: String(error), stages: ctx.stages, elapsedMs: Date.now() - ctx.startTime });
        await ctx.logger.flush(ctx.logRoot);
        throw error;
      } finally {
        await fs.rm(commentStagingRoot(ctx), { recursive: true, force: true });
      }
    }, combinedSignal), combinedSignal);
  } finally { handle?.dispose(); }
}

async function runStages(ctx: ProcessContext, signal?: AbortSignal): Promise<ProcessResponse> {
  const check = () => signal?.throwIfAborted();
  check();
  const preparingStarted = Date.now();
  const prepared = await prepareIssueData(ctx);
  const config = await loadModelConfig(ctx);
  check();
  const staged = await stageCommentAttachments(ctx, prepared.liveAttachments);
  const classified = classifyAttachments(staged.attachments);
  ctx.metrics.mode = classified.mode;
  ctx.metrics.stageDurationsMs.PREPARING = Date.now() - preparingStarted;
  ctx.stages.DOWNLOADING = `模式: ${classified.mode} — ${classified.reason}`;
  ctx.logger.log("CLASSIFYING", ctx.stages.DOWNLOADING);
  let commentsText = prepared.commentsText;
  if (ctx.request.source === "meegle" && classified.mode === "no_attachments") {
    check();
    return finishMeegleMissingAttachments(ctx, classified, commentsText);
  }
  const ocrText = await processImageAttachments(staged.attachments, ctx.attachRoot, getJiraConnection(ctx.request.jiraProvider).username, ctx.logger, ctx.meegleIdentity, staged.stagedPaths);
  commentsText = (commentsText + ocrText).slice(0, MAX_COMMENTS_CHARS);
  await saveStepLog(ctx.logRoot, "input_comments.txt", commentsText);
  check();
  if (classified.mode === "reject") return finishRejected(ctx, classified);
  if (classified.mode === "no_attachments") return finishWithoutAttachments(ctx, commentsText);

  const downloaded = await downloadAndExtractAttachments(ctx, classified, staged.attachments, staged.stagedPaths);
  const aiStages: Record<string, string> = {};
  check();
  const aiRequirements = await runRequirementStep(ctx, commentsText, aiStages);
  check();
  const aiSignals = await runSignalExtractStep(ctx, { jsonContent: config.jsonContent, commentsText, aiRequirements }, aiStages);
  check();
  const signals = await matchSignalsToConfig(ctx, { aiSignals, commentsText, config });
  check();
  const preview = await readCanTracePreview(ctx, downloaded.canTracePath, signals);
  const plotPromise = startCanSignalPlot(ctx, downloaded.canTracePath, signals);
  // 立即挂上 rejection handler，避免 Step3 仍在执行时子进程失败产生未处理异常。
  if (plotPromise) void plotPromise.catch(() => undefined);
  try {
    const upperBundle = buildUpperBundle(commentsText, aiRequirements, aiSignals);
    const aiUpperSummary = await runUpperSummaryStep(ctx, classified, upperBundle, aiStages);
    check();
    const evidence = await collectEvidence(ctx, { classified, plotPromise, signals, commentsText, extractDir: downloaded.extractDir, ...preview });
    check();
    const aiAndroidQnxSummary = await runAndroidQnxStep(ctx, evidence.androidLog, evidence.qnxLog, aiStages);
    check();
    let reply = await runFinalConclusion(ctx, { classified, commentsText, aiRequirements, aiSignals, aiUpperSummary, aiAndroidQnxSummary, upperBundle, canTraceText: preview.canTraceText, signals, evidence });
    check();
    reply = await refineFinalReply(ctx, reply, { commentsText, signals, evidence });
    reply = await appendBoschMainVersion(reply, downloaded.extractDir, ctx.logger);
    check();
    return await finishSuccess(ctx, { reply, classified, evidence, aiStages });
  } catch (error) {
    await terminatePipelineChildren();
    await plotPromise?.catch(() => undefined);
    throw error;
  }
}
