import path from "node:path";
import { HttpError } from "@/server/http/route";
import fs from "node:fs/promises";
import { ISSUE_SCENE_INFO, buildIssueScenePromptBlock, detectIssueScene, filterBySameScene } from "@/domain/analysis/issue-scene";
import type { ModelFileConfig } from "@/domain/entities";
import { assertSafeRunId, createArtifactRef } from "@/server/artifacts/analysis-artifacts";
import { getJiraConnection } from "@/server/jira/connection";
import { createMeegleAnalysisReceipt } from "@/server/meegle/write-authorization";
import { createPipelineMetrics } from "@/server/pipeline/metrics";
import { createPipelineLogger, issueAttachDir, issueLogDir, sanitizeName, type PipelineLogger } from "@/server/pipeline/paths-logging";
import type { FewShotSample, PipelineMetrics, ProcessRequest } from "@/server/pipeline/types";

/** 单次工单分析的运行上下文：请求参数 + 目录 + 日志/指标 + 阶段记录 */
export interface ProcessContext {
  analysisConfig?: import("./effective-context").EffectiveConfiguration;
  configurationResolution?: import("@/domain/analysis/effective-configuration").ConfigurationResolution;
  logVersionWarnings?: string[];
  logVersions?: import("../log-versions").LogVersions[];
  request: ProcessRequest;
  issueKey: string;
  summary: string;
  rawData: Record<string, unknown>;
  ruleGroupId: string;
  /** 目录名使用可读的规则组名（缺省回退 ruleGroupId） */
  groupDirName: string;
  carModel: string;
  issueScene: ReturnType<typeof detectIssueScene>;
  issueScenePromptBlock: string;
  /** 已按同场景过滤的历史样本 */
  fewShotSamples?: FewShotSample[];
  attachRoot: string;
  logRoot: string;
  artifactRef?: string;
  analysisReceipt?: string;
  logger: PipelineLogger;
  metrics: PipelineMetrics;
  stages: Record<string, string>;
  startTime: number;
  /** issueKey 以 meegle- 开头（数据由 /api/meegle/analyze 预拉取） */
  isMeegle: boolean;
  meegleIdentity?: { projectKey: string; workItemId: string };
}

export function detectCarModel(summary: string, modelToFiles: Record<string, ModelFileConfig>): string {
  for (const modelKey of Object.keys(modelToFiles)) {
    if (summary.includes(modelKey)) return modelKey;
  }
  return "";
}

/** Handles string, array, or stringified-JSON-array (e.g. '["a.json"]' stored as string). */
export function normalizeStringOrArray(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try { const parsed = JSON.parse(trimmed); if (Array.isArray(parsed)) return parsed; } catch { /* fall through */ }
  }
  return [value];
}

export async function createProcessContext(request: ProcessRequest): Promise<ProcessContext> {
  const { issueKey, summary, rawData, basePaths, modelToFiles, ruleGroupId, ruleGroupName, fewShotSamples: requestFewShotSamples, source, runId, jiraProvider } = request;

  // 台架/实车：结论口径不同，历史案例只用同场景（客户端已过滤，这里兜底）
  const issueScene = detectIssueScene(summary);
  const fewShotSamples = requestFewShotSamples
    ? filterBySameScene(issueScene, requestFewShotSamples, (sample) => sample.issueSummary)
    : undefined;
  const issueScenePromptBlock = buildIssueScenePromptBlock(issueScene);

  const startTime = Date.now();
  const stages: Record<string, string> = {};

  const carModel = (basePaths && modelToFiles) ? detectCarModel(summary, modelToFiles) : "";
  const groupDirName = ruleGroupName || ruleGroupId;

  const issueAttachments = issueAttachDir(groupDirName, carModel, issueKey);
  const attachRoot = source === "meegle" && runId ? path.join(issueAttachments, assertSafeRunId(runId))
    : runId ? path.join(issueAttachments, jiraProvider === "bosch" ? "jira-bosch" : "jira-default") : issueAttachments;
  const logRoot    = issueLogDir(groupDirName, carModel, issueKey, runId);
  const artifactRef = source === "meegle" && runId
    ? createArtifactRef({
        groupDir: sanitizeName(groupDirName),
        carModel: sanitizeName(carModel || "unknown"),
        issueKey: sanitizeName(issueKey),
        runId: assertSafeRunId(runId),
      })
    : undefined;
  const analysisReceipt = artifactRef && typeof rawData.projectKey === "string" && typeof rawData.workItemId === "string"
    ? createMeegleAnalysisReceipt({ projectKey: rawData.projectKey, workItemTypeKey: "issue", workItemId: rawData.workItemId, artifactRef })
    : undefined;
  if (runId) {
    await fs.mkdir(path.dirname(logRoot), { recursive: true });
    try { await fs.mkdir(logRoot); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new HttpError(409, "该分析运行已存在，请恢复结果或使用新的 runId");
      throw error;
    }
  } else await fs.mkdir(logRoot, { recursive: true });
  await fs.mkdir(attachRoot, { recursive: true });

  const logger = createPipelineLogger(issueKey);
  const metrics = createPipelineMetrics({
    issueKey,
    summary,
    ruleGroupId,
    ruleGroupName: groupDirName,
    carModel,
    attachRoot,
    logRoot,
  });
  const jiraServer = getJiraConnection(jiraProvider).server;
  const isMeegle = source === "meegle" || issueKey.startsWith("meegle-");
  const issueLink = isMeegle ? `飞书项目工单 ${issueKey}` : `${jiraServer}/browse/${issueKey}`;
  logger.log("INIT", `处理问题：${issueKey}  链接：${issueLink}  主题：${summary}`);
  logger.log("INIT", `ruleGroup=${groupDirName}  carModel=${carModel || "unknown"}  场景=${issueScene ? ISSUE_SCENE_INFO[issueScene].label : "未标注（不限场景召回）"}`);
  if (requestFewShotSamples && fewShotSamples && fewShotSamples.length < requestFewShotSamples.length) {
    logger.log("INIT", `历史案例按场景过滤：${requestFewShotSamples.length} → ${fewShotSamples.length}`);
  }
  logger.log("INIT", `附件目录: ${attachRoot}`);
  logger.log("INIT", `日志目录: ${logRoot}`);

  const meegleIdentity = source === "meegle" && typeof rawData.projectKey === "string" && typeof rawData.workItemId === "string"
    ? { projectKey: rawData.projectKey, workItemId: rawData.workItemId }
    : undefined;

  return {
    request,
    issueKey,
    summary,
    rawData,
    ruleGroupId,
    groupDirName,
    carModel,
    issueScene,
    issueScenePromptBlock,
    fewShotSamples,
    attachRoot,
    logRoot,
    artifactRef,
    analysisReceipt,
    logger,
    metrics,
    stages,
    startTime,
    isMeegle,
    meegleIdentity,
  };
}
