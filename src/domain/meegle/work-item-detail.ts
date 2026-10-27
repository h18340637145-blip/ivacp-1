export interface MeegleWorkItemIdentity {
  projectKey: string;
  workItemTypeKey: "issue";
  workItemId: string;
}

export interface MeegleWorkItemField {
  key: string;
  name: string;
  value: unknown;
  [key: string]: unknown;
}

export interface MeegleRoleMember {
  key: string;
  name: string;
}

export interface MeegleAssigneeRole {
  key: string;
  name: string;
  members: MeegleRoleMember[];
}

export interface MeegleCommentAttachment {
  url: string;
  name: string;
  kind: "image" | "file";
}

export interface MeegleWorkItemComment {
  id: string;
  authorKey: string;
  authorName: string;
  createdAt: string;
  body: string;
  attachments: MeegleCommentAttachment[];
}

export interface MeegleWorkItemDetail {
  identity: MeegleWorkItemIdentity;
  updatedAt: string;
  attributes: Record<string, unknown>;
  fields: MeegleWorkItemField[];
  descriptionFields: MeegleWorkItemField[];
  assigneeRole: MeegleAssigneeRole | null;
  comments: MeegleWorkItemComment[];
}

export interface MeegleResolvedUser {
  key: string;
  name: string;
  email?: string;
}

export interface RawMeegleComment {
  comment_id?: unknown;
  id?: unknown;
  creator?: unknown;
  creator_key?: unknown;
  created_at?: unknown;
  content?: unknown;
  body?: unknown;
  file_url?: unknown;
  file_urls?: unknown;
}

