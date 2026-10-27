import type { JiraConnection } from "@/server/jira/connection";
import { isOk, jiraHttpRequest } from "@/server/jira/http";

interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string };
}

export interface TransitionOption {
  id: string;
  name: string;
  targetStatus: string;
}

interface JiraUser {
  name?: string;
  key?: string;
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
}

export interface JiraAssigneeCandidate {
  name: string;
  displayName: string;
  emailAddress?: string;
  sourceLabels: string[];
  active?: boolean;
}

/** Jira REST JSON 请求（兼容 http/https 服务地址；2xx 空响应或非 JSON 返回 {}） */
async function jiraRequest<T>(
  connection: JiraConnection,
  pathname: string,
  options: { method: "GET" | "POST" | "PUT"; body?: unknown; timeoutMs?: number },
): Promise<T> {
  if (connection.missing.length > 0) {
    throw new Error(`缺少 Jira 环境变量：${connection.missing.join(" / ")}`);
  }
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const { statusCode, text } = await jiraHttpRequest(new URL(pathname, connection.server).toString(), {
    method: options.method,
    headers: {
      Authorization: `Basic ${connection.basicAuth}`,
      Accept: "application/json",
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload,
    timeoutMs: options.timeoutMs ?? 30_000,
    timeoutMessage: "Jira 状态流转请求超时",
    allowHttp: true,
  });
  if (!isOk(statusCode)) throw new Error(`Jira API 返回 HTTP ${statusCode}: ${text.slice(0, 300)}`);
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

export async function getTransitions(connection: JiraConnection, issueKey: string): Promise<TransitionOption[]> {
  const data = await jiraRequest<{ transitions?: JiraTransition[] }>(
    connection,
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
    { method: "GET" },
  );
  return (data.transitions ?? []).map((transition) => ({
    id: transition.id,
    name: transition.name,
    targetStatus: transition.to?.name ?? transition.name,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function collectUserCandidate(candidates: Map<string, JiraAssigneeCandidate>, value: unknown, sourceLabel: string) {
  if (!isRecord(value)) return;
  const user = value as JiraUser;
  const name =
    toStringValue(user.name) ??
    toStringValue(user.key) ??
    toStringValue(user.accountId) ??
    toStringValue(user.emailAddress);
  const displayName = toStringValue(user.displayName) ?? name;
  const looksLikeJiraUser = Boolean(displayName && name && (user.displayName || user.emailAddress || user.name || user.key || user.accountId));
  if (!name || !displayName || !looksLikeJiraUser) return;

  const existing = candidates.get(name);
  if (existing) {
    if (!existing.sourceLabels.includes(sourceLabel)) existing.sourceLabels.push(sourceLabel);
    if (!existing.emailAddress && user.emailAddress) existing.emailAddress = user.emailAddress;
    return;
  }
  candidates.set(name, {
    name,
    displayName,
    emailAddress: toStringValue(user.emailAddress),
    sourceLabels: [sourceLabel],
    active: typeof user.active === "boolean" ? user.active : undefined,
  });
}

export function collectUsersDeep(
  candidates: Map<string, JiraAssigneeCandidate>,
  value: unknown,
  sourceLabel: string,
  seen = new WeakSet<object>(),
) {
  if (Array.isArray(value)) {
    for (const item of value) collectUsersDeep(candidates, item, sourceLabel, seen);
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  collectUserCandidate(candidates, value, sourceLabel);
  for (const nestedValue of Object.values(value)) collectUsersDeep(candidates, nestedValue, sourceLabel, seen);
}

/** 从经办人 / 报告人 / 创建人 / 评论作者 / 关注人 / 其它工单字段中收集可指派的用户 */
export async function getAssigneeCandidates(connection: JiraConnection, issueKey: string): Promise<JiraAssigneeCandidate[]> {
  const candidates = new Map<string, JiraAssigneeCandidate>();
  const issue = await jiraRequest<{ fields?: Record<string, unknown> }>(
    connection,
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=*all`,
    { method: "GET" },
  );
  const fields = issue.fields ?? {};

  collectUserCandidate(candidates, fields.assignee, "经办人");
  collectUserCandidate(candidates, fields.reporter, "报告人");
  collectUserCandidate(candidates, fields.creator, "创建人");

  const comments = isRecord(fields.comment) && Array.isArray(fields.comment.comments) ? fields.comment.comments : [];
  for (const comment of comments) {
    if (!isRecord(comment)) continue;
    collectUserCandidate(candidates, comment.author, "评论作者");
    collectUserCandidate(candidates, comment.updateAuthor, "评论更新人");
  }

  try {
    const watchers = await jiraRequest<{ watchers?: JiraUser[] }>(
      connection,
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/watchers`,
      { method: "GET" },
    );
    for (const watcher of watchers.watchers ?? []) collectUserCandidate(candidates, watcher, "关注人");
  } catch {
    // 部分 Jira 项目隐藏关注人，其它参与人仍可用
  }

  collectUsersDeep(candidates, fields, "工单字段");

  return [...candidates.values()].sort((a, b) => {
    const aInactive = a.active === false ? 1 : 0;
    const bInactive = b.active === false ? 1 : 0;
    if (aInactive !== bInactive) return aInactive - bInactive;
    return a.displayName.localeCompare(b.displayName, "zh-CN");
  });
}

export async function transitionIssue(connection: JiraConnection, issueKey: string, transitionId: string): Promise<void> {
  await jiraRequest(connection, `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: "POST",
    body: { transition: { id: transitionId } },
  });
}

/** 指派经办人：bosch（Jira Cloud）用 accountId，默认实例用 name */
export async function assignIssue(connection: JiraConnection, issueKey: string, targetUser: string): Promise<void> {
  await jiraRequest(connection, `/rest/api/2/issue/${encodeURIComponent(issueKey)}/assignee`, {
    method: "PUT",
    body: connection.provider === "bosch" ? { accountId: targetUser } : { name: targetUser },
  });
}
