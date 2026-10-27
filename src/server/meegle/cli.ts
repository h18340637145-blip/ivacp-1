import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function formatMeegleCliError(error: unknown): string {
  const fallback = "飞书 MQL 查询失败，请检查服务端日志";
  if (!error || typeof error !== "object") return fallback;
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr !== "string") return fallback;
  try {
    const response = JSON.parse(stderr) as { error?: { code?: string } } | null;
    if (response?.error?.code === "AUTH_REQUIRED") {
      return "飞书 CLI 未登录或登录已失效（AUTH_REQUIRED）。请在运行 Next.js 的同一用户和环境中执行 meegle auth login --device-code --host project.feishu.cn，完成授权后重新筛选";
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export interface MeegleComment {
  comment_id: string;
  content: string;
  created_at: string;
  creator: string;
  file_url?: string;
  file_urls?: unknown;
}

export interface MeegleUser {
  key: string;
  name: string;
  email?: string;
}

export interface MeegleUserResolutionResult {
  users: MeegleUser[];
  partialFailure: boolean;
  failures: unknown[];
}

export interface MeegleTeam {
  teamId: string;
  teamName: string;
}

export type MeegleUserBatchLookup = (userKeys: string[]) => Promise<unknown>;

export interface MeegleRoleOperateInput {
  op: "remove" | "add";
  role_key: string;
  user_keys: string[];
}

export async function runMeegleJson<T>(args: string[], timeout = 30_000): Promise<T> {
  const { stdout } = await execFileAsync("meegle", [...args, "--format", "json"], {
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

export async function runMeegle(args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await execFileAsync("meegle", args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export async function getMeegleWorkItem(projectKey: string, workItemId: string): Promise<Record<string, unknown>> {
  const data = await runMeegleJson<unknown>(buildMeegleWorkItemGetArgs(projectKey, workItemId));
  return normalizeCompleteMeegleWorkItemResponse(data);
}

export function buildMeegleWorkItemGetArgs(projectKey: string, workItemId: string): string[] {
  return [
    "workitem", "get",
    "--project-key", projectKey,
    "--work-item-id", workItemId,
    "--fields", '["_all"]',
    "--params", JSON.stringify({ page_size: 200 }),
    "--envelope",
  ];
}

export function buildMeegleWorkItemRoleUpdateArgs(
  projectKey: string,
  workItemId: string,
  roleOperate: MeegleRoleOperateInput[],
): string[] {
  return [
    "workitem", "update",
    "--project-key", projectKey,
    "--work-item-id", workItemId,
    "--role-operate", JSON.stringify(roleOperate),
  ];
}

export async function updateMeegleWorkItemRole(
  projectKey: string,
  workItemId: string,
  roleOperate: MeegleRoleOperateInput[],
): Promise<unknown> {
  return runMeegleJson<unknown>(buildMeegleWorkItemRoleUpdateArgs(projectKey, workItemId, roleOperate));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function hasIncompletePagination(value: unknown): boolean {
  const root = asRecord(value);
  if (!root) return false;
  const metadata = [
    root,
    asRecord(root.meta),
    asRecord(root.data),
    asRecord(root.pagination),
    asRecord(root.page_info),
    asRecord(root.pageInfo),
    asRecord(asRecord(root.meta)?.pagination),
    asRecord(asRecord(root.data)?.pagination),
  ].filter((item): item is Record<string, unknown> => item !== null);
  return metadata.some((item) => item.truncated === true
    || item.incomplete === true
    || item.has_more === true
    || item.hasMore === true
    || (typeof item.next_page_token === "string" && item.next_page_token.length > 0)
    || (typeof item.nextPageToken === "string" && item.nextPageToken.length > 0)
    || (typeof item.continuation === "string" && item.continuation.length > 0)
    || (typeof item.continuation_token === "string" && item.continuation_token.length > 0)
    || (typeof item.stopped_reason === "string" && item.stopped_reason.length > 0)
    || (typeof item.stoppedReason === "string" && item.stoppedReason.length > 0));
}

function assertCompletePagination(value: unknown): void {
  if (hasIncompletePagination(value)) {
    throw new Error("Meegle CLI 自动分页结果不完整");
  }
}

export function normalizeCompleteMeegleWorkItemResponse(value: unknown): Record<string, unknown> {
  assertCompletePagination(value);
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const workItem = root && Array.isArray(root.work_item_fields) ? root
    : data && Array.isArray(data.work_item_fields) ? data
    : null;
  if (!workItem || !asRecord(workItem.work_item_attribute)) {
    throw new Error("Meegle 工作项响应格式无效");
  }
  return workItem;
}

function hasKnownMeegleUserResponseShape(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  const root = asRecord(value);
  const data = asRecord(root?.data);
  return Array.isArray(root?.data)
    || Array.isArray(root?.users)
    || Array.isArray(data?.users);
}

export function normalizeMeegleUsers(value: unknown): MeegleUser[] {
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(root?.data) ? root.data
    : Array.isArray(root?.users) ? root.users
    : Array.isArray(data?.users) ? data.users
    : [];
  return candidates.flatMap((candidate) => {
    const record = asRecord(candidate);
    if (!record) return [];
    const nested = asRecord(record.user);
    const source = nested ? { ...record, ...nested } : record;
    const key = firstString(source, ["key", "user_key", "userKey", "id"]);
    if (!key) return [];
    const name = firstString(source, ["name", "display_name", "displayName", "username"]) || key;
    const email = firstString(source, ["email", "email_address", "emailAddress"]);
    return [{ key, name, ...(email ? { email } : {}) }];
  });
}

export function chunkMeegleUserKeys(userKeys: string[]): string[][] {
  const uniqueKeys = [...new Set(userKeys.map((key) => key.trim()).filter(Boolean))];
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueKeys.length; index += 20) {
    chunks.push(uniqueKeys.slice(index, index + 20));
  }
  return chunks;
}

export function assertCompleteMeegleUserBatch(
  requestedKeys: string[],
  users: unknown,
): asserts users is MeegleUser[] {
  if (!Array.isArray(users)) throw new Error("Meegle 用户批次响应不完整");
  const requested = new Set(requestedKeys);
  const returned = new Set<string>();
  for (const candidate of users) {
    const record = asRecord(candidate);
    const key = record?.key;
    const name = record?.name;
    const email = record?.email;
    if (typeof key !== "string" || !key.trim()
      || typeof name !== "string" || !name.trim()
      || (email !== undefined && typeof email !== "string")
      || !requested.has(key)
      || returned.has(key)) {
      throw new Error("Meegle 用户批次响应不完整");
    }
    returned.add(key);
  }
  if (returned.size !== requested.size
    || requestedKeys.some((key) => !returned.has(key))) {
    throw new Error("Meegle 用户批次响应不完整");
  }
}

export function buildMeegleUserSearchArgs(batch: string[]): string[] {
  return [
    "user", "search",
    "--user-keys", batch.join(","),
    "--need-all-status",
  ];
}

async function defaultMeegleUserBatchLookup(batch: string[]): Promise<unknown> {
  return runMeegleJson<unknown>(buildMeegleUserSearchArgs(batch));
}

async function allSettledWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const [result] = await Promise.allSettled([operation(values[index])]);
      results[index] = result;
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    () => worker(),
  ));
  return results;
}

export async function resolveMeegleUsersWithStatus(
  userKeys: string[],
  lookup: MeegleUserBatchLookup = defaultMeegleUserBatchLookup,
): Promise<MeegleUserResolutionResult> {
  const batches = chunkMeegleUserKeys(userKeys);
  if (batches.length === 0) return { users: [], partialFailure: false, failures: [] };
  const results = await allSettledWithConcurrency(batches, 4, lookup);
  const usersByKey = new Map<string, MeegleUser>();
  const failures: unknown[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      failures.push(result.reason);
      continue;
    }
    try {
      if (!hasKnownMeegleUserResponseShape(result.value)) {
        throw new Error("Meegle 用户响应格式无效");
      }
      const users = normalizeMeegleUsers(result.value);
      assertCompleteMeegleUserBatch(batches[index], users);
      for (const user of users) usersByKey.set(user.key, user);
    } catch (error) {
      failures.push(error);
    }
  }
  return {
    users: [...usersByKey.values()],
    partialFailure: failures.length > 0,
    failures,
  };
}

export async function resolveMeegleUsers(userKeys: string[]): Promise<MeegleUser[]> {
  const result = await resolveMeegleUsersWithStatus(userKeys);
  if (result.partialFailure) {
    throw new AggregateError(result.failures, "Meegle 用户信息仅部分解析成功");
  }
  return result.users;
}

export function normalizeCompleteMeegleTeamsResponse(value: unknown): MeegleTeam[] {
  assertCompletePagination(value);
  const root = asRecord(value);
  if (!root || !Array.isArray(root.data)) {
    throw new Error("Meegle 团队响应格式无效");
  }
  return root.data.map((candidate) => {
    const record = asRecord(candidate);
    const teamId = record ? firstString(record, ["team_id"]) : "";
    const teamName = record ? firstString(record, ["team_name"]) : "";
    if (!teamId || !teamName) throw new Error("Meegle 团队响应格式无效");
    return { teamId, teamName };
  });
}

export async function listMeegleTeams(projectKey: string): Promise<MeegleTeam[]> {
  const response = await runMeegleJson<unknown>([
    "team", "list",
    "--project-key", projectKey,
    "--auto-paginate",
    "--envelope",
  ]);
  return normalizeCompleteMeegleTeamsResponse(response);
}

export function normalizeCompleteMeegleTeamMembersResponse(value: unknown): string[] {
  assertCompletePagination(value);
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const members = Array.isArray(root?.members) ? root.members
    : Array.isArray(data?.members) ? data.members
    : null;
  if (!members || members.some((member) => typeof member !== "string" || !member.trim())) {
    throw new Error("Meegle 团队成员响应格式无效");
  }
  return members.map((member) => member.trim());
}

export async function listMeegleTeamMembers(projectKey: string, teamId: string): Promise<string[]> {
  const response = await runMeegleJson<unknown>([
    "team", "list-members",
    "--project-key", projectKey,
    "--team-id", teamId,
    "--auto-paginate",
    "--envelope",
  ]);
  return normalizeCompleteMeegleTeamMembersResponse(response);
}

export async function listMeegleComments(projectKey: string, workItemId: string): Promise<MeegleComment[]> {
  const data = await runMeegleJson<unknown>([
    "comment", "list",
    "--project-key", projectKey,
    "--work-item-id", workItemId,
    "--auto-paginate",
    "--envelope",
  ]);
  return normalizeCompleteMeegleCommentsResponse(data);
}

export function normalizeCompleteMeegleCommentsResponse(value: unknown): MeegleComment[] {
  assertCompletePagination(value);
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const hasKnownShape = Array.isArray(value)
    || Array.isArray(root?.comments)
    || Array.isArray(root?.data)
    || Array.isArray(data?.comments);
  if (!hasKnownShape) throw new Error("Meegle 评论响应格式无效");
  return normalizeMeegleComments(value);
}

export function normalizeMeegleComments(value: unknown): MeegleComment[] {
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(root?.comments) ? root.comments
    : Array.isArray(root?.data) ? root.data
    : Array.isArray(data?.comments) ? data.comments
    : [];
  return candidates.flatMap((candidate, index) => {
    const record = asRecord(candidate);
    if (!record) return [];
    const creatorRecord = asRecord(record.creator);
    const creator = typeof record.creator === "string"
      ? record.creator
      : creatorRecord ? firstString(creatorRecord, ["user_key", "userKey", "key", "id"])
      : firstString(record, ["creator_key", "creatorKey"]);
    const commentId = firstString(record, ["comment_id", "commentId", "id"])
      || `comment-${index + 1}`;
    const content = firstString(record, ["content", "body"]);
    const createdAt = firstString(record, ["created_at", "createdAt"]);
    const fileUrl = record.file_url ?? record.fileUrl;
    const fileUrls = record.file_urls ?? record.fileUrls;
    return [{
      comment_id: commentId,
      content,
      created_at: createdAt,
      creator,
      ...(typeof fileUrl === "string" ? { file_url: fileUrl }
        : fileUrl !== undefined && fileUrl !== null ? { file_urls: fileUrl }
        : {}),
      ...(fileUrls !== undefined && fileUrls !== null
        ? { file_urls: fileUrl !== undefined && fileUrl !== null && typeof fileUrl !== "string"
          ? [fileUrl, fileUrls]
          : fileUrls }
        : {}),
    }];
  });
}