interface NormalizeMeegleWorkItemDetailInput {
  identity: MeegleWorkItemIdentity;
  workItem: Record<string, unknown>;
  comments?: RawMeegleComment[];
  users?: MeegleResolvedUser[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

function normalizeField(value: unknown): MeegleWorkItemField | null {
  const field = asRecord(value);
  if (!field) return null;
  const key = firstString(field, ["key", "field_key", "fieldKey"]);
  const name = firstString(field, ["name", "field_name", "fieldName"]) || key;
  if (!key && !name) return null;
  return { ...field, key, name, value: field.value };
}

function normalizeMember(value: unknown): MeegleRoleMember | null {
  const member = asRecord(value);
  if (!member) return null;
  const key = firstString(member, ["key", "user_key", "userKey", "id"]);
  if (!key) return null;
  return {
    key,
    name: firstString(member, ["name", "display_name", "displayName", "username"]) || key,
  };
}

function normalizeRole(value: unknown): MeegleAssigneeRole | null {
  const role = asRecord(value);
  if (!role) return null;
  const key = firstString(role, ["key", "role_key", "roleKey"]);
  const name = firstString(role, ["name", "role_name", "roleName"]);
  const members = Array.isArray(role.members)
    ? role.members.map(normalizeMember).filter((member): member is MeegleRoleMember => member !== null)
    : [];
  if (!key && !name) return null;
  return { key, name: name || key, members };
}

function findAssigneeRole(attributes: Record<string, unknown>): MeegleAssigneeRole | null {
  const roleValues = [attributes.role_members, attributes.roleMembers, attributes.roles]
    .find(Array.isArray);
  if (!Array.isArray(roleValues)) return null;
  const roles = roleValues
    .map(normalizeRole)
    .filter((role): role is MeegleAssigneeRole => role !== null);
  return roles.find((role) => /经办人|assignee/i.test(`${role.name} ${role.key}`)) ?? null;
}

function creatorKey(value: RawMeegleComment): string {
  if (typeof value.creator === "string") return value.creator;
  const creator = asRecord(value.creator);
  return firstString(creator, ["user_key", "userKey", "key", "id"])
    || (typeof value.creator_key === "string" ? value.creator_key : "");
}

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function filenameFromUrl(url: URL): string {
  const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
  if (!lastSegment) return "评论图片";
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

export function extractSafeMarkdownImageAttachments(body: string): MeegleCommentAttachment[] {
  const attachments: MeegleCommentAttachment[] = [];
  const seen = new Set<string>();
  const imagePattern = /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of body.matchAll(imagePattern)) {
    const url = safeHttpUrl(match[1]);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    attachments.push({ url: url.href, name: filenameFromUrl(url), kind: "image" });
  }
  return attachments;
}

function collectFileUrlValues(value: unknown): Array<{ url: string; name?: string }> {
  if (typeof value === "string") return [{ url: value }];
  if (Array.isArray(value)) return value.flatMap(collectFileUrlValues);
  const record = asRecord(value);
  if (!record) return [];
  const url = firstString(record, ["url", "file_url", "fileUrl", "download_url", "downloadUrl"]);
  if (!url) return [];
  const name = firstString(record, ["name", "file_name", "fileName", "filename"]);
  return [{ url, ...(name ? { name } : {}) }];
}

export function extractSafeFileAttachments(value: unknown): MeegleCommentAttachment[] {
  const attachments: MeegleCommentAttachment[] = [];
  const seen = new Set<string>();
  for (const file of collectFileUrlValues(value)) {
    const url = safeHttpUrl(file.url);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    attachments.push({ url: url.href, name: file.name || filenameFromUrl(url), kind: "file" });
  }
  return attachments;
}

function mergeAttachments(...groups: MeegleCommentAttachment[][]): MeegleCommentAttachment[] {
  const merged: MeegleCommentAttachment[] = [];
  const seen = new Set<string>();
  for (const attachment of groups.flat()) {
    if (seen.has(attachment.url)) continue;
    seen.add(attachment.url);
    merged.push(attachment);
  }
  return merged;
}

function isDescriptionField(field: MeegleWorkItemField): boolean {
  const label = `${field.key} ${field.name}`;
  const text = typeof field.value === "string" ? field.value : "";
  return /描述|description|defect|实际结果|actual[ _-]?result/i.test(label)
    || /实际结果|缺陷描述/.test(text);
}

export function normalizeMeegleWorkItemDetail(
  input: NormalizeMeegleWorkItemDetailInput,
): MeegleWorkItemDetail {
  const attributes = asRecord(input.workItem.work_item_attribute) ?? {};
  const rawFields = Array.isArray(input.workItem.work_item_fields)
    ? input.workItem.work_item_fields
    : [];
  const fields = rawFields
    .map(normalizeField)
    .filter((field): field is MeegleWorkItemField => field !== null);
  const usersByKey = new Map((input.users ?? []).map((user) => [user.key, user]));
  const comments = (input.comments ?? []).map((comment, index): MeegleWorkItemComment => {
    const authorKey = creatorKey(comment);
    const body = typeof comment.content === "string"
      ? comment.content
      : typeof comment.body === "string" ? comment.body : "";
    return {
      id: typeof comment.comment_id === "string"
        ? comment.comment_id
        : typeof comment.id === "string" ? comment.id : `comment-${index + 1}`,
      authorKey,
      authorName: usersByKey.get(authorKey)?.name || authorKey || "未知用户",
      createdAt: typeof comment.created_at === "string" ? comment.created_at : "",
      body,
      attachments: mergeAttachments(
        extractSafeMarkdownImageAttachments(body),
        extractSafeFileAttachments(comment.file_url),
        extractSafeFileAttachments(comment.file_urls),
      ),
    };
  });

  return {
    identity: input.identity,
    updatedAt: firstString(input.workItem, ["updated_at", "updatedAt", "update_time", "updateTime"]),
    attributes,
    fields,
    descriptionFields: fields.filter(isDescriptionField),
    assigneeRole: findAssigneeRole(attributes),
    comments,
  };
}

export type MeegleWorkItemDetailErrorCode =
  | "WORK_ITEM_UPSTREAM_FAILED"
  | "COMMENTS_UPSTREAM_FAILED"
  | "COMMENT_AUTHORS_PARTIAL_FAILED";

export interface MeegleWorkItemDetailErrors {
  workItem?: MeegleWorkItemDetailErrorCode;
  comments?: MeegleWorkItemDetailErrorCode;
  commentAuthors?: MeegleWorkItemDetailErrorCode;
}

export interface MeegleUserResolutionResult {
  users: MeegleResolvedUser[];
  partialFailure: boolean;
  failures?: unknown[];
}

export interface MeegleWorkItemDetailDependencies {
  getWorkItem: () => Promise<Record<string, unknown>>;
  listComments: () => Promise<RawMeegleComment[]>;
  resolveUsers: (userKeys: string[]) => Promise<MeegleUserResolutionResult>;
  logError?: (scope: string, error: unknown) => void;
}

export interface MeegleWorkItemDetailLoadResult {
  detail: MeegleWorkItemDetail | null;
  errors: MeegleWorkItemDetailErrors;
  status: 200 | 502;
}

export async function loadMeegleWorkItemDetail(
  identity: MeegleWorkItemIdentity,
  dependencies: MeegleWorkItemDetailDependencies,
): Promise<MeegleWorkItemDetailLoadResult> {
  const errors: MeegleWorkItemDetailErrors = {};
  const [workItemResult, commentsResult] = await Promise.allSettled([
    dependencies.getWorkItem(),
    dependencies.listComments(),
  ]);

  if (commentsResult.status === "rejected") {
    errors.comments = "COMMENTS_UPSTREAM_FAILED";
    dependencies.logError?.("meegle comments", commentsResult.reason);
  }
  if (workItemResult.status === "rejected") {
    errors.workItem = "WORK_ITEM_UPSTREAM_FAILED";
    dependencies.logError?.("meegle work item", workItemResult.reason);
    return { detail: null, errors, status: 502 };
  }

  const comments = commentsResult.status === "fulfilled" ? commentsResult.value : [];
  const creatorKeys = [...new Set(comments.flatMap((comment) => {
    if (typeof comment.creator === "string") return comment.creator ? [comment.creator] : [];
    const creator = asRecord(comment.creator);
    const key = firstString(creator, ["user_key", "userKey", "key", "id"]);
    return key ? [key] : [];
  }))];
  let users: MeegleResolvedUser[] = [];
  if (creatorKeys.length > 0) {
    const [authorsResult] = await Promise.allSettled([dependencies.resolveUsers(creatorKeys)]);
    if (authorsResult.status === "fulfilled") {
      users = authorsResult.value.users;
      if (authorsResult.value.partialFailure) {
        errors.commentAuthors = "COMMENT_AUTHORS_PARTIAL_FAILED";
        for (const failure of authorsResult.value.failures ?? []) {
          dependencies.logError?.("meegle comment authors", failure);
        }
      }
    } else {
      errors.commentAuthors = "COMMENT_AUTHORS_PARTIAL_FAILED";
      dependencies.logError?.("meegle comment authors", authorsResult.reason);
    }
  }

  return {
    detail: normalizeMeegleWorkItemDetail({
      identity,
      workItem: workItemResult.value,
      comments,
      users,
    }),
    errors,
    status: 200,
  };
}
