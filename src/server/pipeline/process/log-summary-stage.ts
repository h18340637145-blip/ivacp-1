import { DEFAULT_LOG_SUMMARY } from "@/server/pipeline/constants";
import { saveStepLog } from "@/server/pipeline/paths-logging";
import type { ClassifiedAttachments } from "@/server/pipeline/types";
import { runLoggedAiStep } from "@/server/pipeline/process/ai-step";
import type { ProcessContext } from "@/server/pipeline/process/context";

export function logSummaryPrompt(ctx: ProcessContext): string {
  return ctx.request.prompts.LOG_SUMMARY_SYSTEM?.trim() || DEFAULT_LOG_SUMMARY;
}

/** Step 3 输入：评论 + 需求分析 + 信号提取 */
export function buildUpperBundle(commentsText: string, aiRequirements: string, aiSignals: string): string {
  return [
    commentsText,
    aiRequirements ? `\n<需求分析>\n${aiRequirements}\n</需求分析>` : "",
    aiSignals ? `\n<信号提取>\n${aiSignals}\n</信号提取>` : "",
  ].filter(Boolean).join("\n");
}

/** Step 3：上层日志摘要（仅 both / can_in_zip 模式） */
export async function runUpperSummaryStep(
  ctx: ProcessContext,
  classified: ClassifiedAttachments,
  upperBundle: string,
  aiStages: Record<string, string>,
): Promise<string> {
  if (!(classified.mode === "both" || classified.mode === "can_in_zip")) return "";
  const aiUpperSummary = await runLoggedAiStep(ctx, {
    stage: "AI_STEP3",
    startMessage: "正在生成上层日志摘要…",
    doneLabel: "上层摘要完成",
    systemPrompt: logSummaryPrompt(ctx),
    input: upperBundle,
    outputFile: "step3_upper_summary",
    thinkingFile: "step3_thinking.md",
  });
  aiStages.upperSummary = aiUpperSummary;
  await saveStepLog(ctx.logRoot, "step3_upper_summary.md", aiUpperSummary);
  return aiUpperSummary;
}

/** Step 4：Android + QNX 日志摘要（需要提示词且按信号 ID 与时间窗至少真实命中一行日志） */
export async function runAndroidQnxStep(
  ctx: ProcessContext,
  androidLog: string,
  qnxLog: string,
  aiStages: Record<string, string>,
  signalHits: number,
): Promise<string> {
  const androidQnxPrompt = ctx.request.prompts.ANDROID_QNX_LOG_SUMMARY_SYSTEM?.trim();
  if (!androidQnxPrompt) return "";
  if (signalHits <= 0) {
    // 只有版本、配置或 BoschVehicleHalHash 行时调用模型只会得到「空」，直接跳过。
    ctx.logger.log("AI_STEP4", "Android/QNX 日志无信号 ID 命中，跳过 Step4");
    return "";
  }
  const logContent = [
    androidLog ? `<Android日志>\n${androidLog}\n</Android日志>` : "",
    qnxLog     ? `<QNX日志>\n${qnxLog}\n</QNX日志>`             : "",
  ].filter(Boolean).join("\n\n");
  const aiAndroidQnxSummary = await runLoggedAiStep(ctx, {
    stage: "AI_STEP4",
    startMessage: "正在分析 Android/QNX 日志…",
    doneLabel: "Android/QNX 分析完成",
    systemPrompt: androidQnxPrompt,
    input: logContent,
    outputFile: "step4_android_qnx",
    thinkingFile: "step4_thinking.md",
  });
  aiStages.androidQnx = aiAndroidQnxSummary;
  await saveStepLog(ctx.logRoot, "step4_android_qnx.md", aiAndroidQnxSummary);
  return aiAndroidQnxSummary;
}
