import { currentQwenTokenUsage } from "@/server/ai/qwen";
import { saveStepLog } from "@/server/pipeline/paths-logging";
import { estimatePromptTokens } from "@/server/pipeline/step5";
import { AttachmentMode, EvidenceCompleteness, PipelineMetrics } from "@/server/pipeline/types";

export function createEmptyEvidenceCompleteness(): EvidenceCompleteness {
  return {
    canTraceFound: false,
    dbcMatched: false,
    signalsExtracted: false,
    propIdsResolved: false,
    commentTimeWindowFound: false,
    androidQnxLogLinesFound: false,
    canSignalSummaryFound: false,
  };
}

export function createPipelineMetrics(args: {
  issueKey: string;
  summary: string;
  ruleGroupId: string;
  ruleGroupName: string;
  carModel: string;
  attachRoot: string;
  logRoot: string;
}): PipelineMetrics {
  return {
    version: 1,
    issueKey: args.issueKey,
    summary: args.summary,
    ruleGroupId: args.ruleGroupId,
    ruleGroupName: args.ruleGroupName,
    carModel: args.carModel || "unknown",
    status: "running",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    stageDurationsMs: {},
    promptStats: {},
    evidenceCompleteness: createEmptyEvidenceCompleteness(),
    evidenceScore: 0,
    counts: {
      comments: 0,
      attachments: 0,
      signalTokens: 0,
      signalMatches: 0,
      propIds: 0,
      recoveredMatches: 0,
      unmatchedTokens: 0,
      androidLogChars: 0,
      qnxLogChars: 0,
      finalReplyChars: 0,
    },
    files: {
      attachRoot: args.attachRoot,
      logRoot: args.logRoot,
    },
  };
}

export function recordMetricStage(metrics: PipelineMetrics, stage: string, startedAt: number): void {
  const durationMs = Date.now() - startedAt;
  metrics.stageDurationsMs[stage] = (metrics.stageDurationsMs[stage] ?? 0) + durationMs;
}

export function setPromptMetric(
  metrics: PipelineMetrics,
  stage: string,
  input: string,
  output?: string,
): void {
  metrics.promptStats[stage] = {
    inputChars: input.length,
    outputChars: output?.length,
    estimatedInputTokens: estimatePromptTokens(input),
  };
}

export function finalizePipelineMetrics(
  metrics: PipelineMetrics,
  status: PipelineMetrics["status"],
  mode?: AttachmentMode,
): PipelineMetrics {
  const completedAt = new Date();
  metrics.completedAt = completedAt.toISOString();
  metrics.durationMs = completedAt.getTime() - new Date(metrics.startedAt).getTime();
  metrics.status = status;
  metrics.model = process.env.QWEN_MODEL ?? "";
  metrics.tokenUsage = currentQwenTokenUsage();
  if (mode) metrics.mode = mode;

  const evidenceValues = Object.values(metrics.evidenceCompleteness);
  metrics.evidenceScore = evidenceValues.length === 0
    ? 0
    : Number((evidenceValues.filter(Boolean).length / evidenceValues.length).toFixed(3));

  return metrics;
}

export async function savePipelineMetrics(logDir: string, metrics: PipelineMetrics): Promise<void> {
  await saveStepLog(logDir, "pipeline-metrics.json", JSON.stringify(metrics, null, 2));
}
