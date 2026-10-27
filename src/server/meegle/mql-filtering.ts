export interface MeegleMqlRuleGroup {
  id: string;
  name: string;
  sortOrder: number;
  meegleMql?: string;
}

export interface MeegleWorkItemIdentity {
  projectKey: string;
  workItemTypeKey: string;
  workItemId: number;
}

export interface MeegleMqlQueryResult {
  ruleGroupId: string;
  items?: unknown[];
  error?: unknown;
}

export interface MeegleFilteredItem {
  projectKey: string;
  projectName: string;
  workItemTypeKey: string;
  workItemId: number;
  workItemName: string;
  stateName: string;
  rawData: Record<string, unknown>;
}

export interface MeegleMqlAssignment extends MeegleWorkItemIdentity {
  id: string;
  workItemName: string;
  projectName: string;
  stateName: string;
  ruleGroupId: string;
  assignmentSource: "auto";
  lastFilterRunId: string;
  status: "pending";
  assignedAt: Date;
}

export interface MeegleMqlAudit extends MeegleWorkItemIdentity {
  id: string;
  runId: string;
  trigger: "all";
  projectName: string;
  workItemName: string;
  stateName: string;
  model: string;
  carModel: string;
  project: string;
  platform: string;
  decision: "assigned" | "unassigned" | "skipped_manual_assignment" | "failed";
  matchedRuleGroupId?: string;
  matchedRuleGroupName?: string;
  reason: string;
  createdAt: Date;
}

export interface ResolveMeegleMqlFilteringInput {
  ruleGroups: MeegleMqlRuleGroup[];
  queryResults: MeegleMqlQueryResult[];
  manualAssignmentIdentities: Iterable<MeegleWorkItemIdentity | string>;
  runId: string;
  createdAt: Date | string;
  targetRuleGroupId?: string;
}

export interface ResolveMeegleMqlFilteringResult {
  assignments: MeegleMqlAssignment[];
  audits: MeegleMqlAudit[];
}

function compareRuleGroupPriority(left: MeegleMqlRuleGroup, right: MeegleMqlRuleGroup): number {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}

/**
 * A single-rule-group run must query its configured higher-priority peers before
 * assigning a work item. Lower-priority groups cannot affect the target result.
 */
export function selectMeegleMqlFilterExecutionScope(
  ruleGroups: MeegleMqlRuleGroup[],
  targetRuleGroupId?: string,
): MeegleMqlRuleGroup[] {
  const configuredGroups = ruleGroups.filter((group) => group.meegleMql?.trim()).sort(compareRuleGroupPriority);
  if (!targetRuleGroupId) return configuredGroups;
  const target = configuredGroups.find((group) => group.id === targetRuleGroupId);
  if (!target) return [];
  return configuredGroups.filter((group) => compareRuleGroupPriority(group, target) <= 0);
}

/**
 * A targeted run depends on every higher-priority MQL comparator. If one of
 * them fails, its target result cannot safely be reconciled against existing
 * assignments, even when the target MQL itself returned items.
 */
export function successfulMeegleMqlFilterRuleGroupIds(
  queryResults: MeegleMqlQueryResult[],
  targetRuleGroupId?: string,
): string[] {
  if (targetRuleGroupId && queryResults.some((result) => result.error !== undefined)) return [];
  return queryResults
    .filter((result) => Array.isArray(result.items) && (!targetRuleGroupId || result.ruleGroupId === targetRuleGroupId))
    .map((result) => result.ruleGroupId);
}

