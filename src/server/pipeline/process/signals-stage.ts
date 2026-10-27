import path from "node:path";
import { MAX_CAN_CHARS } from "@/server/pipeline/constants";
import { readTextFile } from "@/server/pipeline/log-extract";
import { saveStepLog } from "@/server/pipeline/paths-logging";
import {
  MAX_SIGNAL_CANDIDATES,
  buildSignalCandidatePool,
  buildSignalConfigMatches,
  buildSignalsIdRecords,
  collectPlotSignals,
  isSupportedCanTrace,
  normalizeSignalToken,
  parseProtoPropertyIds,
  parseStep2SignalTokens,
  plotCanSignals,
  recoverFuzzyMatches,
  recoverViaSelfCheck,
} from "@/server/pipeline/signals";
import type { PlotResult, SignalCandidate, SignalConfigMatch, SignalIdRecord } from "@/server/pipeline/types";
import { runLoggedAiStep } from "@/server/pipeline/process/ai-step";
import { normalizeStringOrArray, type ProcessContext } from "@/server/pipeline/process/context";
import type { ModelConfigData } from "@/server/pipeline/process/prepare";

export interface SignalMatchResult {
  step2RawSignalTokens: string[];
  signalCandidatePool: SignalCandidate[];
  rawSignalTokens: string[];
  exactMatches: SignalConfigMatch[];
  recoveredMatches: SignalConfigMatch[];
  unmatchedTokens: string[];
  signalMatches: SignalConfigMatch[];
  signalIdRecords: SignalIdRecord[];
  /** Step 2 直接提取到的信号所对应的匹配（只有这些才读取/绘制 CAN trace） */
  extractedSignalMatches: SignalConfigMatch[];
}

/** Step 1：需求提取（未配置提示词则跳过） */
export async function runRequirementStep(
  ctx: ProcessContext,
  commentsText: string,
  aiStages: Record<string, string>,
): Promise<string> {
  const requirementPrompt = ctx.request.prompts.REQUIREMENT_EXTRACT_SYSTEM?.trim();
  if (!requirementPrompt) return "";
  const aiRequirements = await runLoggedAiStep(ctx, {
    stage: "AI_STEP1",
    startMessage: "正在执行需求提取…",
    doneLabel: "需求提取完成",
    systemPrompt: requirementPrompt,
    input: commentsText,
    outputFile: "step1_requirements",
    thinkingFile: "step1_thinking.md",
  });
  aiStages.requirements = aiRequirements;
  await saveStepLog(ctx.logRoot, "step1_requirements.md", aiRequirements);
  return aiRequirements;
}

/** Step 2：信号提取（参考车型 JSON 配置前 8k 字符 + 评论 + 需求分析） */
export async function runSignalExtractStep(
  ctx: ProcessContext,
  args: { jsonContent: string; commentsText: string; aiRequirements: string },
  aiStages: Record<string, string>,
): Promise<string> {
  const extractPrompt = ctx.request.prompts.EXTRACT_SIGNALS_SYSTEM?.trim();
  if (!extractPrompt) return "";
  const query = [
    args.jsonContent ? `<参考配置>\n${args.jsonContent.slice(0, 8_000)}\n</参考配置>` : "",
    args.commentsText,
    args.aiRequirements ? `\n<需求分析>\n${args.aiRequirements}\n</需求分析>` : "",
  ].filter(Boolean).join("\n");
  const aiSignals = await runLoggedAiStep(ctx, {
    stage: "AI_STEP2",
    startMessage: "正在提取信号…",
    doneLabel: "信号提取完成",
    systemPrompt: extractPrompt,
    input: query,
    outputFile: "step2_signals",
    thinkingFile: "step2_thinking.md",
  });
  aiStages.signals = aiSignals;
  // Log extracted signal names (first 5 non-empty lines as preview)
  const signalPreview = aiSignals.split("\n").map(l => l.trim()).filter(Boolean).slice(0, 5).join(" | ");
  ctx.logger.log("AI_STEP2", `提取的信号是：${signalPreview.slice(0, 400)}`);
  await saveStepLog(ctx.logRoot, "step2_signals.md", aiSignals);
  return aiSignals;
}

