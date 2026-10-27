/**
 * IVACP 统一领域实体（IndexedDB `IvacpDB` 与 MySQL 镜像共用的记录结构）。
 *
 * 设计要点（相对旧版 JiraAnalyzerDB 的优化）：
 * - Jira 与飞书项目（Meegle）不再各有一套 snapshot/task/result/history/validation 表，
 *   统一为带 `source` 判别字段的单表，按 `[source+ticketKey]` 复合索引查询。
 * - `ticketKey`：Jira 为 issueKey（如 `ABC-123`），飞书为工作项 ID 字符串（如 `7141844873`）。
 * - 回填状态统一为 `commentStatus`（旧 Jira 的 `hasCommentedToJira` 布尔被吸收）。
 * - 自动周期表以 `ruleGroupId` 为主键（一组一条），不再使用额外 id。
 * - 所有时间字段使用 `Date`（知识库/聊天/记忆/笔记保留原有字符串或数值时间，见各字段说明）。
 */
import type { RejectReasonCode } from "@/domain/analysis/reject-reasons";

// ─── 通用枚举 ────────────────────────────────────────────────────────────────

export type TicketSource = "jira" | "meegle";
export const TICKET_SOURCES: readonly TicketSource[] = ["jira", "meegle"] as const;
export const TICKET_SOURCE_LABEL: Record<TicketSource, string> = { jira: "Jira", meegle: "飞书项目" };

export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type FilterRunStatus = TaskStatus | "expired";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type CommentStatus = "not_started" | "uploading" | "commenting" | "succeeded" | "failed";
export type TransitionStatus = "not_selected" | "pending" | "succeeded" | "failed";
export type Verdict = "pass" | "fail" | "warning" | "unknown";
export type CheckStatus = "pass" | "fail" | "warning";

/** 处理流水线阶段（Jira 与飞书共用；FETCHING_CONTEXT/ANALYZING 仅飞书使用） */
export const PROCESS_STAGES = [
  "PREPARING",
  "FETCHING_CONTEXT",
  "DOWNLOADING",
  "UNPACKING",
  "PARSING",
  "MODEL_INFERENCE",
  "ANALYZING",
  "GENERATING_REPLY",
  "SAVING_RESULT",
] as const;
export type ProcessStage = (typeof PROCESS_STAGES)[number];

export const PROCESS_STAGE_LABEL: Record<ProcessStage, string> = {
  PREPARING: "准备中",
  FETCHING_CONTEXT: "获取上下文",
  DOWNLOADING: "下载附件",
  UNPACKING: "解包",
  PARSING: "解析信号",
  MODEL_INFERENCE: "模型推理",
  ANALYZING: "分析中",
  GENERATING_REPLY: "生成回复",
  SAVING_RESULT: "保存结果",
};

// ─── 规则组 ──────────────────────────────────────────────────────────────────

export interface ModelFileConfig {
  json: string;
  dbc: string[];
  proto: string;
}

export interface RuleGroupPrompts {
  EXTRACT_SIGNALS_SYSTEM: string;
  REQUIREMENT_EXTRACT_SYSTEM: string;
  LOG_SUMMARY_SYSTEM: string;
  ANDROID_QNX_LOG_SUMMARY_SYSTEM: string;
  CONSISTENCY_SYSTEM: string;
  COMPARE_CANTRACE: string;
}

export type JiraProvider = "bosch";

/**
 * 规则组配置文档。
 * 结构与旧版保持一致，因为它同时是导入/导出文件、团队模板与服务端流水线的输入契约。
 */
