import type { TicketSnapshot, ReviewEvidence } from "@/domain/entities";

export interface MeegleContextRequest {
  projectKey: string;
  workItemTypeKey: "issue";
  workItemId: string;
}

export interface MeegleContextResponse {
  rawData: TicketSnapshot["rawData"];
}

export interface MeegleAnalyzeResponse {
  versionVhalCheck?: import("@/domain/analysis/version-vhal").VersionVhalCheck;
  configurationResolution?: import("@/domain/analysis/effective-configuration").ConfigurationResolution;
  replyText: string;
  model: string;
  workItemId: string;
  stages: Record<string, string>;
  mode: string;
  elapsedMs: number;
  chartImage?: string;
  signalSummary?: string;
  reviewEvidence?: ReviewEvidence;
  traceData?: Record<string, { x: string[]; y: number[] }>;
  ticks?: Record<string, { labels: string[]; ticks: number[] }>;
  artifactRef?: string;
  analysisReceipt?: string;
  /** 经办人最近一次改为 HUANG Hongwei / DAI Yungui 的 ISO 时间 */
  handoverAt?: string;
  /** 本次分析与 AI 交互累计使用的 token 数 */
  tokenUsage?: number;
}

export interface MeegleBackfillRequest {
  projectKey: string;
  workItemTypeKey: "issue";
  workItemId: string;
  resultId: string;
  body: string;
  chartImagePath?: string;
  artifactRef?: string;
  analysisReceipt: string;
}

export interface MeegleTransitionOption {
  id: string | number;
  state_key: string;
  state_name: string;
}