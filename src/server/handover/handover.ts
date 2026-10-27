import { runMeegleJson } from "@/server/meegle/cli";
import { getJiraConnection } from "@/server/jira/connection";
import { isOk, jiraHttpRequest } from "@/server/jira/http";
import {
  findJiraHandoverAt, findMeegleHandoverAt, handoverUserNames, meegleAssigneeRoleKey,
} from "@/domain/analysis/handover";

const MAX_OP_RECORD_PAGES = 10;

interface OpRecordsResponse {
  op_records?: Array<Record<string, unknown>>;
  has_more?: boolean;
  start_from?: string;
}

const userNameCache = new Map<string, string>();

function assigneeUserKeys(records: Array<Record<string, unknown>>, roleKey: string): string[] {
  const keys = new Set<string>();
  for (const record of records) {
    if (record.op_record_module !== "role_and_user_mod") continue;
    const contents = (record.record_contents as Array<{ object?: { object_value?: string }; new?: unknown[] }> | undefined) ?? [];
    for (const content of contents) {
      const objectKey = content.object?.object_value ?? "";
      if (objectKey !== roleKey && !objectKey.endsWith(`_${roleKey}`)) continue;
      for (const userKey of content.new ?? []) keys.add(String(userKey));
    }
  }
  return [...keys];
}

/** 通过 user search 把变更记录里出现过的 user_key 解析成姓名，再按配置的姓名匹配 */
async function matchUserKeysByName(userKeys: string[], names: string[]): Promise<string[]> {
  const unknown = userKeys.filter((key) => !userNameCache.has(key));
  for (let index = 0; index < unknown.length; index += 20) {
    const batch = unknown.slice(index, index + 20);
    const users = await runMeegleJson<Array<{ user_key?: string; name_cn?: string; name_en?: string }>>([
      "user", "search", "--user-keys", batch.join(","), "--need-all-status",
    ]);
    for (const user of users) {
      if (user.user_key) userNameCache.set(user.user_key, `${user.name_cn ?? ""} ${user.name_en ?? ""}`.toLowerCase());
    }
  }
  const targets = names.map((name) => name.toLowerCase());
  return userKeys.filter((key) => targets.some((name) => userNameCache.get(key)?.includes(name)));
}

/** 读取飞书经办人最近一次改为目标人员的时间；任何失败都只记录日志并返回 undefined，不影响处理结果 */
export async function fetchMeegleHandoverAt(projectKey: string, workItemId: string): Promise<Date | undefined> {
  try {
    const names = handoverUserNames();
    if (!names.length) return undefined;
    const records: Array<Record<string, unknown>> = [];
    let startFrom = "";
    for (let page = 0; page < MAX_OP_RECORD_PAGES; page++) {
      const data = await runMeegleJson<OpRecordsResponse>([
        "workitem", "list-op-records",
        "--project-key", projectKey,
        "--work-item-id", workItemId,
        "--op-record-module", "role_and_user_mod",
        ...(startFrom ? ["--start-from", startFrom] : []),
      ]);
      records.push(...(data.op_records ?? []));
      if (!data.has_more || !data.start_from) break;
      startFrom = data.start_from;
    }
    const roleKey = meegleAssigneeRoleKey();
    const candidateKeys = assigneeUserKeys(records, roleKey);
    const targetUserKeys = await matchUserKeysByName(candidateKeys, names);
    const at = findMeegleHandoverAt(records, targetUserKeys, roleKey);
    return at === undefined ? undefined : new Date(at);
  } catch (error) {
    console.warn(`[Handover] 飞书操作记录读取失败 ${workItemId}: ${String(error).slice(0, 200)}`);
    return undefined;
  }
}

async function getJson<T>(url: string, basicAuth: string): Promise<T> {
  const { statusCode, text } = await jiraHttpRequest(url, {
    method: "GET",
    headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json" },
    timeoutMs: 30_000,
    timeoutMessage: "timeout",
  });
  if (!isOk(statusCode)) throw new Error(`HTTP ${statusCode}`);
  return JSON.parse(text) as T;
}

/** 读取 Jira 经办人最近一次改为目标人员的时间；任何失败都返回 undefined */
export async function fetchJiraHandoverAt(issueKey: string, provider?: unknown): Promise<Date | undefined> {
  try {
    const connection = getJiraConnection(provider);
    const names = handoverUserNames();
    if (connection.missing.length || !names.length) return undefined;
    const data = await getJson<{ changelog?: { histories?: Array<{ created?: string; items?: Array<{ field?: string; to?: string | null; toString?: string | null }> }> } }>(
      `${connection.server}/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=assignee&expand=changelog`,
      connection.basicAuth,
    );
    const at = findJiraHandoverAt(data.changelog?.histories ?? [], names);
    return at === undefined ? undefined : new Date(at);
  } catch (error) {
    console.warn(`[Handover] Jira 变更记录读取失败 ${issueKey}: ${String(error).slice(0, 200)}`);
    return undefined;
  }
}
