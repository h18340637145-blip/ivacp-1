import type { TicketSource } from "@/domain/entities";
import type { IssueScene } from "@/domain/analysis/issue-scene";
import type { Annotation, LabelSuggestion, Verdict } from "./schema";

/**
 * 标注条目（服务端 `/api/labeling/*` 与客户端工作台共用的载荷结构）。
 * itemId = `${source}:${processResult.id}`，与旧版保持一致。
 */
export type ItemSource = TicketSource;

export interface LabelItemSummary {
  itemId: string;
  source: ItemSource;
  /** Jira 为 issueKey；飞书为 `飞书 #<workItemId>` */
  issueKey: string;
  title: string;
  /** 由标题中的「台架」/「实车」判定；无标志时缺省 */
  scene?: IssueScene;
  reviewStatus: string;
  errorCategory?: string;
  excerpt: string;
  annotated: boolean;
  verdict?: Verdict;
  updatedAt: string;
}

export interface LabelItemDetail extends LabelItemSummary {
  replyText: string;
  signalSummary: string;
  errorReason: string;
  manualCorrectResult: string;
  aiReviewVerdict?: string;
  aiReviewReason?: string;
  suggestion: LabelSuggestion;
  annotation?: Annotation;
}

export type LabelStatusFilter = "all" | "todo" | "done";
export type LabelSceneFilter = IssueScene | "none" | "all";

export interface LabelListFilter {
  source?: ItemSource;
  status?: LabelStatusFilter;
  reviewStatus?: string;
  /** all=不限；none=标题无台架/实车标志 */
  scene?: LabelSceneFilter;
  query?: string;
  limit?: number;
}

export interface LabelListResult {
  items: LabelItemSummary[];
  total: number;
  annotated: number;
}

export const LABEL_LIST_DEFAULT_LIMIT = 200;
export const LABEL_LIST_MAX_LIMIT = 500;

export function makeItemId(source: ItemSource, recordId: string): string {
  return `${source}:${recordId}`;
}

export function parseItemId(itemId: string): { source: ItemSource; recordId: string } {
  const index = itemId.indexOf(":");
  const source = index > 0 ? itemId.slice(0, index) : "";
  const recordId = index > 0 ? itemId.slice(index + 1) : "";
  if ((source !== "jira" && source !== "meegle") || !recordId || recordId.length > 255) throw new Error("无效的条目 ID");
  return { source, recordId };
}

export function displayIssueKey(source: ItemSource, ticketKey: string): string {
  return source === "jira" ? ticketKey : `飞书 #${ticketKey}`;
}

/** 按状态 / 复核状态 / 场景 / 关键字过滤并截断（总数与已标注数基于过滤前后分别统计） */
export function filterLabelItems(all: LabelItemSummary[], filter: LabelListFilter = {}): LabelListResult {
  const query = filter.query?.trim().toLowerCase();
  const filtered = all.filter((item) => {
    if (filter.source && item.source !== filter.source) return false;
    if (filter.status === "todo" && item.annotated) return false;
    if (filter.status === "done" && !item.annotated) return false;
    if (filter.reviewStatus && filter.reviewStatus !== "all" && item.reviewStatus !== filter.reviewStatus) return false;
    if (filter.scene && filter.scene !== "all" && (item.scene ?? "none") !== filter.scene) return false;
    if (query && !`${item.issueKey} ${item.title}`.toLowerCase().includes(query)) return false;
    return true;
  });
  const limit = Math.min(Math.max(filter.limit ?? LABEL_LIST_DEFAULT_LIMIT, 1), LABEL_LIST_MAX_LIMIT);
  return { items: filtered.slice(0, limit), total: filtered.length, annotated: all.filter((item) => item.annotated).length };
}
