/**
 * 旧系统（JiraAnalyzerDB，25 张表）→ IvacpDB（统一表结构）的纯函数迁移器。
 *
 * 三个入口共用此转换：
 * 1. 浏览器同源旧 IndexedDB → 新 IndexedDB（数据管理页“一键迁移”）
 * 2. 旧备份文件（jira-analyzer-indexeddb-backup）导入
 * 3. 服务端旧 MySQL 镜像（idb_records）→ 新库（POST /api/migration/legacy 与 npm run migrate:legacy）
 *
 * 规则：尽量保留原记录 id（数据标注 itemId = `${source}:${resultId}` 依赖结果 id 不变），
 * 仅在 Jira/飞书两张旧表合并到同一新表且 id 冲突时，为飞书记录加 `meegle:` 前缀。
 */
import type {
  AnalysisHistory,
  Assignment,
  AutoCycleState,
  CommentStatus,
  EntityTableName,
  FilterAudit,
  FilterRun,
  LearningMemory,
  ProcessResult,
  ProcessStage,
  ProcessTask,
  ReviewSample,
  RuleGroup,
  TicketSnapshot,
  TicketSource,
  TransitionStatus,
  ValidationCheck,
  ValidationRun,
} from "@/domain/entities";
import type { BackupTables } from "@/domain/storage/backup-format";
import { toDate } from "@/domain/storage/serialization";

export const LEGACY_DB_NAME = "JiraAnalyzerDB";
export const LEGACY_BACKUP_FORMAT = "jira-analyzer-indexeddb-backup";

export const LEGACY_TABLES = [
  "ruleGroups",
  "filterTasks",
  "filteredIssueSnapshots",
  "issueProcessTasks",
  "issueProcessResults",
  "issueReviewSamples",
  "issueAnalysisHistories",
  "issueValidationRuns",
  "issueValidationChecks",
  "autoCycleStates",
  "learningMemories",
  "meegleAssignments",
  "meegleIssueSnapshots",
  "meegleProcessTasks",
  "meegleProcessResults",
  "meegleAnalysisHistories",
  "meegleValidationRuns",
  "meegleValidationChecks",
  "meegleFilterAudits",
  "meegleFilterTasks",
  "meegleFilteredIssueSnapshots",
  "knowledgeDocs",
  "chatMessages",
  "memories",
  "notes",
] as const;

export type LegacyTableName = (typeof LEGACY_TABLES)[number];
type Row = Record<string, unknown>;
export type LegacyTables = Partial<Record<string, unknown[]>>;

export interface MigrationReport {
  /** 旧表 → 读取行数 */
  read: Record<string, number>;
  /** 新表 → 写入行数 */
  written: Partial<Record<EntityTableName, number>>;
  /** 迁移中发现的数据问题（不阻断迁移） */
  warnings: string[];
}

export interface LegacyMigrationResult {
  tables: BackupTables;
  report: MigrationReport;
  /**
   * 因 id 冲突被改名的处理结果：`${source}:${旧 id}` → 新 id。
   * 标注系统的 itemId（`${source}:${resultId}`）需据此重映射。
   */
  renamedResultIds: Record<string, string>;
}

export function isLegacyTableName(name: string): name is LegacyTableName {
  return (LEGACY_TABLES as readonly string[]).includes(name);
}

// ─── 小工具 ──────────────────────────────────────────────────────────────────

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);
const optStr = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : typeof value === "number" ? String(value) : undefined;
const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const optNum = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const date = (value: unknown, fallback?: Date): Date => toDate(value) ?? fallback ?? new Date(0);
const optDate = (value: unknown): Date | undefined => toDate(value);
const rows = (tables: LegacyTables, name: LegacyTableName): Row[] =>
  (tables[name] ?? []).filter((item): item is Row => Boolean(item) && typeof item === "object");
const weekend = (value: unknown): "是" | "否" | undefined => (value === "是" || value === "否" ? value : undefined);

/** 去掉值为 undefined 的键，使输出稳定、便于比对 */
function compact<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

