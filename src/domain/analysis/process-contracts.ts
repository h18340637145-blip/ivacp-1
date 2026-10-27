import type { ErrorPattern, RejectReasonCode } from "@/domain/analysis/reject-reasons";
import type {
  ModelFileConfig,
  ReviewEvidence,
  ReviewSampleKind,
  RuleGroupPrompts,
  SignalTicks,
  SignalTraceData,
} from "@/domain/entities";

/**
 * /api/issues/process 与 /api/issues/review 的请求/响应契约（前后端共用）。
 * 字段名沿用旧版载荷（issueKey 等），保证旧客户端与 /api/meegle/analyze 内部调用兼容。
 */

/** 历史人工复核样本（few-shot）。issueKey 为旧字段名，新客户端也可传 ticketKey */
export interface FewShotSample {
  issueKey: string;
  ticketKey?: string;
  issueSummary: string;
  sampleKind?: ReviewSampleKind;
  approvedConclusion?: string;
  wrongConclusion: string;
  correctConclusion: string;
  errorReason: string;
  errorCategory?: RejectReasonCode;
  carModel?: string;
  props?: string[];
  signalTokens?: string[];
  propertyIds?: string[];
  relevanceScore?: number;
}

export interface ProcessRequest {
  issueKey: string;
  summary: string;
  rawData: Record<string, unknown>;
  prompts: Partial<RuleGroupPrompts>;
  basePaths?: { json_dir: string; dbc_dir: string; proto_dir: string };
  modelToFiles?: Record<string, ModelFileConfig>;
  expand?: string;
  ruleGroupId: string;
  ruleGroupName?: string;
  source?: "jira" | "meegle";
  /** Jira 实例类型；bosch 使用 BOSCH_JIRA_* 凭据 */
  jiraProvider?: "default" | "bosch";
  runId?: string;
  /** 相似工单的历史人工纠错 / 确认样本 */
  fewShotSamples?: FewShotSample[];
  /** 该规则组 / 车型历史上最常见的人工驳回类型，注入提示词作自查提醒 */
  errorPatterns?: ErrorPattern[];
}

export interface ProcessResponse {
  replyText: string;
  model: string;
  issueKey: string;
  mode?: string;
  stages?: Record<string, string>;
  chartImage?: string;
  signalSummary?: string;
  traceData?: SignalTraceData;
  ticks?: SignalTicks;
  reviewEvidence?: ReviewEvidence;
  elapsedMs?: number;
  artifactRef?: string;
  analysisReceipt?: string;
  /** 本次分析与 AI 交互累计使用的 token 数 */
  tokenUsage?: number;
}

/** few-shot 样本的工单键（兼容旧 issueKey 与新 ticketKey） */
export function fewShotTicketKey(sample: Pick<FewShotSample, "issueKey" | "ticketKey">): string {
  return sample.ticketKey ?? sample.issueKey;
}