/** signals.json 内容（Step 2 写入一次；绘图得到报文特性后带 messageCharacteristics 重写） */
export function buildSignalsJson(result: SignalMatchResult, messageCharacteristics?: PlotResult["msg_characteristics"]): string {
  return JSON.stringify({
    rawTokens: result.rawSignalTokens,
    candidateSources: Object.fromEntries(
      result.signalCandidatePool.map((candidate) => [
        candidate.token,
        { sources: candidate.sources, weight: candidate.weight },
      ]),
    ),
    matches: result.exactMatches,
    recovered: result.recoveredMatches.map((match) => ({
      sourceToken: match.sourceToken,
      matchedBy: match.matchedBy,
      prop: match.prop,
      similarity: match.similarity,
      recoveryReason: match.recoveryReason,
    })),
    unmatched: result.unmatchedTokens,
    ...(messageCharacteristics ? { messageCharacteristics } : {}),
  }, null, 2);
}

/** 信号候选池 → 精确匹配 → 模糊补救 → 模型自检补救 → Property ID 映射，并写入 signals.json / signals_id.json */
export async function matchSignalsToConfig(
  ctx: ProcessContext,
  args: { aiSignals: string; commentsText: string; config: ModelConfigData },
): Promise<SignalMatchResult> {
  const { logger, metrics, logRoot, summary, rawData, fewShotSamples } = ctx;
  const { parsedConfigItems, protoContent } = args.config;

  const step2RawSignalTokens = parseStep2SignalTokens(args.aiSignals);
  const signalCandidatePool = buildSignalCandidatePool({
    step2Text: args.aiSignals,
    summary,
    description: typeof rawData.description === "string" ? rawData.description : undefined,
    commentsText: args.commentsText,
    configItems: parsedConfigItems,
    fewShotSamples,
  });
  const rawSignalTokens = signalCandidatePool
    .filter((candidate) => candidate.sources.some((source) => source !== "config_prop" && source !== "config_signal"))
    .map((candidate) => candidate.token);
  logger.log("AI_STEP2", `信号候选池：step2=${step2RawSignalTokens.length} selected=${rawSignalTokens.length} cap=${MAX_SIGNAL_CANDIDATES}`);
  const exactMatches = buildSignalConfigMatches(parsedConfigItems, rawSignalTokens);
  const matchedTokenSet = new Set(exactMatches.map((match) => match.sourceToken));
  const unmatchedAfterExact = rawSignalTokens.filter((token) => !matchedTokenSet.has(token));
  const fuzzyMatches = recoverFuzzyMatches(parsedConfigItems, unmatchedAfterExact);
  const fuzzyTokenSet = new Set(fuzzyMatches.map((match) => match.sourceToken));
  const unmatchedAfterFuzzy = unmatchedAfterExact.filter((token) => !fuzzyTokenSet.has(token));
  const selfCheckMatches = await recoverViaSelfCheck(parsedConfigItems, unmatchedAfterFuzzy, logger);
  const selfCheckTokenSet = new Set(selfCheckMatches.map((match) => match.sourceToken));
  const recoveredMatches = [...fuzzyMatches, ...selfCheckMatches];
  const unmatchedTokens = unmatchedAfterFuzzy.filter((token) => !selfCheckTokenSet.has(token));

  const signalMatches = [...exactMatches, ...recoveredMatches];
  const protoMap = parseProtoPropertyIds(protoContent);
  const signalIdRecords = buildSignalsIdRecords(signalMatches, protoMap);
  metrics.counts.signalTokens = rawSignalTokens.length;
  metrics.counts.signalMatches = signalMatches.length;
  metrics.counts.propIds = signalIdRecords.length;
  metrics.counts.recoveredMatches = recoveredMatches.length;
  metrics.counts.unmatchedTokens = unmatchedTokens.length;
  metrics.evidenceCompleteness.signalsExtracted = rawSignalTokens.length > 0 || signalMatches.length > 0;
  metrics.evidenceCompleteness.propIdsResolved = signalIdRecords.some((record) => record.decimalId !== null || record.hexId !== null);
  const extractedSignalTokenSet = new Set(step2RawSignalTokens.map(normalizeSignalToken));
  const extractedSignalMatches = signalMatches.filter((match) => extractedSignalTokenSet.has(normalizeSignalToken(match.sourceToken)));

  const result: SignalMatchResult = {
    step2RawSignalTokens,
    signalCandidatePool,
    rawSignalTokens,
    exactMatches,
    recoveredMatches,
    unmatchedTokens,
    signalMatches,
    signalIdRecords,
    extractedSignalMatches,
  };
  await saveStepLog(logRoot, "signals.json", buildSignalsJson(result));
  await saveStepLog(logRoot, "signals_id.json", JSON.stringify(signalIdRecords, null, 2));
  logger.log("AI_STEP2", `配置映射完成：tokens=${rawSignalTokens.length} 精确=${exactMatches.length} 补救=${recoveredMatches.length} 未命中=${unmatchedTokens.length} props=${signalIdRecords.length}`);
  return result;
}

