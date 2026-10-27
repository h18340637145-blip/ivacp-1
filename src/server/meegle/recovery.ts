import fs from "node:fs/promises";
import path from "node:path";
import type { EvidencePacket } from "@/domain/analysis/evidence-packet";
import { reviewEvidenceFromEvidencePacket } from "@/domain/analysis/review-sample";
import type { MeegleAnalyzeResponse } from "@/domain/meegle/contracts";
import { assertSafeRunId, createArtifactRef } from "@/server/artifacts/analysis-artifacts";
import { fetchMeegleHandoverAt } from "@/server/handover/handover";
import { badRequest } from "@/server/http/route";
import { meegleLogBase } from "@/server/meegle/config";
import type { MeegleRunRequest } from "@/server/meegle/cancel";
import {
  hasCompleteMeegleSuccess,
  isSafeMeegleRunIdentity,
  locateMeegleRunDirectory,
  sanitizeMeegleRunArtifactName,
} from "@/server/meegle/run-artifacts";
import { meeglePipelineIssueKey } from "@/server/meegle/types";
import { createMeegleAnalysisReceipt } from "@/server/meegle/write-authorization";

interface PipelineMetrics {
  status?: string;
  issueKey?: string;
  model?: string;
  mode?: string;
  durationMs?: number;
}

interface StagesArtifact {
  stages?: Record<string, string>;
}

export type MeegleRecoveryResult = MeegleAnalyzeResponse | { recoverable: false };

export interface MeegleRecoveryOptions {
  logBase?: string;
  fetchHandoverAt?: (projectKey: string, workItemId: string) => Promise<Date | undefined>;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

/**
 * 页面刷新/中断后，从运行产物目录恢复一次已成功的飞书分析结果；
 * 目录不存在或产物不完整时返回 `{ recoverable: false }`。
 */
export async function recoverMeegleRun(
  body: Partial<MeegleRunRequest>,
  options: MeegleRecoveryOptions = {},
): Promise<MeegleRecoveryResult> {
  const { runId, issueKey, projectKey, workItemTypeKey, workItemId, ruleGroupName } = body;
  if (!runId || !issueKey || !projectKey || !workItemTypeKey || !workItemId || !ruleGroupName) {
    throw badRequest("runId、工单身份与 ruleGroupName 均为必填项");
  }
  if (workItemTypeKey !== "issue" || issueKey !== meeglePipelineIssueKey(workItemId) || !isSafeMeegleRunIdentity(issueKey)) {
    throw badRequest("飞书恢复请求的工单身份无效");
  }

  let safeRunId: string;
  let runDirectory: string | undefined;
  try {
    safeRunId = assertSafeRunId(runId);
    runDirectory = await locateMeegleRunDirectory(options.logBase ?? meegleLogBase(), { runId: safeRunId, issueKey, ruleGroupName });
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : String(error));
  }
  if (!runDirectory || !await hasCompleteMeegleSuccess(runDirectory, issueKey)) return { recoverable: false };

  const groupDir = sanitizeMeegleRunArtifactName(ruleGroupName);
  const issueDir = sanitizeMeegleRunArtifactName(issueKey);
  try {
    const [metrics, replyText, stages, evidencePacket] = await Promise.all([
      readJson<PipelineMetrics>(path.join(runDirectory, "pipeline-metrics.json")),
      fs.readFile(path.join(runDirectory, "final_reply.md"), "utf8"),
      readJson<StagesArtifact>(path.join(runDirectory, "stages.json")).then((value) => value.stages ?? {}),
      readJson<EvidencePacket>(path.join(runDirectory, "evidence-packet.json")).catch(() => undefined),
    ]);
    if (metrics.status !== "success" || metrics.issueKey !== issueKey || !replyText.trim()) return { recoverable: false };

    const carModel = path.basename(path.dirname(path.dirname(runDirectory)));
    const artifactRef = createArtifactRef({ groupDir, carModel, issueKey: issueDir, runId: safeRunId });
    const analysisReceipt = createMeegleAnalysisReceipt({ projectKey, workItemTypeKey, workItemId, artifactRef });
    const chartImage = await fs.access(path.join(runDirectory, "can_signals.png")).then(
      () => `/api/charts/log/${[groupDir, carModel, issueDir, safeRunId].map(encodeURIComponent).join("/")}/can_signals.png`,
      () => undefined,
    );
    const signalSummary = await fs.readFile(path.join(runDirectory, "can_signal_summary.txt"), "utf8").catch(() => undefined);
    const handoverAt = await (options.fetchHandoverAt ?? fetchMeegleHandoverAt)(projectKey, String(workItemId));
    return {
      handoverAt: handoverAt?.toISOString(),
      replyText: replyText.trim(),
      model: metrics.model ?? "",
      workItemId,
      stages,
      mode: metrics.mode ?? "",
      elapsedMs: metrics.durationMs ?? 0,
      chartImage,
      signalSummary,
      reviewEvidence: evidencePacket
        ? reviewEvidenceFromEvidencePacket(evidencePacket)
        : { carModel, props: [], signalTokens: [], propertyIds: [] },
      artifactRef,
      analysisReceipt,
    };
  } catch {
    // 运行目录存在但恢复所需产物不完整
    return { recoverable: false };
  }
}