/** 旧飞书样本/记忆 key：`meegle-{projectKey}-{workItemTypeKey}-{workItemId}` → workItemId */
export function legacyMeegleIssueKeyToTicketKey(key: string): string | null {
  const match = /^meegle-.+-(\d+)$/.exec(key);
  return match ? match[1] : null;
}

function commentStatus(value: unknown): CommentStatus {
  const allowed: CommentStatus[] = ["not_started", "uploading", "commenting", "succeeded", "failed"];
  return allowed.includes(value as CommentStatus) ? (value as CommentStatus) : "not_started";
}

/** 旧 Jira 用 hasCommentedToJira 布尔表示回填状态 */
function jiraCommentStatus(row: Row): CommentStatus {
  if (row.hasCommentedToJira === true) return "succeeded";
  if (optStr(row.commentError)) return "failed";
  return "not_started";
}

function transitionStatus(value: unknown): TransitionStatus {
  const allowed: TransitionStatus[] = ["not_selected", "pending", "succeeded", "failed"];
  return allowed.includes(value as TransitionStatus) ? (value as TransitionStatus) : "not_selected";
}

function reviewStatus(value: unknown): ProcessResult["reviewStatus"] {
  return value === "approved" || value === "rejected" ? value : "pending";
}

/** 为跨来源合并表分配不冲突的 id：优先保留原 id，冲突时加来源前缀 */
class IdAllocator {
  private readonly used = new Set<string>();
  private readonly mapping = new Map<string, string>();

  /** 被改名的 id：`${source}:${原 id}` → 新 id */
  renamed(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, id] of this.mapping) {
      const [source, originalId] = key.split("\u0000");
      if (id !== originalId) result[`${source}:${originalId}`] = id;
    }
    return result;
  }

  allocate(source: TicketSource, originalId: string): string {
    const key = `${source}\u0000${originalId}`;
    const existing = this.mapping.get(key);
    if (existing) return existing;
    const id = this.used.has(originalId) ? `${source}:${originalId}` : originalId;
    this.used.add(id);
    this.mapping.set(key, id);
    return id;
  }

  resolve(source: TicketSource, originalId: string | undefined): string | undefined {
    if (!originalId) return undefined;
    return this.mapping.get(`${source}\u0000${originalId}`) ?? originalId;
  }
}

// ─── 主转换 ──────────────────────────────────────────────────────────────────

