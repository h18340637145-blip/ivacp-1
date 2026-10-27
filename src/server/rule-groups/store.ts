import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { RuleGroup, RuleGroupPrompts } from "@/domain/entities";

type RuleGroupInput = Omit<RuleGroup, "id" | "sortOrder" | "createdAt" | "updatedAt">;

const RULE_GROUPS_FILE = path.join(process.cwd(), "data/rule-groups.json");

function emptyPrompts(): RuleGroupPrompts {
  return {
    EXTRACT_SIGNALS_SYSTEM: "",
    REQUIREMENT_EXTRACT_SYSTEM: "",
    LOG_SUMMARY_SYSTEM: "",
    ANDROID_QNX_LOG_SUMMARY_SYSTEM: "",
    CONSISTENCY_SYSTEM: "",
    COMPARE_CANTRACE: "",
  };
}

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(path.dirname(RULE_GROUPS_FILE), { recursive: true });
  try {
    await fs.access(RULE_GROUPS_FILE);
  } catch {
    await fs.writeFile(RULE_GROUPS_FILE, "[]\n", "utf8");
  }
}

function normalizeRuleGroup(raw: RuleGroup): RuleGroup {
  return {
    ...raw,
    expand: raw.expand ?? "",
    base_paths: {
      json_dir: raw.base_paths?.json_dir ?? "",
      dbc_dir: raw.base_paths?.dbc_dir ?? "",
      proto_dir: raw.base_paths?.proto_dir ?? "",
    },
    model_to_files: raw.model_to_files ?? {},
    prompts: { ...emptyPrompts(), ...(raw.prompts ?? {}) },
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  };
}

function normalizeInput(input: Partial<RuleGroupInput>): RuleGroupInput {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error("规则组名称不能为空");
  }
  const jql = typeof input.jql === "string" ? input.jql.trim() : "";
  const meegleMql = typeof input.meegleMql === "string" ? input.meegleMql.trim() : "";
  // 新版允许仅配置飞书项目 MQL 的规则组（实体约定 jql 为空表示不启用 Jira 来源）
  if (!jql && !meegleMql) {
    throw new Error("JQL 不能为空");
  }

  return {
    name: input.name.trim(),
    jql,
    ...(meegleMql ? { meegleMql } : {}),
    ...(input.jiraProvider === "bosch" ? { jiraProvider: "bosch" as const } : {}),
    expand: typeof input.expand === "string" ? input.expand.trim() : "",
    base_paths: {
      json_dir: input.base_paths?.json_dir ?? "",
      dbc_dir: input.base_paths?.dbc_dir ?? "",
      proto_dir: input.base_paths?.proto_dir ?? "",
    },
    model_to_files: input.model_to_files ?? {},
    prompts: { ...emptyPrompts(), ...(input.prompts ?? {}) },
  };
}

export async function readRuleGroups(): Promise<RuleGroup[]> {
  await ensureDataFile();
  const raw = await fs.readFile(RULE_GROUPS_FILE, "utf8");
  const parsed = JSON.parse(raw) as RuleGroup[];
  return parsed.map(normalizeRuleGroup).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function writeRuleGroups(groups: RuleGroup[]): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(RULE_GROUPS_FILE, `${JSON.stringify(groups, null, 2)}\n`, "utf8");
}

export async function getRuleGroup(id: string): Promise<RuleGroup | null> {
  const groups = await readRuleGroups();
  return groups.find((group) => group.id === id) ?? null;
}

export async function createRuleGroup(input: Partial<RuleGroupInput>): Promise<RuleGroup> {
  const groups = await readRuleGroups();
  const data = normalizeInput(input);
  const maxOrder = groups.length > 0 ? Math.max(...groups.map((group) => group.sortOrder)) : -1;
  const now = new Date();
  const group: RuleGroup = {
    ...data,
    id: nanoid(),
    sortOrder: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };

  await writeRuleGroups([...groups, group]);
  return group;
}

export async function updateRuleGroup(id: string, input: Partial<RuleGroupInput>): Promise<RuleGroup | null> {
  const groups = await readRuleGroups();
  const index = groups.findIndex((group) => group.id === id);
  if (index === -1) {
    return null;
  }

  const existing = groups[index];
  const data = normalizeInput({ ...existing, ...input });
  const rest: RuleGroup = { ...existing };
  delete rest.meegleMql;
  const next: RuleGroup = {
    ...rest,
    ...data,
    updatedAt: new Date(),
  };
  groups[index] = next;
  await writeRuleGroups(groups);
  return next;
}

export async function deleteRuleGroup(id: string): Promise<boolean> {
  const groups = await readRuleGroups();
  const remaining = groups.filter((group) => group.id !== id);
  if (remaining.length === groups.length) {
    return false;
  }

  await writeRuleGroups(remaining.map((group, index) => ({ ...group, sortOrder: index, updatedAt: new Date() })));
  return true;
}

export async function reorderRuleGroups(ids: string[]): Promise<RuleGroup[]> {
  const groups = await readRuleGroups();
  const byId = new Map(groups.map((group) => [group.id, group]));

  if (ids.some((id) => !byId.has(id))) {
    throw new Error("排序列表包含不存在的规则组");
  }

  const orderedIds = [...ids, ...groups.map((group) => group.id).filter((id) => !ids.includes(id))];
  const reordered = orderedIds.map((id, index) => ({
    ...byId.get(id)!,
    sortOrder: index,
    updatedAt: new Date(),
  }));

  await writeRuleGroups(reordered);
  return reordered;
}
