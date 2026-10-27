import type { JiraAttachment } from "@/domain/issue-source/jira";

export type { FewShotSample, ProcessRequest, ProcessResponse } from "@/domain/analysis/process-contracts";

export type AttachmentMode = "can_only" | "both" | "reject" | "can_in_zip" | "no_attachments";

export interface ClassifiedAttachments {
  mode: AttachmentMode;
  latestCan?: JiraAttachment;
  latestZip?: JiraAttachment;
  reason: string;
}

/* ─── Helpers ───────────────────────────────────────────────────────────── */

export interface EvidenceCompleteness {
  canTraceFound: boolean;
  dbcMatched: boolean;
  signalsExtracted: boolean;
  propIdsResolved: boolean;
  commentTimeWindowFound: boolean;
  androidQnxLogLinesFound: boolean;
  canSignalSummaryFound: boolean;
}

export interface PipelineMetrics {
  version: 1;
  /** 新运行恢复产物的严格完成门禁版本。 */
  responseArtifactVersion?: 1;
  model?: string;
  tokenUsage?: number;
  issueKey: string;
  summary: string;
  ruleGroupId: string;
  ruleGroupName: string;
  carModel: string;
  mode?: AttachmentMode;
  status: "running" | "success" | "failed" | "rejected";
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  stageDurationsMs: Record<string, number>;
  promptStats: Record<string, { inputChars?: number; outputChars?: number; estimatedInputTokens?: number }>;
  evidenceCompleteness: EvidenceCompleteness;
  evidenceScore: number;
  groundingBefore?: number;
  groundingAfter?: number;
  counts: {
    comments: number;
    attachments: number;
    signalTokens: number;
    signalMatches: number;
    propIds: number;
    recoveredMatches: number;
    unmatchedTokens: number;
    androidLogChars: number;
    qnxLogChars: number;
    finalReplyChars: number;
  };
  files: {
    attachRoot: string;
    logRoot: string;
  };
}

export interface PlotResult {
  image: string;
  summary: string;
  error: string;
  traceStartTime?: string;
  traceEndTime?: string;
  msg_characteristics?: Record<string, {
    frame_id: string;
    fast_period: number;
    slow_period: number;
    fast_frames: number;
    msg_type: "event" | "cycle" | "ce";
  }>;
  trace_data?: Record<string, { x: string[]; y: number[] }>;
  ticks?: Record<string, { labels: string[]; ticks: number[] }>;
}

export interface ModelSignalConfigEntry {
  prop?: string;
  access?: string;
  config?: Array<{
    setMsgId?: number | null;
    setMsgName?: string | null;
    setSignals?: string[];
    getMsgId?: number | null;
    getMsgName?: string | null;
    getSignals?: string[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface SignalConfigMatch {
  sourceToken: string;
  matchedBy: "prop" | "getSignal" | "setSignal" | "fuzzy" | "self_check";
  matchedSignal: string | null;
  prop: string;
  access?: string;
  configItem: ModelSignalConfigEntry;
  similarity?: number;
  recoveryReason?: string;
}

export interface SignalCandidate {
  token: string;
  normalized: string;
  sources: Array<"step2" | "jira_summary" | "jira_description" | "jira_comment" | "ocr" | "config_prop" | "config_signal" | "few_shot">;
  weight: number;
}

export interface SignalIdRecord {
  prop: string;
  decimalId: number | null;
  hexId: string | null;
  access?: string;
  sourceTokens: string[];
  matchedSignals: string[];
}

export interface TimeWindow {
  start: string;
  end: string;
  source: "comment_timestamp" | "comment_time_only" | "trace_timestamp" | "fallback";
}
