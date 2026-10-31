import type { FilterRun, ProcessResult, RuleGroup } from "@/domain/entities";
import type { IssueSource, RuleGroupSourceState, RuleGroupSourceSummary } from "@/domain/issue-source/contracts";
import { createRuleGroupSourceSummary } from "@/domain/issue-source/contracts";

// ─── 筛票运行 ────────────────────────────────────────────────────────────────

/** Jira 筛票超时：请求 10 分钟未返回即中止并标记过期 */
export const FILTER_RUN_TIMEOUT_MS = 10 * 60_000;
/** 飞书可先查询待办项目（30秒），再执行MQL（30秒），预留响应与落盘时间。 */
export const MEEGLE_FILTER_TIMEOUT_MS = 90_000;
export function filterRunTimeoutMs(source?: string): number { return source === "meegle" ? MEEGLE_FILTER_TIMEOUT_MS : FILTER_RUN_TIMEOUT_MS; }
export const FILTER_RUN_TIMEOUT_ERROR = "筛票任务超时";
export const FILTER_RUN_RECOVERY_ERROR = "筛票任务超时，已在启动恢复时自动过期";

export function isExpiredActiveFilterRun(run: Pick<FilterRun, "status" | "createdAt"> & { source?: string }, now = Date.now()): boolean {
  if (run.status !== "running" && run.status !== "pending") return false;
  return now - new Date(run.createdAt).getTime() >= filterRunTimeoutMs(run.source);
}

/** 启动恢复：把超时仍在运行的筛票标记为过期 */
export function expireFilterRun(run: FilterRun, now = new Date()): FilterRun {
  return {
    ...run,
    status: "expired",
    completedAt: run.completedAt ?? now,
    error: run.error ?? FILTER_RUN_RECOVERY_ERROR,
  };
}

export function latestBy<T>(items: T[], dateOf: (item: T) => Date | string | undefined): T | undefined {
  let best: T | undefined;
  let bestTime = -Infinity;
  for (const item of items) {
    const value = dateOf(item);
    const time = value ? new Date(value).getTime() : 0;
    if (time > bestTime) {
      best = item;
      bestTime = time;
    }
  }
  return best;
}

/** 筛票运行 → 看板来源状态 */
export function filterRunToSourceState(run: FilterRun | undefined, configured: boolean): RuleGroupSourceState {
  if (!configured) return { configured: false, status: "disabled", issueCount: 0 };
  if (!run) return { configured: true, status: "idle", issueCount: 0 };
  if (isExpiredActiveFilterRun(run)) run = expireFilterRun(run);
  return {
    configured: true,
    status: run.status === "pending" ? "running" : run.status,
    issueCount: run.issueCount ?? 0,
    error: run.error,
    updatedAt: run.completedAt ?? run.createdAt,
  };
}

/** 由各来源最新筛票运行汇总规则组来源状态 */
export function buildSourceSummary(
  group: Pick<RuleGroup, "jql" | "meegleMql">,
  latestRuns: Partial<Record<IssueSource, FilterRun>>,
): RuleGroupSourceSummary {
  const base = createRuleGroupSourceSummary(group);
  return {
    jira: filterRunToSourceState(latestRuns.jira, base.jira.configured),
    meegle: filterRunToSourceState(latestRuns.meegle, base.meegle.configured),
  };
}

// ─── 处理调度 ────────────────────────────────────────────────────────────────

export type ProcessDispatchAction = "runJiraSnapshots" | "runMeegleAssignments";

export interface ProcessDispatchPlanItem {
  source: IssueSource;
  action: ProcessDispatchAction;
}

/** 只处理“已完成且命中工单数 > 0”的来源 */
export function buildProcessDispatchPlan(summary: RuleGroupSourceSummary): ProcessDispatchPlanItem[] {
  return (["jira", "meegle"] as const).flatMap((source) => {
    const state = summary[source];
    if (state.status !== "completed" || state.issueCount <= 0) return [];
    return [{ source, action: source === "jira" ? "runJiraSnapshots" : "runMeegleAssignments" } as const];
  });
}

// ─── 按工单号分析 ────────────────────────────────────────────────────────────

/** 从标题的 [..] 或 【..】 中提取车型 */
export function extractCarModelFromTitle(summary: string): string {
  const match = summary.match(/\[([^\]]+)\]|【([^】]+)】/);
  return (match ? match[1] || match[2] : "")?.trim() ?? "";
}

