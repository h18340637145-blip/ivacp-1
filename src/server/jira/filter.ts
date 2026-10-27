import { HttpError } from "@/server/http/route";
import type { JiraIssue } from "@/server/jira/types";
import { getJiraConnection } from "@/server/jira/connection";
import { isOk, jiraHttpRequest, type JiraHttpResponse } from "@/server/jira/http";

/** Jira 搜索接口返回的原始工单 */
interface JiraSearchIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string; name?: string };
    reporter?: { displayName?: string; name?: string };
    created?: string;
    updated?: string;
    issuetype?: { name?: string };
    labels?: string[];
    description?: string;
    comment?: { comments?: Array<{ author?: { displayName?: string; name?: string }; body?: string; created?: string }> };
    attachment?: Array<{
      id?: string;
      filename?: string;
      created?: string;
      size?: number;
      mimeType?: string;
      content?: string;
      author?: { displayName?: string; name?: string };
    }>;
  };
}

const SEARCH_FIELDS = [
  "summary",
  "status",
  "priority",
  "assignee",
  "reporter",
  "created",
  "updated",
  "issuetype",
  "labels",
  "attachment",
  "description",
  "comment",
];

const MAX_TOKEN_PAGES = 20;

function post(url: string, headers: Record<string, string>, body: string): Promise<JiraHttpResponse> {
  return jiraHttpRequest(url, { method: "POST", headers, body, timeoutMs: 20_000, timeoutMessage: "Jira 请求超时（20s）" });
}

export function normalizeJiraIssue(raw: JiraSearchIssue): JiraIssue {
  return {
    key: raw.key,
    summary: raw.fields.summary ?? "",
    status: raw.fields.status?.name ?? "Unknown",
    priority: raw.fields.priority?.name ?? "—",
    assignee: raw.fields.assignee?.displayName ?? raw.fields.assignee?.name ?? "未分配",
    reporter: raw.fields.reporter?.displayName ?? raw.fields.reporter?.name ?? "—",
    created: raw.fields.created ?? "",
    updated: raw.fields.updated ?? "",
    issueType: raw.fields.issuetype?.name ?? "—",
    labels: raw.fields.labels ?? [],
    attachmentCount: raw.fields.attachment?.length ?? 0,
    attachments: (raw.fields.attachment ?? []).map((att) => ({
      id: att.id ?? "",
      filename: att.filename ?? "",
      created: att.created ?? "",
      size: att.size ?? 0,
      mimeType: att.mimeType ?? "",
      contentUrl: att.content ?? "",
      authorName: att.author?.name ?? att.author?.displayName ?? "",
    })),
    description: raw.fields.description ?? "",
    comments: (raw.fields.comment?.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? c.author?.name ?? "—",
      body: c.body ?? "",
      created: c.created ?? "",
    })),
  };
}

/**
 * 按 JQL 搜索 Jira 工单。
 * - 默认实例：/rest/api/2/search，单页 100 条（offset 分页，仅取第一页）。
 * - bosch（Jira Cloud）：/rest/api/2/search/jql，nextPageToken 翻页，最多 20 页。
 */
export async function searchJiraIssues(jql: string, provider?: unknown): Promise<{ issues: JiraIssue[]; total: number }> {
  const connection = getJiraConnection(provider);
  if (connection.missing.length > 0) {
    throw new HttpError(500, `Jira 环境变量未配置（${connection.missing.join(" / ")}）`);
  }

  const searchUrl = `${connection.server}${connection.searchPath}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${connection.basicAuth}`,
    Accept: "application/json",
  };

  let statusCode = 0;
  let text = "";
  const tokenIssues: JiraSearchIssue[] = [];
  try {
    if (connection.searchMode === "token") {
      let nextPageToken: string | undefined;
      for (let page = 0; page < MAX_TOKEN_PAGES; page++) {
        ({ statusCode, text } = await post(
          searchUrl,
          headers,
          JSON.stringify({ jql, maxResults: 100, fields: SEARCH_FIELDS, ...(nextPageToken ? { nextPageToken } : {}) }),
        ));
        if (!isOk(statusCode)) break;
        const pageData = JSON.parse(text) as { issues?: JiraSearchIssue[]; nextPageToken?: string };
        tokenIssues.push(...(pageData.issues ?? []));
        nextPageToken = pageData.nextPageToken;
        if (!nextPageToken) break;
      }
    } else {
      ({ statusCode, text } = await post(searchUrl, headers, JSON.stringify({ jql, maxResults: 100, startAt: 0, fields: SEARCH_FIELDS })));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpError(502, `连接 Jira 服务器失败：${msg}`);
  }

  if (!isOk(statusCode)) {
    throw new HttpError(statusCode || 502, `Jira 返回 ${statusCode}：${text.slice(0, 400)}`);
  }

  const data = (connection.searchMode === "token"
    ? { total: tokenIssues.length, issues: tokenIssues }
    : JSON.parse(text)) as { total: number; issues: JiraSearchIssue[] };

  const issues = (data.issues ?? []).map(normalizeJiraIssue);
  return { issues, total: data.total ?? issues.length };
}