/** CANtrace 只在 Step 2 映射出目标信号后才读取（.asc 读预览文本；.blf 由 python-can 解析） */
export async function readCanTracePreview(
  ctx: ProcessContext,
  canTracePath: string,
  signals: SignalMatchResult,
): Promise<{ canTraceText: string; parsingStarted: number | null }> {
  const { logger, metrics, stages } = ctx;
  let canTraceText = "";
  let parsingStarted: number | null = null;
  if (canTracePath && signals.extractedSignalMatches.length > 0) {
    parsingStarted = Date.now();
    metrics.evidenceCompleteness.canTraceFound = true;
    const lower = canTracePath.toLowerCase();
    if (lower.endsWith(".asc")) {
      logger.log("PARSING", `正在提取 CAN trace：${path.basename(canTracePath)}`);
      canTraceText = (await readTextFile(canTracePath, MAX_CAN_CHARS)).slice(0, MAX_CAN_CHARS);
      logger.log("PARSING", `CAN trace 提取完成，${canTraceText.length} 字符`);
    } else if (lower.endsWith(".blf")) {
      logger.log("PARSING", `正在提取 CAN trace：${path.basename(canTracePath)}（BLF 二进制格式）`);
      canTraceText = "[BLF 二进制格式，将通过 python-can 解析目标信号]";
      logger.log("PARSING", "CAN trace 为 BLF 二进制格式，将通过 python-can 解析目标信号");
    }
    stages.PARSING = `已读取 CAN trace，长度: ${canTraceText.length} 字符`;
  }
  return { canTraceText, parsingStarted };
}

/** Step 2.5：启动 CAN 信号绘图（不等待，与 Step 3 并行）；条件不满足返回 null */
export function startCanSignalPlot(
  ctx: ProcessContext,
  canTracePath: string,
  signals: SignalMatchResult,
): Promise<PlotResult> | null {
  const { logger, metrics, logRoot, carModel } = ctx;
  const { basePaths, modelToFiles } = ctx.request;
  const { extractedSignalMatches, signalMatches } = signals;
  if (!(canTracePath && isSupportedCanTrace(canTracePath) && extractedSignalMatches.length > 0)) return null;

  const parsedSignals = collectPlotSignals(extractedSignalMatches);
  if (parsedSignals.length === 0) {
    logger.log("PLOTTING", "跳过绘图：未能从 Step 2 提取信号中匹配到可回放信号");
    return null;
  }

  // Resolve DBC paths
  const dbcPaths: string[] = [];
  if (basePaths?.dbc_dir && modelToFiles && carModel) {
    const fileConfig = modelToFiles[carModel];
    if (fileConfig?.dbc) {
      const dbcFiles = normalizeStringOrArray(fileConfig.dbc as unknown as string | string[]);
      for (const d of dbcFiles) {
        dbcPaths.push(path.join(basePaths.dbc_dir, d));
      }
    }
  }

  if (dbcPaths.length === 0) {
    logger.log("PLOTTING", "跳过绘图：未配置 DBC 文件路径");
    return null;
  }

  metrics.evidenceCompleteness.dbcMatched = true;
  const pngPath = path.join(logRoot, "can_signals.png");
  logger.log("PLOTTING", `正在绘制 CAN 信号图，提取匹配=${extractedSignalMatches.length} 全部匹配=${signalMatches.length} 绘图=${parsedSignals.length}，信号: ${parsedSignals.join(", ")}`);
  logger.log("PLOTTING", `DBC: ${dbcPaths.map((p) => path.basename(p)).join(", ")}`);
  return plotCanSignals(canTracePath, dbcPaths, parsedSignals, pngPath);
}