export interface RuleGroup {
  id: string;
  name: string;
  /** Jira 筛票 JQL；为空表示不启用 Jira 来源 */
  jql: string;
  /** 飞书项目 MQL；为空表示不启用飞书来源 */
  meegleMql?: string;
  /** 缺省为默认 Jira，bosch 使用 BOSCH_JIRA_* 环境变量 */
  jiraProvider?: JiraProvider;
  expand: string;
  base_paths: {
    json_dir: string;
    dbc_dir: string;
    proto_dir: string;
  };
  model_to_files: Record<string, ModelFileConfig>;
  prompts: RuleGroupPrompts;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutoCycleState {
  /** 主键：一个规则组一条自动周期配置 */
  ruleGroupId: string;
  isActive: boolean;
  intervalMinutes: number;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

// ─── 筛票 ────────────────────────────────────────────────────────────────────

/** 一次筛票运行（旧 filterTasks + meegleFilterTasks） */
export interface FilterRun {
  id: string;
  source: TicketSource;
  ruleGroupId: string;
  /** Jira 为 JQL，飞书为 MQL */
  query: string;
  /** 飞书 MQL 所属项目 key */
  projectKey?: string;
  /** 飞书批量筛选的运行批次 id（同一批次多个规则组共用） */
  runId?: string;
  status: FilterRunStatus;
  issueCount: number;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * 工单快照（旧 filteredIssueSnapshots + meegleFilteredIssueSnapshots + meegleIssueSnapshots）。
 * - origin=filter：筛票命中时写入（带 filterRunId）。Jira 处理任务直接引用该快照。
 * - origin=process：飞书每次处理前抓取的上下文快照（带 assignmentId）。
 */
export interface TicketSnapshot {
  id: string;
  source: TicketSource;
  ticketKey: string;
  ruleGroupId: string;
  origin: "filter" | "process";
  filterRunId?: string;
  assignmentId?: string;
  /** Jira summary / 飞书工作项名称 */
  title: string;
  stateName?: string;
  projectKey?: string;
  projectName?: string;
  workItemTypeKey?: string;
  workItemId?: number;
  rawData: Record<string, unknown>;
  createdAt: Date;
}

/** 飞书工作项到规则组的分配（手动拖拽或 MQL 自动归属） */
export interface Assignment {
  id: string;
  source: "meegle";
  ticketKey: string;
  workItemId: number;
  workItemTypeKey: string;
  workItemName: string;
  projectKey: string;
  projectName: string;
  stateName: string;
  /** 空字符串表示已被 MQL 解除归属（保留结果与历史） */
  ruleGroupId: string;
  assignmentSource: "manual" | "auto";
  lastFilterRunId?: string;
  status: "pending" | "processing" | "completed" | "failed";
  latestTaskId?: string;
  latestAttemptTaskId?: string;
  /** 进入“处理中”的时间，用于识别创建任务前就被中断的卡死分配 */
  processingStartedAt?: Date;
  latestResultId?: string;
  result?: string;
  error?: string;
  assignedAt: Date;
  completedAt?: Date;
}

/** 飞书 MQL 自动筛选审计 */
export interface FilterAudit {
  id: string;
  source: "meegle";
  runId: string;
  trigger: "all" | "rule_group";
  targetRuleGroupId?: string;
  projectKey: string;
  projectName?: string;
  workItemTypeKey: string;
  workItemId: number;
  ticketKey: string;
  workItemName: string;
  stateName?: string;
  model: string;
  carModel: string;
  project: string;
  platform: string;
  decision: "assigned" | "unassigned" | "skipped_manual_assignment" | "failed";
  matchedRuleGroupId?: string;
  matchedRuleGroupName?: string;
  score?: number;
  reason: string;
  createdAt: Date;
}

// ─── 处理 / 结果 ─────────────────────────────────────────────────────────────

export interface ProcessTask {
  id: string;
  source: TicketSource;
  ticketKey: string;
  ruleGroupId: string;
  snapshotId: string;
  assignmentId?: string;
  status: TaskStatus;
  stage?: ProcessStage;
  /** 各阶段耗时/状态文本（飞书） */
  stages?: Record<string, string>;
  mode?: string;
  elapsedMs?: number;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface ReviewEvidence {
  carModel?: string;
  props: string[];
  signalTokens: string[];
  propertyIds: string[];
}

export type SignalTraceData = Record<string, { x: string[]; y: number[] }>;
export type SignalTicks = Record<string, { labels: string[]; ticks: number[] }>;

export interface ProcessResult {
  id: string;
  source: TicketSource;
  ticketKey: string;
  ruleGroupId: string;
  processTaskId: string;
  snapshotId: string;
  assignmentId?: string;

  replyText: string;
  /** 本次分析与 AI 交互累计使用的 token 数 */
  tokenUsage?: number;
  model?: string;
  aiConclusionTime?: string;
  /** 相对路径，经 /api/charts/ 提供 */
  chartImage?: string;
  signalSummary?: string;
  reviewEvidence?: ReviewEvidence;
  traceData?: SignalTraceData;
  ticks?: SignalTicks;
  /** 飞书运行产物引用（/api/meegle/artifacts 白名单读取） */
  artifactRef?: string;
  analysisReceipt?: string;

  // 复核
  reviewStatus: ReviewStatus;
  aiReviewVerdict?: "unknown" | "pass" | "fail";
  aiReviewReason?: string;
  aiReviewedAt?: Date;
  manualReviewedAt?: Date;
  manualCorrectResult?: string;
  errorReason?: string;
  errorCategory?: RejectReasonCode;

  // 回填评论
  commentStatus: CommentStatus;
  commentId?: string;
  commentedAt?: Date;
  commentError?: string;

  // 状态流转
  transitionStatus: TransitionStatus;
  transitionId?: string;
  transitionName?: string;
  transitionedAt?: Date;
  transitionError?: string;

  // 经办人接手统计
  /** 经办人改为指定处理人的时间（接手时间） */
  handoverAt?: Date;
  /** 转出时间 = 回填成功时间 + 1 小时 */
  handoverOutAt?: Date;
  /** 停留时间（毫秒）= 转出时间 - 接手时间 */
  dwellMs?: number;
  /** 停留超过 24 小时且接手当天为周末时为“是” */
  isWeekend?: "是" | "否";

  createdAt: Date;
}

/** 重新分析时旧结果归档为历史（旧 issueAnalysisHistories + meegleAnalysisHistories） */
export interface AnalysisHistory {
  id: string;
  source: TicketSource;
  ticketKey: string;
  ruleGroupId: string;
  assignmentId?: string;
  sourceSnapshotId: string;
  sourceProcessTaskId: string;
  sourceResultId: string;
  replyText: string;
  reviewStatus: ReviewStatus;
  commentStatus: CommentStatus;
  transitionStatus: TransitionStatus;
  aiConclusionTime?: string;
  manualCorrectResult?: string;
  errorReason?: string;
  errorCategory?: RejectReasonCode;
  artifactRef?: string;
  resultCreatedAt: Date;
  archivedAt: Date;
}

export interface ValidationRun {
  id: string;
  source: TicketSource;
  resultId: string;
  validationStatus: Verdict;
  systemVerdict: Verdict;
  manualVerdict?: Verdict;
  manualVerdictAt?: Date;
  manualVerdictBy?: string;
  manualVerdictReason?: string;
  diffSeconds: number;
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface ValidationCheck {
  id: string;
  source: TicketSource;
  runId: string;
  type: string;
  status: CheckStatus;
  expected?: string;
  actual?: string;
  message: string;
  evidenceSource?: string;
  confidence?: number;
  createdAt: Date;
}

// ─── 学习样本 / 记忆 ─────────────────────────────────────────────────────────

export type ReviewSampleKind = "correction" | "approved";

/** 人工复核正负样本（Jira 与飞书共用，用于 few-shot / RAG） */
export interface ReviewSample {
  id: string;
  source: TicketSource;
  ruleGroupId: string;
  ticketKey: string;
  issueSummary?: string;
  evidenceFingerprintText?: string;
  props?: string[];
  signalTokens?: string[];
  propertyIds?: string[];
  carModel?: string;
  sampleKind: ReviewSampleKind;
  approvedConclusion?: string;
  issueSummaryEmbedding?: number[];
  embeddingModel?: string;
  embeddingUpdatedAt?: Date;
  wrongConclusion: string;
  correctConclusion: string;
  errorReason: string;
  errorCategory?: RejectReasonCode;
  createdAt: Date;
}

export interface LearningMemory {
  id: string;
  ruleGroupId: string;
  memoryKey: string;
  content: string;
  updatedAt: Date;
}

// ─── 智能助手（知识库 / 对话 / 记忆 / 笔记），按登录用户隔离 ─────────────────

export interface KnowledgeChunk {
  text: string;
  embedding?: number[];
}

export interface KnowledgeDoc {
  id: string;
  userId?: string;
  /** 由处理结果 / 人工标注导入时标记，重复导入按 id 覆盖 */
  source?: "import";
  name: string;
  size: number;
  chunks: KnowledgeChunk[];
  /** ISO 字符串 */
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  userId?: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  /** ISO 字符串 */
  createdAt: string;
}

export interface MemoryRecord {
  id: string;
  userId: string;
  content: string;
  type: "fact" | "preference" | "episode" | "manual";
  importance: number;
  pinned?: boolean;
  embedding?: number[];
  /** 毫秒时间戳（参与衰减计算） */
  createdAt: number;
  lastAccessedAt: number;
}

export interface NoteVersion {
  title: string;
  content: string;
  savedAt: string;
}

export interface NoteRecord {
  id: string;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  chunks: KnowledgeChunk[];
  versions: NoteVersion[];
  createdAt: string;
  updatedAt: string;
}

// ─── 表注册 ──────────────────────────────────────────────────────────────────

/** 表名 → 记录类型；IndexedDB、备份文件、MySQL 镜像共用同一份表清单 */
export interface EntityTables {
  ruleGroups: RuleGroup;
  autoCycles: AutoCycleState;
  filterRuns: FilterRun;
  snapshots: TicketSnapshot;
  assignments: Assignment;
  filterAudits: FilterAudit;
  processTasks: ProcessTask;
  processResults: ProcessResult;
  analysisHistories: AnalysisHistory;
  validationRuns: ValidationRun;
  validationChecks: ValidationCheck;
  reviewSamples: ReviewSample;
  learningMemories: LearningMemory;
  knowledgeDocs: KnowledgeDoc;
  chatMessages: ChatMessageRecord;
  memories: MemoryRecord;
  notes: NoteRecord;
}

export type EntityTableName = keyof EntityTables;

export const ENTITY_TABLES = [
  "ruleGroups",
  "autoCycles",
  "filterRuns",
  "snapshots",
  "assignments",
  "filterAudits",
  "processTasks",
  "processResults",
  "analysisHistories",
  "validationRuns",
  "validationChecks",
  "reviewSamples",
  "learningMemories",
  "knowledgeDocs",
  "chatMessages",
  "memories",
  "notes",
] as const satisfies readonly EntityTableName[];

/** 每张表的主键字段（除 autoCycles 外均为 id） */
export const ENTITY_PRIMARY_KEY: Record<EntityTableName, string> = {
  ruleGroups: "id",
  autoCycles: "ruleGroupId",
  filterRuns: "id",
  snapshots: "id",
  assignments: "id",
  filterAudits: "id",
  processTasks: "id",
  processResults: "id",
  analysisHistories: "id",
  validationRuns: "id",
  validationChecks: "id",
  reviewSamples: "id",
  learningMemories: "id",
  knowledgeDocs: "id",
  chatMessages: "id",
  memories: "id",
  notes: "id",
};

export function isEntityTableName(name: string): name is EntityTableName {
  return (ENTITY_TABLES as readonly string[]).includes(name);
}

export function recordPrimaryKey(table: EntityTableName, record: object): string {
  const value = (record as Record<string, unknown>)[ENTITY_PRIMARY_KEY[table]];
  return typeof value === "string" ? value : String(value ?? "");
}
