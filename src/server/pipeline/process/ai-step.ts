import { chat } from "@/server/ai/qwen";
import { recordMetricStage, setPromptMetric } from "@/server/pipeline/metrics";
import { saveStepLog } from "@/server/pipeline/paths-logging";
import { stripThinkTags } from "@/server/pipeline/step5";
import type { ProcessContext } from "@/server/pipeline/process/context";

/**
 * 执行一个多阶段推理步骤（Step1~4 共用）：
 * 调用模型 → 记录指标 → 保存原始输出 → 剥离 <think> 并保存思考过程 → 返回清洗后的结果（由调用方保存）。
 */
export async function runLoggedAiStep(
  ctx: ProcessContext,
  args: {
    stage: string;
    startMessage: string;
    doneLabel: string;
    systemPrompt: string;
    input: string;
    /** 文件名前缀，例如 step1_requirements → step1_requirements_raw.md / step1_requirements.md */
    outputFile: string;
    thinkingFile: string;
  },
): Promise<string> {
  const { logger, metrics, logRoot } = ctx;
  logger.log(args.stage, args.startMessage);
  const t0 = Date.now();
  const raw = await chat(args.systemPrompt, args.input);
  recordMetricStage(metrics, args.stage, t0);
  setPromptMetric(metrics, args.stage, args.input, raw);
  // Save raw (with thinking) then strip
  await saveStepLog(logRoot, `${args.outputFile}_raw.md`, raw);
  const stripped = stripThinkTags(raw);
  if (stripped.thinking) await saveStepLog(logRoot, args.thinkingFile, stripped.thinking);
  const cleaned = stripped.cleaned;
  logger.log(args.stage, `${args.doneLabel}，${cleaned.length} 字符，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return cleaned;
}
