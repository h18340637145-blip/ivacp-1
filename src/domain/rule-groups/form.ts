import type { ModelFileConfig, RuleGroup, RuleGroupPrompts } from "@/domain/entities";

/** 规则组 6 个提示词（顺序即表单展示顺序） */
export const RULE_GROUP_PROMPT_KEYS = [
  "EXTRACT_SIGNALS_SYSTEM",
  "REQUIREMENT_EXTRACT_SYSTEM",
  "LOG_SUMMARY_SYSTEM",
  "ANDROID_QNX_LOG_SUMMARY_SYSTEM",
  "CONSISTENCY_SYSTEM",
  "COMPARE_CANTRACE",
] as const satisfies ReadonlyArray<keyof RuleGroupPrompts>;

export type RuleGroupPromptKey = (typeof RULE_GROUP_PROMPT_KEYS)[number];

export const RULE_GROUP_PROMPT_LABEL: Record<RuleGroupPromptKey, string> = {
  EXTRACT_SIGNALS_SYSTEM: "提取信号名",
  REQUIREMENT_EXTRACT_SYSTEM: "需求提取",
  LOG_SUMMARY_SYSTEM: "日志摘要（Android）",
  ANDROID_QNX_LOG_SUMMARY_SYSTEM: "日志摘要（Android + QNX）",
  CONSISTENCY_SYSTEM: "一致性分析",
  COMPARE_CANTRACE: "CAN Trace 对比",
};

export interface ModelRow {
  rowId: string;
  modelName: string;
  /** 逗号、分号或换行分隔；缺省兼容旧表单。 */
  aliases?: string;
  json: string;
  /** 逗号分隔的 DBC 文件列表 */
  dbc: string;
  proto: string;
}

export interface RuleGroupFormValues {
  name: string;
  jql: string;
  meegleMql: string;
  expand: string;
  base_paths: RuleGroup["base_paths"];
  modelRows: ModelRow[];
  prompts: RuleGroupPrompts;
}

export type RuleGroupFormOutput = Omit<RuleGroup, "id" | "sortOrder" | "createdAt" | "updatedAt">;

export function emptyPrompts(): RuleGroupPrompts {
  return Object.fromEntries(RULE_GROUP_PROMPT_KEYS.map((key) => [key, ""])) as unknown as RuleGroupPrompts;
}

export function emptyRuleGroupForm(): RuleGroupFormValues {
  return {
    name: "",
    jql: "",
    meegleMql: "",
    expand: "",
    base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" },
    modelRows: [],
    prompts: emptyPrompts(),
  };
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

/** 规则组 → 表单值（兼容旧数据中 json 为数组、dbc 为字符串等历史格式） */
export function ruleGroupToForm(group: RuleGroup, createRowId: () => string): RuleGroupFormValues {
  const modelRows = Object.entries(group.model_to_files ?? {}).map(([modelName, config]) => ({
    rowId: createRowId(),
    modelName,
    aliases: asText(config?.aliases),
    json: asText((config as Partial<ModelFileConfig> | undefined)?.json),
    dbc: asText((config as Partial<ModelFileConfig> | undefined)?.dbc),
    proto: asText((config as Partial<ModelFileConfig> | undefined)?.proto),
  }));
  return {
    name: group.name ?? "",
    jql: group.jql ?? "",
    meegleMql: group.meegleMql ?? "",
    expand: group.expand ?? "",
    base_paths: {
      json_dir: group.base_paths?.json_dir ?? "",
      dbc_dir: group.base_paths?.dbc_dir ?? "",
      proto_dir: group.base_paths?.proto_dir ?? "",
    },
    modelRows,
    prompts: Object.fromEntries(
      RULE_GROUP_PROMPT_KEYS.map((key) => [key, group.prompts?.[key] ?? ""]),
    ) as unknown as RuleGroupPrompts,
  };
}

export function validateRuleGroupForm(values: RuleGroupFormValues): { name?: string; models?: string } {
  const errors: { name?: string; models?: string } = {};
  if (!values.name.trim()) errors.name = "请填写规则组名称";
  const names = values.modelRows.map((row) => row.modelName.trim()).filter(Boolean);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) errors.models = `车型 “${duplicate}” 重复，后者会覆盖前者`;
  return errors;
}

/** 表单值 → 规则组输入；Bosch 规则组不保存飞书 MQL 并标记 jiraProvider */
export function formToRuleGroupInput(values: RuleGroupFormValues, isBosch: boolean): RuleGroupFormOutput {
  const model_to_files: Record<string, ModelFileConfig> = {};
  for (const row of values.modelRows) {
    const modelName = row.modelName.trim();
    if (!modelName) continue;
    const aliases = [...new Set((row.aliases ?? "").split(/[,，;；\r\n]+/).map(item => item.trim()).filter(Boolean))];
    model_to_files[modelName] = {
      ...(aliases.length ? { aliases } : {}),
      json: row.json.trim(),
      dbc: row.dbc.split(",").map((item) => item.trim()).filter(Boolean),
      proto: row.proto.trim(),
    };
  }
  return {
    name: values.name.trim(),
    jql: values.jql,
    meegleMql: isBosch ? undefined : values.meegleMql.trim() || undefined,
    ...(isBosch ? { jiraProvider: "bosch" as const } : {}),
    expand: values.expand,
    base_paths: values.base_paths,
    model_to_files,
    prompts: values.prompts,
  };
}

export function filledPromptCount(prompts: Partial<RuleGroupPrompts> | undefined): number {
  return RULE_GROUP_PROMPT_KEYS.filter((key) => Boolean(prompts?.[key]?.trim())).length;
}
