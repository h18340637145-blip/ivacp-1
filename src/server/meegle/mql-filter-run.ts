import { nanoid } from "nanoid";
import { badRequest } from "@/server/http/route";
import { formatMeegleCliError, runMeegleJson } from "@/server/meegle/cli";
import { extractMeegleMqlItems } from "@/server/meegle/mql-response";
import {
  normalizeMeegleFilterResults,
  resolveMeegleMqlFiltering,
  selectMeegleMqlFilterExecutionScope,
  successfulMeegleMqlFilterRuleGroupIds,
  type MeegleFilteredItem,
  type MeegleMqlAssignment,
  type MeegleMqlAudit,
  type MeegleMqlRuleGroup,
  type MeegleWorkItemIdentity,
} from "@/server/meegle/mql-filtering";

type UnknownRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidRuleGroup(value: unknown): value is MeegleMqlRuleGroup {
  if (!isPlainRecord(value)) return false;
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && typeof value.sortOrder === "number"
    && Number.isFinite(value.sortOrder)
    && (value.meegleMql === undefined || typeof value.meegleMql === "string");
}

function isValidManualAssignment(value: unknown): value is MeegleWorkItemIdentity | string {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        && parsed.length === 3
        && isNonEmptyString(parsed[0])
        && isNonEmptyString(parsed[1])
        && typeof parsed[2] === "number"
        && Number.isSafeInteger(parsed[2])
        && parsed[2] > 0;
    } catch {
      return false;
    }
  }
  return isPlainRecord(value)
    && isNonEmptyString(value.projectKey)
    && isNonEmptyString(value.workItemTypeKey)
    && typeof value.workItemId === "number"
    && Number.isSafeInteger(value.workItemId)
    && value.workItemId > 0;
}

// Wrap bare WHERE conditions into a full MQL statement if needed
function ensureFullMql(mql: string, projectKey: string): string {
  const trimmed = mql.trim();
  if (/^\s*SELECT\s/i.test(trimmed)) return trimmed;
  const whereClause = /^\s*WHERE\s/i.test(trimmed) ? trimmed : `WHERE ${trimmed}`;
  return `SELECT \`work_item_id\`, \`name\`, \`work_item_type_key\`, \`project_key\`, \`status\` FROM \`${projectKey}\`.\`issue\` ${whereClause}`;
}

