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
  /** 客户端样本 id，用于快照与初次入选结果去重 */
  sampleId?: string;
}

/** 请求内有界样本快照的覆盖说明 */
export interface FewShotPoolMeta {
  /** 客户端授权范围内、同规则组同场景的合格样本数 */
  eligible: number;
  sent: number;
  truncated: boolean;
}

/** 快照条目上限与单条文本长度上限（服务端按此校验） */
export const FEW_SHOT_POOL_MAX = 100;
export const FEW_SHOT_POOL_TEXT_LIMIT = 1000;

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
  /** 证据生成后再次召回用的有界样本快照；只在本次请求内使用，不写入样本库 */
  fewShotPool?: FewShotSample[];
  fewShotPoolMeta?: FewShotPoolMeta;
  /** 该规则组 / 车型历史上最常见的人工驳回类型，注入提示词作自查提醒 */
  errorPatterns?: ErrorPattern[];
}

/** 证据后再次召回的审计摘要：随 run 保存，供恢复与界面展示；不含票据原文，只含身份与分数 */
export interface FewShotRetrievalAudit {
  strategyVersion: string;
  /** pool：基于请求内快照再次召回；fallback：无快照，仅对初次入选重排 */
  mode: "pool" | "fallback";
  poolMeta?: FewShotPoolMeta;
  candidateCount: number;
  excluded: { self: number; scene: number; duplicate: number };
  routeCounts: { identifier: number; lexical: number; initial: number; vector: number };
  degradations: string[];
  selected: Array<{ ticketKey: string; sampleKind: string; routes: string[]; recallScore: number; finalScore: number }>;
}

export interface ProcessResponse {
  versionVhalCheck?: import("@/domain/analysis/version-vhal").VersionVhalCheck;
  configurationResolution?: import("@/domain/analysis/effective-configuration").ConfigurationResolution;
  /** 服务端确认的独立运行目录身份，旧响应可能没有。 */
  analysisRunId?: string;
  /** 分析时日志使用的规则组目录名，不随配置改名改变。 */
  analysisGroupName?: string;
  /** 经办人接手时间（统计用，ISO 时间） */
  handoverAt?: string;
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
  /** 证据后再次召回的审计摘要（仅 P2 证据后再次召回路径返回） */
  fewShotRetrievalAudit?: FewShotRetrievalAudit;
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
