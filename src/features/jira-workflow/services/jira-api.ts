import type { ProcessRequest, ProcessResponse } from "@/domain/analysis/process-contracts";
import type { JiraProvider } from "@/domain/entities";
import type { JiraIssue } from "@/domain/issue-source/jira";
import { apiFetch } from "@/shared/lib/api";

/**
 * Jira 相关服务端接口的客户端封装（路径与载荷与旧版一致）。
 * provider 省略时使用默认 Jira；Bosch 规则组传 "bosch"。
 */

export interface JiraFilterResponse {
  issues: JiraIssue[];
  total: number;
}

export function fetchJiraIssues(jql: string, provider?: JiraProvider, signal?: AbortSignal): Promise<JiraFilterResponse> {
  return apiFetch<JiraFilterResponse>("/api/jira/filter", {
    method: "POST",
    json: provider ? { jql, provider } : { jql },
    signal,
  });
}

export async function postProcessIssue(request: ProcessRequest): Promise<ProcessResponse> {
  const data = await apiFetch<ProcessResponse>("/api/issues/process", { method: "POST", json: request });
  return { ...data, replyText: data?.replyText ?? "" };
}

/** 交接时间（经办人变更为当前处理人的时间）；任何失败都视为未知 */
export async function fetchJiraHandoverAt(issueKey: string, jiraProvider?: JiraProvider): Promise<Date | undefined> {
  try {
    const data = await apiFetch<{ handoverAt?: string }>("/api/jira/handover", {
      method: "POST",
      json: { issueKey, jiraProvider },
    });
    return data?.handoverAt ? new Date(data.handoverAt) : undefined;
  } catch {
    return undefined;
  }
}

export interface JiraCommentResponse {
  success: boolean;
  commentId?: string;
  error?: string;
}

export async function postJiraComment(input: {
  issueKey: string;
  body: string;
  chartImagePath?: string;
  jiraProvider?: JiraProvider;
}): Promise<{ commentId?: string }> {
  const data = await apiFetch<JiraCommentResponse>("/api/jira/comment", { method: "POST", json: input });
  if (!data?.success) throw new Error(data?.error ?? "回填 Jira 失败");
  return { commentId: data.commentId };
}

export interface JiraTransitionOption {
  id: string;
  name: string;
  targetStatus?: string;
}

export interface JiraAssigneeCandidate {
  name: string;
  displayName: string;
  emailAddress?: string;
  sourceLabels: string[];
  active?: boolean;
}

export interface JiraTransitionInfo {
  transitions: JiraTransitionOption[];
  assigneeCandidates: JiraAssigneeCandidate[];
}

function transitionUrl(ruleGroupId: string, issueKey: string, provider?: JiraProvider): string {
  const base = `/api/rule-groups/${encodeURIComponent(ruleGroupId)}/processed-issues/${encodeURIComponent(issueKey)}/transition`;
  return provider ? `${base}?provider=${encodeURIComponent(provider)}` : base;
}

export async function fetchJiraTransitions(
  ruleGroupId: string,
  issueKey: string,
  provider?: JiraProvider,
): Promise<JiraTransitionInfo> {
  const data = await apiFetch<Partial<JiraTransitionInfo> & { success?: boolean; error?: string }>(
    transitionUrl(ruleGroupId, issueKey, provider),
  );
  if (data?.success === false) throw new Error(data.error ?? "获取可指派人员失败");
  return { transitions: data?.transitions ?? [], assigneeCandidates: data?.assigneeCandidates ?? [] };
}

export async function postJiraTransition(input: {
  ruleGroupId: string;
  issueKey: string;
  transitionId: string;
  targetUser: string;
  jiraProvider?: JiraProvider;
}): Promise<{ targetStatus?: string }> {
  const data = await apiFetch<{ success?: boolean; targetStatus?: string; error?: string }>(
    transitionUrl(input.ruleGroupId, input.issueKey),
    {
      method: "POST",
      json: { transitionId: input.transitionId, targetUser: input.targetUser, jiraProvider: input.jiraProvider },
    },
  );
  if (data?.success === false) throw new Error(data.error ?? "指派失败");
  return { targetStatus: data?.targetStatus };
}