function extractWorkItemTypeFromMql(mql: string): string | undefined {
  const match = mql.match(/FROM\s+`[^`]+`\.`([^`]+)`/i);
  return match?.[1];
}

function withRequestedProjectKey(item: unknown, projectKey: string, workItemTypeKey?: string): unknown {
  const record = isPlainRecord(item) ? item : undefined;
  if (!record) return item;
  const patched: UnknownRecord = { ...record, project_key: projectKey, projectKey };
  if (workItemTypeKey && !record.work_item_type_key && !record.workItemTypeKey) {
    patched.work_item_type_key = workItemTypeKey;
    patched.workItemTypeKey = workItemTypeKey;
  }
  return patched;
}

export interface MeegleMqlFilterRunResult {
  runId: string;
  filterResults: Record<string, MeegleFilteredItem[]>;
  assignments: MeegleMqlAssignment[];
  audits: MeegleMqlAudit[];
  queriedGroups: Array<{ id: string; name: string }>;
  successfulRuleGroupIds: string[];
  total: number;
}

/**
 * 按规则组 MQL 批量（或单规则组）筛选飞书工作项，并按规则组优先级解析自动归属。
 * body 为原始请求体：逐项校验并返回与旧版一致的中文错误。
 */
export async function runMeegleMqlFilter(body: unknown): Promise<MeegleMqlFilterRunResult> {
  if (!isPlainRecord(body)) throw badRequest("请求体必须是 JSON 对象");
  const projectKey = typeof body.projectKey === "string" ? body.projectKey.trim() : "";
  const ruleGroups = body.ruleGroups;
  const hasFilterRuleGroupId = Object.hasOwn(body, "filterRuleGroupId");
  const hasManualAssignments = Object.hasOwn(body, "manualAssignments");
  const manualAssignments = body.manualAssignments;
  const rawFilterRuleGroupId = body.filterRuleGroupId;
  if (!projectKey) {
    throw badRequest("projectKey 不能为空");
  }
  if (!Array.isArray(ruleGroups) || ruleGroups.length === 0) {
    throw badRequest("ruleGroups 必须是非空数组");
  }
  if (!ruleGroups.every(isValidRuleGroup)) {
    throw badRequest("ruleGroups 包含无效规则组");
  }
  const validatedRuleGroups = ruleGroups as MeegleMqlRuleGroup[];
  const hasInvalidFilterRuleGroupId = typeof body.filterRuleGroupId !== "string";
  if (hasFilterRuleGroupId && (
    hasInvalidFilterRuleGroupId
    || typeof rawFilterRuleGroupId !== "string"
    || !rawFilterRuleGroupId.trim()
    || !validatedRuleGroups.some((group) => group.id === rawFilterRuleGroupId.trim())
  )) {
    throw badRequest("filterRuleGroupId 不存在于 ruleGroups 中");
  }
  if (hasManualAssignments && !Array.isArray(manualAssignments)) {
    throw badRequest("manualAssignments 必须是数组");
  }
  const validManualAssignments = Array.isArray(manualAssignments) ? manualAssignments : [];
  if (!validManualAssignments.every(isValidManualAssignment)) {
    throw badRequest("manualAssignments 包含无效工作项标识");
  }

  const filterRuleGroupId = hasFilterRuleGroupId && typeof rawFilterRuleGroupId === "string"
    ? rawFilterRuleGroupId.trim()
    : undefined;

  const queriedRuleGroups = selectMeegleMqlFilterExecutionScope(validatedRuleGroups, filterRuleGroupId);
  if (queriedRuleGroups.length === 0) {
    throw badRequest("没有可执行的飞书 MQL 配置，请先为规则组填写非空飞书 MQL");
  }

  const runId = nanoid();
  const createdAt = new Date();
  const queryResults = await Promise.all(queriedRuleGroups.map(async (group) => {
    try {
      const fullMql = ensureFullMql(group.meegleMql!.trim(), projectKey);
      const workItemType = extractWorkItemTypeFromMql(fullMql);
      console.log("飞书 MQL 执行", { ruleGroupId: group.id, fullMql: fullMql.slice(0, 200) });
      const response = await runMeegleJson<unknown>([
        "workitem", "query",
        "--project-key", projectKey,
        "--mql", fullMql,
      ]);
      console.log("飞书 MQL 响应", { ruleGroupId: group.id, response: JSON.stringify(response).slice(0, 500) });
      const items = extractMeegleMqlItems(response);
      if (!items) {
        console.error("飞书 MQL 响应格式无效", { ruleGroupId: group.id, rawKeys: Object.keys(response as object) });
        return { ruleGroupId: group.id, error: new Error("飞书 MQL 响应格式无效") };
      }
      console.log("飞书 MQL 提取工作项", { ruleGroupId: group.id, count: items.length, sample: items[0] ? JSON.stringify(items[0]).slice(0, 300) : "empty" });
      return {
        ruleGroupId: group.id,
        items: items.map((item) => withRequestedProjectKey(item, projectKey, workItemType)),
      };
    } catch (error) {
      console.error("飞书 MQL 查询失败", { ruleGroupId: group.id, error });
      return { ruleGroupId: group.id, error: new Error(formatMeegleCliError(error)) };
    }
  }));

  const filterResults: Record<string, MeegleFilteredItem[]> = normalizeMeegleFilterResults({
    projectKey,
    queryResults,
  });
  const resolveMqlAssignments = resolveMeegleMqlFiltering({
    ruleGroups: queriedRuleGroups,
    queryResults,
    manualAssignmentIdentities: validManualAssignments,
    runId,
    createdAt,
    targetRuleGroupId: filterRuleGroupId,
  });
  console.log("飞书 MQL 分配结果", {
    assignmentsCount: resolveMqlAssignments.assignments.length,
    auditsCount: resolveMqlAssignments.audits.length,
    decisions: resolveMqlAssignments.audits.map((a) => a.decision),
    reasons: resolveMqlAssignments.audits.slice(0, 3).map((a) => a.reason),
  });
  const total = Object.entries(filterResults)
    .filter(([ruleGroupId]) => !filterRuleGroupId || ruleGroupId === filterRuleGroupId)
    .reduce((count, [, items]) => count + items.length, 0);
  return {
    runId,
    filterResults,
    assignments: resolveMqlAssignments.assignments,
    audits: resolveMqlAssignments.audits,
    queriedGroups: queriedRuleGroups.map((group) => ({ id: group.id, name: group.name })),
    successfulRuleGroupIds: successfulMeegleMqlFilterRuleGroupIds(queryResults, filterRuleGroupId),
    total,
  };
}