export function migrateLegacyTables(legacy: LegacyTables): LegacyMigrationResult {
  const report: MigrationReport = { read: {}, written: {}, warnings: [] };
  for (const name of LEGACY_TABLES) {
    const count = rows(legacy, name).length;
    if (count > 0) report.read[name] = count;
  }

  const filterRunIds = new IdAllocator();
  const snapshotIds = new IdAllocator();
  const taskIds = new IdAllocator();
  const resultIds = new IdAllocator();
  const historyIds = new IdAllocator();
  const validationRunIds = new IdAllocator();
  const validationCheckIds = new IdAllocator();

  // 规则组：结构不变，仅规范时间
  const ruleGroups: RuleGroup[] = rows(legacy, "ruleGroups").map((row) =>
    compact({
      ...(row as unknown as RuleGroup),
      id: str(row.id),
      name: str(row.name),
      jql: str(row.jql),
      expand: str(row.expand),
      sortOrder: num(row.sortOrder),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt, date(row.createdAt)),
    }),
  );

  // 自动周期：主键改为 ruleGroupId，同组多条时保留最后一条
  const autoCycleMap = new Map<string, AutoCycleState>();
  for (const row of rows(legacy, "autoCycleStates")) {
    const ruleGroupId = str(row.ruleGroupId);
    if (!ruleGroupId) continue;
    autoCycleMap.set(
      ruleGroupId,
      compact<AutoCycleState>({
        ruleGroupId,
        isActive: row.isActive === true,
        intervalMinutes: num(row.intervalMinutes, 30),
        lastRunAt: optDate(row.lastRunAt),
        nextRunAt: optDate(row.nextRunAt),
      }),
    );
  }

  // 筛票运行
  const filterRuns: FilterRun[] = [
    ...rows(legacy, "filterTasks").map((row) =>
      compact<FilterRun>({
        id: filterRunIds.allocate("jira", str(row.id)),
        source: "jira",
        ruleGroupId: str(row.ruleGroupId),
        query: str(row.jql),
        status: str(row.status, "completed") as FilterRun["status"],
        issueCount: num(row.issueCount),
        error: optStr(row.error),
        createdAt: date(row.createdAt),
        completedAt: optDate(row.completedAt),
      }),
    ),
    ...rows(legacy, "meegleFilterTasks").map((row) =>
      compact<FilterRun>({
        id: filterRunIds.allocate("meegle", str(row.id)),
        source: "meegle",
        ruleGroupId: str(row.ruleGroupId),
        query: str(row.mql),
        projectKey: optStr(row.projectKey),
        runId: optStr(row.runId),
        status: str(row.status, "completed") as FilterRun["status"],
        issueCount: num(row.issueCount),
        error: optStr(row.error),
        createdAt: date(row.createdAt),
        completedAt: optDate(row.completedAt),
      }),
    ),
  ];

  // 快照
  const snapshots: TicketSnapshot[] = [];
  const jiraSnapshotByLegacyId = new Map<string, TicketSnapshot>();
  const groupById = new Map(ruleGroups.map((group) => [group.id, group]));
  for (const row of rows(legacy, "filteredIssueSnapshots")) {
    const snapshot = compact<TicketSnapshot>({
      id: snapshotIds.allocate("jira", str(row.id)),
      source: "jira",
      jiraProvider: groupById.has(str(row.ruleGroupId)) ? groupById.get(str(row.ruleGroupId))?.jiraProvider ?? "default" : undefined,
      ticketKey: str(row.issueKey),
      ruleGroupId: str(row.ruleGroupId),
      origin: "filter",
      filterRunId: filterRunIds.resolve("jira", optStr(row.filterTaskId)),
      title: str(row.summary),
      rawData: (row.rawData as Record<string, unknown>) ?? {},
      createdAt: date(row.createdAt),
    });
    snapshots.push(snapshot);
    jiraSnapshotByLegacyId.set(str(row.id), snapshot);
  }
  const meegleSnapshot = (row: Row, origin: TicketSnapshot["origin"]): TicketSnapshot =>
    compact<TicketSnapshot>({
      id: snapshotIds.allocate("meegle", str(row.id)),
      source: "meegle",
      ticketKey: str(row.workItemId),
      ruleGroupId: str(row.ruleGroupId),
      origin,
      filterRunId: origin === "filter" ? filterRunIds.resolve("meegle", optStr(row.filterTaskId)) : undefined,
      assignmentId: origin === "process" ? optStr(row.assignmentId) : undefined,
      title: str(row.workItemName),
      stateName: optStr(row.stateName),
      projectKey: optStr(row.projectKey),
      projectName: optStr(row.projectName),
      workItemTypeKey: optStr(row.workItemTypeKey),
      workItemId: optNum(row.workItemId),
      rawData: (row.rawData as Record<string, unknown>) ?? {},
      createdAt: date(row.createdAt),
    });
  for (const row of rows(legacy, "meegleFilteredIssueSnapshots")) snapshots.push(meegleSnapshot(row, "filter"));
  for (const row of rows(legacy, "meegleIssueSnapshots")) snapshots.push(meegleSnapshot(row, "process"));
  const snapshotById = new Map(snapshots.map((item) => [item.id, item]));

  // 飞书分配（任务 / 结果 id 在下方分配后再解析）
  const assignmentRows = rows(legacy, "meegleAssignments");
  const assignments: Assignment[] = assignmentRows.map((row) =>
    compact<Assignment>({
      id: str(row.id),
      source: "meegle",
      ticketKey: str(row.workItemId),
      workItemId: num(row.workItemId),
      workItemTypeKey: str(row.workItemTypeKey) || "issue",
      workItemName: str(row.workItemName),
      projectKey: str(row.projectKey),
      projectName: str(row.projectName),
      stateName: str(row.stateName),
      ruleGroupId: str(row.ruleGroupId),
      assignmentSource: row.assignmentSource === "auto" ? "auto" : "manual",
      lastFilterRunId: optStr(row.lastFilterRunId),
      status: str(row.status, "pending") as Assignment["status"],
      processingStartedAt: optDate(row.processingStartedAt),
      result: optStr(row.result),
      error: optStr(row.error),
      assignedAt: date(row.assignedAt),
      completedAt: optDate(row.completedAt),
    }),
  );
  const assignmentById = new Map(assignments.map((item) => [item.id, item]));

  // 处理任务
  const processTasks: ProcessTask[] = [];
  const jiraTaskByLegacyId = new Map<string, ProcessTask>();
  for (const row of rows(legacy, "issueProcessTasks")) {
    const snapshot = jiraSnapshotByLegacyId.get(str(row.snapshotId));
    if (!snapshot) report.warnings.push(`Jira 处理任务 ${str(row.id)} 的快照缺失`);
    const task = compact<ProcessTask>({
      id: taskIds.allocate("jira", str(row.id)),
      source: "jira",
      ticketKey: snapshot?.ticketKey ?? "",
      ruleGroupId: str(row.ruleGroupId),
      snapshotId: snapshotIds.resolve("jira", str(row.snapshotId)) ?? "",
      status: str(row.status, "completed") as ProcessTask["status"],
      stage: optStr(row.stage) as ProcessStage | undefined,
      error: optStr(row.error),
      createdAt: date(row.createdAt),
      completedAt: optDate(row.completedAt),
    });
    processTasks.push(task);
    jiraTaskByLegacyId.set(str(row.id), task);
  }
  const meegleTaskByLegacyId = new Map<string, ProcessTask>();
  for (const row of rows(legacy, "meegleProcessTasks")) {
    const snapshotId = snapshotIds.resolve("meegle", str(row.snapshotId)) ?? "";
    const assignment = assignmentById.get(str(row.assignmentId));
    const task = compact<ProcessTask>({
      id: taskIds.allocate("meegle", str(row.id)),
      source: "meegle",
      ticketKey: assignment?.ticketKey ?? snapshotById.get(snapshotId)?.ticketKey ?? "",
      ruleGroupId: str(row.ruleGroupId),
      snapshotId,
      assignmentId: optStr(row.assignmentId),
      status: str(row.status, "completed") as ProcessTask["status"],
      stage: optStr(row.stage) as ProcessStage | undefined,
      stages: (row.stages as Record<string, string> | undefined) ?? undefined,
      mode: optStr(row.mode),
      elapsedMs: optNum(row.elapsedMs),
      error: optStr(row.error),
      createdAt: date(row.createdAt),
      completedAt: optDate(row.completedAt),
    });
    processTasks.push(task);
    meegleTaskByLegacyId.set(str(row.id), task);
  }

  // 处理结果
  const processResults: ProcessResult[] = [];
  for (const row of rows(legacy, "issueProcessResults")) {
    const task = jiraTaskByLegacyId.get(str(row.processTaskId));
    if (!task) report.warnings.push(`Jira 结果 ${str(row.id)} 的处理任务缺失，规则组未知`);
    processResults.push(
      compact<ProcessResult>({
        id: resultIds.allocate("jira", str(row.id)),
        source: "jira",
        ticketKey: str(row.issueKey) || task?.ticketKey || "",
        ruleGroupId: task?.ruleGroupId ?? "",
        processTaskId: task?.id ?? str(row.processTaskId),
        snapshotId: task?.snapshotId ?? "",
        replyText: str(row.replyText),
        tokenUsage: optNum(row.tokenUsage),
        aiConclusionTime: optStr(row.aiConclusionTime),
        chartImage: optStr(row.chartImage),
        signalSummary: optStr(row.signalSummary),
        reviewEvidence: row.reviewEvidence as ProcessResult["reviewEvidence"],
        traceData: row.traceData as ProcessResult["traceData"],
        ticks: row.ticks as ProcessResult["ticks"],
        reviewStatus: reviewStatus(row.reviewStatus),
        manualCorrectResult: optStr(row.manualCorrectResult),
        errorReason: optStr(row.errorReason),
        errorCategory: optStr(row.errorCategory) as ProcessResult["errorCategory"],
        commentStatus: jiraCommentStatus(row),
        commentId: optStr(row.commentId),
        commentedAt: optDate(row.commentedAt),
        commentError: optStr(row.commentError),
        transitionStatus: "not_selected",
        handoverAt: optDate(row.handoverAt),
        handoverOutAt: optDate(row.handoverOutAt),
        dwellMs: optNum(row.dwellMs),
        isWeekend: weekend(row.isWeekend),
        createdAt: date(row.createdAt),
      }),
    );
  }
  for (const row of rows(legacy, "meegleProcessResults")) {
    const task = meegleTaskByLegacyId.get(str(row.processTaskId));
    const assignment = assignmentById.get(str(row.assignmentId));
    processResults.push(
      compact<ProcessResult>({
        id: resultIds.allocate("meegle", str(row.id)),
        source: "meegle",
        ticketKey: optStr(row.workItemId) ?? assignment?.ticketKey ?? task?.ticketKey ?? "",
        ruleGroupId: task?.ruleGroupId ?? assignment?.ruleGroupId ?? "",
        processTaskId: task?.id ?? str(row.processTaskId),
        snapshotId: snapshotIds.resolve("meegle", str(row.snapshotId)) ?? "",
        assignmentId: optStr(row.assignmentId),
        replyText: str(row.replyText),
        tokenUsage: optNum(row.tokenUsage),
        model: optStr(row.model),
        chartImage: optStr(row.chartImage),
        signalSummary: optStr(row.signalSummary),
        reviewEvidence: row.reviewEvidence as ProcessResult["reviewEvidence"],
        traceData: row.traceData as ProcessResult["traceData"],
        ticks: row.ticks as ProcessResult["ticks"],
        artifactRef: optStr(row.artifactRef),
        analysisReceipt: optStr(row.analysisReceipt),
        reviewStatus: reviewStatus(row.reviewStatus),
        aiReviewVerdict: optStr(row.aiReviewVerdict) as ProcessResult["aiReviewVerdict"],
        aiReviewReason: optStr(row.aiReviewReason),
        aiReviewedAt: optDate(row.aiReviewedAt),
        manualReviewedAt: optDate(row.manualReviewedAt),
        manualCorrectResult: optStr(row.manualCorrectResult),
        errorReason: optStr(row.errorReason),
        errorCategory: optStr(row.errorCategory) as ProcessResult["errorCategory"],
        commentStatus: commentStatus(row.commentStatus),
        commentId: optStr(row.commentId),
        commentedAt: optDate(row.commentedAt),
        commentError: optStr(row.commentError),
        transitionStatus: transitionStatus(row.transitionStatus),
        transitionId: optStr(row.transitionId),
        transitionName: optStr(row.transitionName),
        transitionedAt: optDate(row.transitionedAt),
        transitionError: optStr(row.transitionError),
        handoverAt: optDate(row.handoverAt),
        handoverOutAt: optDate(row.handoverOutAt),
        dwellMs: optNum(row.dwellMs),
        isWeekend: weekend(row.isWeekend),
        createdAt: date(row.createdAt),
      }),
    );
  }

  // 分配上的任务 / 结果引用按新 id 解析
  assignmentRows.forEach((row, index) => {
    const assignment = assignments[index];
    const latestTaskId = taskIds.resolve("meegle", optStr(row.latestTaskId));
    const latestAttemptTaskId = taskIds.resolve("meegle", optStr(row.latestAttemptTaskId));
    const latestResultId = resultIds.resolve("meegle", optStr(row.latestResultId));
    if (latestTaskId) assignment.latestTaskId = latestTaskId;
    if (latestAttemptTaskId) assignment.latestAttemptTaskId = latestAttemptTaskId;
    if (latestResultId) assignment.latestResultId = latestResultId;
  });

  // 分析历史
  const analysisHistories: AnalysisHistory[] = [
    ...rows(legacy, "issueAnalysisHistories").map((row) =>
      compact<AnalysisHistory>({
        id: historyIds.allocate("jira", str(row.id)),
        source: "jira",
        ticketKey: str(row.issueKey),
        ruleGroupId: str(row.ruleGroupId),
        sourceSnapshotId: snapshotIds.resolve("jira", str(row.sourceSnapshotId)) ?? "",
        sourceProcessTaskId: taskIds.resolve("jira", str(row.sourceProcessTaskId)) ?? "",
        sourceResultId: resultIds.resolve("jira", str(row.sourceResultId)) ?? "",
        replyText: str(row.replyText),
        reviewStatus: reviewStatus(row.reviewStatus),
        commentStatus: jiraCommentStatus(row),
        transitionStatus: "not_selected",
        aiConclusionTime: optStr(row.aiConclusionTime),
        manualCorrectResult: optStr(row.manualCorrectResult),
        errorReason: optStr(row.errorReason),
        errorCategory: optStr(row.errorCategory) as AnalysisHistory["errorCategory"],
        resultCreatedAt: date(row.resultCreatedAt),
        archivedAt: date(row.archivedAt),
      }),
    ),
    ...rows(legacy, "meegleAnalysisHistories").map((row) =>
      compact<AnalysisHistory>({
        id: historyIds.allocate("meegle", str(row.id)),
        source: "meegle",
        ticketKey: str(row.workItemId),
        ruleGroupId: str(row.ruleGroupId),
        assignmentId: optStr(row.assignmentId),
        sourceSnapshotId: snapshotIds.resolve("meegle", str(row.sourceSnapshotId)) ?? "",
        sourceProcessTaskId: taskIds.resolve("meegle", str(row.sourceProcessTaskId)) ?? "",
        sourceResultId: resultIds.resolve("meegle", str(row.sourceResultId)) ?? "",
        replyText: str(row.replyText),
        reviewStatus: reviewStatus(row.reviewStatus),
        commentStatus: commentStatus(row.commentStatus),
        transitionStatus: transitionStatus(row.transitionStatus),
        manualCorrectResult: optStr(row.manualCorrectResult),
        errorReason: optStr(row.errorReason),
        errorCategory: optStr(row.errorCategory) as AnalysisHistory["errorCategory"],
        artifactRef: optStr(row.artifactRef),
        resultCreatedAt: date(row.resultCreatedAt),
        archivedAt: date(row.archivedAt),
      }),
    ),
  ];

  // 校验
  const toValidationRun = (source: TicketSource) => (row: Row): ValidationRun =>
    compact<ValidationRun>({
      id: validationRunIds.allocate(source, str(row.id)),
      source,
      resultId: resultIds.resolve(source, str(row.resultId)) ?? "",
      validationStatus: str(row.validationStatus, "unknown") as ValidationRun["validationStatus"],
      systemVerdict: str(row.systemVerdict, "unknown") as ValidationRun["systemVerdict"],
      manualVerdict: optStr(row.manualVerdict) as ValidationRun["manualVerdict"],
      manualVerdictAt: optDate(row.manualVerdictAt),
      manualVerdictBy: optStr(row.manualVerdictBy),
      manualVerdictReason: optStr(row.manualVerdictReason),
      diffSeconds: num(row.diffSeconds),
      detail: (row.detail as Record<string, unknown>) ?? {},
      createdAt: date(row.createdAt),
    });
  const validationRuns: ValidationRun[] = [
    ...rows(legacy, "issueValidationRuns").map(toValidationRun("jira")),
    ...rows(legacy, "meegleValidationRuns").map(toValidationRun("meegle")),
  ];
  const toValidationCheck = (source: TicketSource) => (row: Row): ValidationCheck =>
    compact<ValidationCheck>({
      id: validationCheckIds.allocate(source, str(row.id)),
      source,
      runId: validationRunIds.resolve(source, str(row.runId)) ?? "",
      type: str(row.type),
      status: str(row.status, "warning") as ValidationCheck["status"],
      expected: optStr(row.expected),
      actual: optStr(row.actual),
      message: str(row.message),
      evidenceSource: optStr(row.evidenceSource),
      confidence: optNum(row.confidence),
      createdAt: date(row.createdAt),
    });
  const validationChecks: ValidationCheck[] = [
    ...rows(legacy, "issueValidationChecks").map(toValidationCheck("jira")),
    ...rows(legacy, "meegleValidationChecks").map(toValidationCheck("meegle")),
  ];

  // 复核样本：旧飞书样本 key 为 meegle-{project}-{type}-{id}，统一为 workItemId
  const reviewSamples: ReviewSample[] = rows(legacy, "issueReviewSamples").map((row) => {
    const legacyKey = str(row.issueKey);
    const meegleKey = legacyMeegleIssueKeyToTicketKey(legacyKey);
    return compact<ReviewSample>({
      id: str(row.id),
      source: meegleKey ? "meegle" : "jira",
      ruleGroupId: str(row.ruleGroupId),
      ticketKey: meegleKey ?? legacyKey,
      issueSummary: optStr(row.issueSummary),
      evidenceFingerprintText: optStr(row.evidenceFingerprintText),
      props: row.props as string[] | undefined,
      signalTokens: row.signalTokens as string[] | undefined,
      propertyIds: row.propertyIds as string[] | undefined,
      carModel: optStr(row.carModel),
      sampleKind: row.sampleKind === "approved" ? "approved" : "correction",
      approvedConclusion: optStr(row.approvedConclusion),
      issueSummaryEmbedding: row.issueSummaryEmbedding as number[] | undefined,
      embeddingModel: optStr(row.embeddingModel),
      embeddingUpdatedAt: optDate(row.embeddingUpdatedAt),
      wrongConclusion: str(row.wrongConclusion),
      correctConclusion: str(row.correctConclusion),
      errorReason: str(row.errorReason),
      errorCategory: optStr(row.errorCategory) as ReviewSample["errorCategory"],
      createdAt: date(row.createdAt),
    });
  });

  const learningMemories: LearningMemory[] = rows(legacy, "learningMemories").map((row) => {
    const memoryKey = str(row.memoryKey);
    return {
      id: str(row.id),
      ruleGroupId: str(row.ruleGroupId),
      memoryKey: legacyMeegleIssueKeyToTicketKey(memoryKey) ?? memoryKey,
      content: str(row.content),
      updatedAt: date(row.updatedAt),
    };
  });

  const filterAudits: FilterAudit[] = rows(legacy, "meegleFilterAudits").map((row) =>
    compact<FilterAudit>({
      ...(row as unknown as FilterAudit),
      id: str(row.id),
      source: "meegle",
      ticketKey: str(row.workItemId),
      workItemId: num(row.workItemId),
      createdAt: date(row.createdAt),
    }),
  );

  const tables: BackupTables = {
    ruleGroups,
    autoCycles: [...autoCycleMap.values()],
    filterRuns,
    snapshots,
    assignments,
    filterAudits,
    processTasks,
    processResults,
    analysisHistories,
    validationRuns,
    validationChecks,
    reviewSamples,
    learningMemories,
    // 智能助手数据结构未变，原样迁移
    knowledgeDocs: rows(legacy, "knowledgeDocs") as unknown as BackupTables["knowledgeDocs"],
    chatMessages: rows(legacy, "chatMessages") as unknown as BackupTables["chatMessages"],
    memories: rows(legacy, "memories") as unknown as BackupTables["memories"],
    notes: rows(legacy, "notes") as unknown as BackupTables["notes"],
  };

  for (const [name, list] of Object.entries(tables)) {
    const count = (list as unknown[]).length;
    if (count > 0) report.written[name as EntityTableName] = count;
  }
  return { tables, report, renamedResultIds: resultIds.renamed() };
}