interface NormalizedWorkItem extends MeegleWorkItemIdentity {
  projectName: string;
  workItemName: string;
  stateName: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function firstString(...values: unknown[]): string {
  return values.find((value) => typeof value === "string") as string | undefined ?? "";
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

export function meegleMqlIdentityKey(identity: MeegleWorkItemIdentity): string {
  return JSON.stringify([identity.projectKey, identity.workItemTypeKey, identity.workItemId]);
}

export function normalizeMeegleMqlWorkItem(value: unknown): NormalizedWorkItem | undefined {
  const item = asRecord(value);
  const info = asRecord(item.work_item_info ?? item.workItemInfo ?? item.work_item ?? item.workItem);
  const project = asRecord(item.project);
  const state = asRecord(item.state_info ?? item.stateInfo ?? item.state);
  const workItemId = firstNumber(info.work_item_id, info.workItemId, info.id, item.work_item_id, item.workItemId, item.id);
  const projectKey = firstString(item.project_key, item.projectKey, project.project_key, project.projectKey, project.key).trim();
  const workItemTypeKey = firstString(info.work_item_type_key, info.workItemTypeKey, info.type_key, info.typeKey, item.work_item_type_key, item.workItemTypeKey).trim();
  if (!projectKey || !workItemTypeKey || workItemId === undefined || !Number.isSafeInteger(workItemId) || workItemId <= 0) return undefined;

  return {
    projectKey,
    projectName: firstString(item.project_name, item.projectName, project.project_name, project.projectName, project.name),
    workItemTypeKey,
    workItemId,
    workItemName: firstString(info.work_item_name, info.workItemName, info.name, item.work_item_name, item.workItemName, item.name),
    stateName: firstString(state.start_state_key_name, state.startStateKeyName, state.name, item.state_name, item.stateName, item.status),
  };
}

export function normalizeMeegleFilterResults(input: {
  projectKey: string;
  queryResults: MeegleMqlQueryResult[];
}): Record<string, MeegleFilteredItem[]> {
  const filterResults = new Map<string, MeegleFilteredItem[]>();

  for (const result of input.queryResults) {
    if (result.error !== undefined || !Array.isArray(result.items)) continue;
    const items: MeegleFilteredItem[] = [];
    const seenIdentities = new Set<string>();

    for (const rawItem of result.items) {
      const rawData = asRecord(rawItem);
      const normalized = normalizeMeegleMqlWorkItem({
        ...rawData,
        project_key: firstString(rawData.project_key, rawData.projectKey, input.projectKey),
      });
      if (!normalized) continue;
      const identityKey = meegleMqlIdentityKey(normalized);
      if (seenIdentities.has(identityKey)) continue;
      seenIdentities.add(identityKey);
      items.push({ ...normalized, rawData: { ...rawData } });
    }

    filterResults.set(result.ruleGroupId, items);
  }

  return Object.fromEntries(filterResults);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "unknown";
}

function manualIdentityKeys(input: ResolveMeegleMqlFilteringInput["manualAssignmentIdentities"]): Set<string> {
  const keys = new Set<string>();
  for (const identity of input) {
    const normalized = typeof identity === "string"
      ? parseManualIdentityTuple(identity)
      : normalizeManualIdentity(identity);
    if (normalized) keys.add(meegleMqlIdentityKey(normalized));
  }
  return keys;
}

function normalizeManualIdentity(value: MeegleWorkItemIdentity): MeegleWorkItemIdentity | undefined {
  const projectKey = typeof value.projectKey === "string" ? value.projectKey.trim() : "";
  const workItemTypeKey = typeof value.workItemTypeKey === "string" ? value.workItemTypeKey.trim() : "";
  if (!projectKey || !workItemTypeKey || !Number.isSafeInteger(value.workItemId) || value.workItemId <= 0) return undefined;
  return { projectKey, workItemTypeKey, workItemId: value.workItemId };
}

function parseManualIdentityTuple(value: string): MeegleWorkItemIdentity | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 3) return undefined;
    const [projectKey, workItemTypeKey, workItemId] = parsed;
    if (typeof projectKey !== "string" || typeof workItemTypeKey !== "string" || typeof workItemId !== "number") return undefined;
    return normalizeManualIdentity({ projectKey, workItemTypeKey, workItemId });
  } catch {
    return undefined;
  }
}