/** 车型与规则组 model_to_files 键相等或互相包含（忽略大小写）即匹配 */
export function matchRuleGroupsByModel<T extends Pick<RuleGroup, "model_to_files">>(groups: T[], model: string): T[] {
  const target = model.toLowerCase().trim();
  if (!target) return [];
  return groups.filter((group) =>
    Object.keys(group.model_to_files ?? {}).some((modelKey) => {
      const key = modelKey.toLowerCase().trim();
      return Boolean(key) && (key === target || target.includes(key) || key.includes(target));
    }),
  );
}

/** 规范化 Jira 工单号（去空白、转大写） */
export function normalizeIssueKey(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidIssueKey(value: string): boolean {
  return /^[A-Z][A-Z0-9_]*-\d+$/.test(normalizeIssueKey(value));
}

// ─── 复核 / 回填 ─────────────────────────────────────────────────────────────

export interface ReviewAnalysisContext {
  issueDescription: string;
  commentsText: string;
  rawDataText: string;
  signalSummary: string;
}

/** AI 复核上下文：工单描述、评论、原始数据与信号摘要 */
export function buildReviewAnalysisContext(rawData: Record<string, unknown>, signalSummary?: string): ReviewAnalysisContext {
  const raw = rawData as {
    description?: string;
    comments?: Array<{ author?: string; body?: string; created?: string }>;
  };
  const commentsText = Array.isArray(raw.comments)
    ? raw.comments
        .map((comment, index) =>
          [`【评论 ${index + 1}】 ${comment.author ?? "—"} ${comment.created ?? ""}`.trim(), comment.body ?? ""]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n")
    : "";
  return {
    issueDescription: typeof raw.description === "string" ? raw.description : "",
    commentsText,
    rawDataText: JSON.stringify(rawData, null, 2),
    signalSummary: signalSummary ?? "",
  };
}

const CONCLUSION_MARKERS = ["一致性结论：", "一致性结论:", "分析结论：", "分析结论:"];

/** 回填评论只保留结论部分（从“一致性结论/分析结论”起），找不到标记时回填全文 */
export function extractConclusionForComment(replyText: string): string {
  for (const marker of CONCLUSION_MARKERS) {
    const index = replyText.indexOf(marker);
    if (index !== -1) return replyText.slice(index).trim();
  }
  return replyText;
}

/** 默认回填正文：驳回后回填人工正确结论，否则回填 AI 结论部分 */
export function defaultCommentBody(result: Pick<ProcessResult, "reviewStatus" | "manualCorrectResult" | "replyText">): string {
  if (result.reviewStatus === "rejected") return result.manualCorrectResult ?? "";
  return extractConclusionForComment(result.replyText);
}

/** 已通过，或已驳回且填写了正确结论，并且尚未回填成功 */
export function canCommentResult(result: Pick<ProcessResult, "reviewStatus" | "manualCorrectResult" | "commentStatus">): boolean {
  const reviewed =
    result.reviewStatus === "approved" ||
    (result.reviewStatus === "rejected" && Boolean(result.manualCorrectResult?.trim()));
  return reviewed && result.commentStatus !== "succeeded";
}

export function sanitizeChartPathSegment(value: string): string {
  return value.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
}

/** 车型识别：标题包含 model_to_files 中的车型键（忽略大小写） */
export function detectCarModelFromSummary(summary: string, modelToFiles?: Record<string, unknown>): string {
  if (!modelToFiles) return "";
  const upper = (summary || "").toUpperCase();
  for (const model of Object.keys(modelToFiles)) {
    if (model && upper.includes(model.toUpperCase())) return model;
  }
  return "";
}

/** 回填附图路径：优先用结果里的图片，否则按产物目录约定拼出 CAN 信号图路径 */
export function buildChartBackfillPath(input: {
  group: Pick<RuleGroup, "id" | "name" | "model_to_files">;
  ticketKey: string;
  title: string;
  result: Pick<ProcessResult, "chartImage" | "traceData"> | null | undefined;
}): string | undefined {
  if (input.result?.chartImage) return input.result.chartImage;
  if (!input.result?.traceData) return undefined;
  const groupDirName = sanitizeChartPathSegment(input.group.name || input.group.id);
  const carModel = sanitizeChartPathSegment(detectCarModelFromSummary(input.title, input.group.model_to_files) || "unknown");
  const issueDirName = sanitizeChartPathSegment(input.ticketKey);
  return `/api/charts/log/${groupDirName}/${carModel}/${issueDirName}/can_signals.png`;
}