export function resolveMeegleMqlFiltering(input: ResolveMeegleMqlFilteringInput): ResolveMeegleMqlFilteringResult {
  const createdAt = input.createdAt instanceof Date ? input.createdAt : new Date(input.createdAt);
  const groups = input.ruleGroups.filter((group) => group.meegleMql?.trim()).sort(compareRuleGroupPriority);
  const results = new Map(input.queryResults.map((result) => [result.ruleGroupId, result]));
  const manualKeys = manualIdentityKeys(input.manualAssignmentIdentities);
  const assignedKeys = new Set<string>();
  const assignments: MeegleMqlAssignment[] = [];
  const audits: MeegleMqlAudit[] = [];
  let sequence = 0;
  const auditId = (ruleGroupId: string, suffix: string) => `${input.runId}:${ruleGroupId}:${suffix}:${sequence++}`;

  const targetGroup = input.targetRuleGroupId ? groups.find((group) => group.id === input.targetRuleGroupId) : undefined;
  if (targetGroup) {
    const targetResult = results.get(targetGroup.id);
    if (targetResult?.error !== undefined) {
      audits.push({
        id: auditId(targetGroup.id, "failed"), runId: input.runId, trigger: "all", projectKey: "", projectName: "",
        workItemTypeKey: "", workItemId: 0, workItemName: "MQL 查询", stateName: "", model: "MQL",
        carModel: "", project: "", platform: "", decision: "failed", matchedRuleGroupId: targetGroup.id,
        matchedRuleGroupName: targetGroup.name, reason: `MQL 查询失败: ${errorMessage(targetResult.error)}`, createdAt,
      });
      return { assignments, audits };
    }

    const higherPriorityGroups = groups.filter((group) => compareRuleGroupPriority(group, targetGroup) < 0);
    const failedComparator = higherPriorityGroups.find((group) => results.get(group.id)?.error !== undefined);
    const higherPriorityKeys = new Set<string>();
    for (const group of higherPriorityGroups) {
      for (const rawItem of results.get(group.id)?.items ?? []) {
        const item = normalizeMeegleMqlWorkItem(rawItem);
        if (item) higherPriorityKeys.add(meegleMqlIdentityKey(item));
      }
    }

    for (const rawItem of targetResult?.items ?? []) {
      const item = normalizeMeegleMqlWorkItem(rawItem);
      if (!item) {
        audits.push({
          id: auditId(targetGroup.id, "invalid"), runId: input.runId, trigger: "all", projectKey: "", projectName: "",
          workItemTypeKey: "", workItemId: 0, workItemName: "MQL 工作项", stateName: "", model: "MQL",
          carModel: "", project: "", platform: "", decision: "failed", matchedRuleGroupId: targetGroup.id,
          matchedRuleGroupName: targetGroup.name, reason: "无效 MQL 工作项：缺少有效 projectKey、workItemTypeKey 或 workItemId", createdAt,
        });
        continue;
      }
      const key = meegleMqlIdentityKey(item);
      const base = {
        runId: input.runId, trigger: "all" as const, ...item, model: "MQL", carModel: "", project: "", platform: "",
        matchedRuleGroupId: targetGroup.id, matchedRuleGroupName: targetGroup.name, createdAt,
      };
      if (manualKeys.has(key)) {
        audits.push({ ...base, id: auditId(targetGroup.id, key), decision: "skipped_manual_assignment", reason: "保留人工分配" });
      } else if (failedComparator) {
        audits.push({ ...base, id: auditId(targetGroup.id, key), decision: "failed", reason: `优先级比较失败：更高优先级规则组「${failedComparator.name}」MQL 查询失败` });
      } else if (higherPriorityKeys.has(key)) {
        audits.push({ ...base, id: auditId(targetGroup.id, key), decision: "unassigned", reason: "优先级冲突：该工作项已由更高优先级规则组命中" });
      } else {
        assignments.push({
          id: `${input.runId}:${targetGroup.id}:${key}`, ...item, ruleGroupId: targetGroup.id, assignmentSource: "auto",
          lastFilterRunId: input.runId, status: "pending", assignedAt: createdAt,
        });
        audits.push({ ...base, id: auditId(targetGroup.id, key), decision: "assigned", reason: "MQL 查询命中" });
      }
    }
    return { assignments, audits };
  }

  for (const group of groups) {
    const result = results.get(group.id);
    if (result?.error !== undefined) {
      audits.push({
        id: auditId(group.id, "failed"), runId: input.runId, trigger: "all", projectKey: "", projectName: "",
        workItemTypeKey: "", workItemId: 0, workItemName: "MQL 查询", stateName: "", model: "MQL",
        carModel: "", project: "", platform: "", decision: "failed", matchedRuleGroupId: group.id,
        matchedRuleGroupName: group.name, reason: `MQL 查询失败: ${errorMessage(result.error)}`, createdAt,
      });
      continue;
    }

    for (const rawItem of result?.items ?? []) {
      const item = normalizeMeegleMqlWorkItem(rawItem);
      if (!item) {
        audits.push({
          id: auditId(group.id, "invalid"), runId: input.runId, trigger: "all", projectKey: "", projectName: "",
          workItemTypeKey: "", workItemId: 0, workItemName: "MQL 工作项", stateName: "", model: "MQL",
          carModel: "", project: "", platform: "", decision: "failed", matchedRuleGroupId: group.id,
          matchedRuleGroupName: group.name, reason: "无效 MQL 工作项：缺少有效 projectKey、workItemTypeKey 或 workItemId", createdAt,
        });
        continue;
      }
      const key = meegleMqlIdentityKey(item);
      const base = {
        runId: input.runId, trigger: "all" as const, ...item, model: "MQL", carModel: "", project: "", platform: "",
        matchedRuleGroupId: group.id, matchedRuleGroupName: group.name, createdAt,
      };
      if (manualKeys.has(key)) {
        audits.push({ ...base, id: auditId(group.id, key), decision: "skipped_manual_assignment", reason: "保留人工分配" });
        continue;
      }
      if (assignedKeys.has(key)) {
        audits.push({ ...base, id: auditId(group.id, key), decision: "unassigned", reason: "优先级冲突：该工作项已由更高优先级规则组命中" });
        continue;
      }
      assignedKeys.add(key);
      assignments.push({
        id: `${input.runId}:${group.id}:${key}`, ...item, ruleGroupId: group.id, assignmentSource: "auto",
        lastFilterRunId: input.runId, status: "pending", assignedAt: createdAt,
      });
      audits.push({ ...base, id: auditId(group.id, key), decision: "assigned", reason: "MQL 查询命中" });
    }
  }
  return { assignments, audits };
}
