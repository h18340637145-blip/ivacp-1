import type { RuleGroup, RuleGroupPrompts } from "@/domain/entities";

export const TEMPLATE_KIND = "rule-group-template";
export const TEMPLATE_SCHEMA_VERSION = 1;
export const MAX_TEMPLATE_BYTES = 1024 * 1024;

export type TemplateConfig = Pick<RuleGroup, "jql" | "expand" | "base_paths" | "model_to_files" | "prompts"> &
  Partial<Pick<RuleGroup, "meegleMql" | "jiraProvider">>;

export interface RuleGroupTemplate {
  kind: typeof TEMPLATE_KIND;
  schemaVersion: number;
  /** 同一模板的稳定标识；重复发布同一 key 会生成新版本 */
  templateKey: string;
  version: number;
  name: string;
  description: string;
  tags: string[];
  author: string;
  createdAt: string;
  config: TemplateConfig;
  checksum: string;
}

export interface TemplateMeta {
  templateKey: string;
  version: number;
  name: string;
  description?: string;
  tags?: string[];
  author: string;
}

const PROMPT_KEYS: Array<keyof RuleGroupPrompts> = [
  "EXTRACT_SIGNALS_SYSTEM",
  "REQUIREMENT_EXTRACT_SYSTEM",
  "LOG_SUMMARY_SYSTEM",
  "ANDROID_QNX_LOG_SUMMARY_SYSTEM",
  "CONSISTENCY_SYSTEM",
  "COMPARE_CANTRACE",
];

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a 32 位，只用于识别配置是否变化，不用于安全校验 */
export function configChecksum(config: TemplateConfig): string {
  const text = stableStringify(config);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function slugifyTemplateKey(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "template";
}

export function ruleGroupToTemplateConfig(group: RuleGroup): TemplateConfig {
  return {
    jql: group.jql,
    ...(group.meegleMql ? { meegleMql: group.meegleMql } : {}),
    ...(group.jiraProvider ? { jiraProvider: group.jiraProvider } : {}),
    expand: group.expand ?? "",
    base_paths: { ...group.base_paths },
    model_to_files: group.model_to_files ?? {},
    prompts: { ...group.prompts },
  };
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim().slice(0, 24);
    if (trimmed) seen.add(trimmed);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

export function buildTemplate(group: RuleGroup, meta: TemplateMeta, now: Date = new Date()): RuleGroupTemplate {
  const config = ruleGroupToTemplateConfig(group);
  return {
    kind: TEMPLATE_KIND,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    templateKey: meta.templateKey,
    version: meta.version,
    name: meta.name.trim(),
    description: (meta.description ?? "").trim(),
    tags: normalizeTags(meta.tags ?? []),
    author: meta.author,
    createdAt: now.toISOString(),
    config,
    checksum: configChecksum(config),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 校验并规范化外部输入（文件或接口）；失败抛出中文错误 */
export function parseTemplate(input: unknown): RuleGroupTemplate {
  if (!isRecord(input) || input.kind !== TEMPLATE_KIND) throw new Error("不是有效的规则组模板文件");
  const schemaVersion = Number(input.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > TEMPLATE_SCHEMA_VERSION) {
    throw new Error(`不支持的模板格式版本：${String(input.schemaVersion)}`);
  }
  const name = str(input.name).trim();
  if (!name) throw new Error("模板名称不能为空");
  if (name.length > 80) throw new Error("模板名称不能超过 80 个字符");
  const templateKey = str(input.templateKey).trim() || slugifyTemplateKey(name);
  if (!/^[A-Za-z0-9\u4e00-\u9fa5_-]{1,64}$/.test(templateKey)) throw new Error("模板标识只允许字母、数字、中文、下划线和连字符");
  const version = Number(input.version ?? 1);
  if (!Number.isInteger(version) || version < 1) throw new Error("模板版本必须是正整数");

  const raw = input.config;
  if (!isRecord(raw)) throw new Error("模板缺少 config");
  const jql = str(raw.jql).trim();
  const meegleMql = str(raw.meegleMql).trim();
  if (!jql && !meegleMql) throw new Error("模板必须包含 JQL 或飞书 MQL");

  const rawPrompts = isRecord(raw.prompts) ? raw.prompts : {};
  const prompts = Object.fromEntries(PROMPT_KEYS.map((key) => [key, str(rawPrompts[key])])) as unknown as RuleGroupPrompts;
  const rawPaths = isRecord(raw.base_paths) ? raw.base_paths : {};
  const config: TemplateConfig = {
    jql,
    ...(meegleMql ? { meegleMql } : {}),
    ...(raw.jiraProvider === "bosch" ? { jiraProvider: "bosch" as const } : {}),
    expand: str(raw.expand).trim(),
    base_paths: { json_dir: str(rawPaths.json_dir), dbc_dir: str(rawPaths.dbc_dir), proto_dir: str(rawPaths.proto_dir) },
    model_to_files: isRecord(raw.model_to_files) ? (raw.model_to_files as TemplateConfig["model_to_files"]) : {},
    prompts,
  };

  return {
    kind: TEMPLATE_KIND,
    schemaVersion,
    templateKey,
    version,
    name,
    description: str(input.description).trim().slice(0, 500),
    tags: normalizeTags(input.tags),
    author: str(input.author).trim() || "未知",
    createdAt: str(input.createdAt) || new Date().toISOString(),
    config,
    checksum: configChecksum(config),
  };
}

/** 模板应用为新的规则组输入；名称带版本以便与已有规则组区分 */
export function templateToRuleGroupInput(
  template: RuleGroupTemplate,
): Omit<RuleGroup, "id" | "sortOrder" | "createdAt" | "updatedAt"> {
  return {
    name: `${template.name}（模板 v${template.version}）`,
    jql: template.config.jql,
    ...(template.config.meegleMql ? { meegleMql: template.config.meegleMql } : {}),
    ...(template.config.jiraProvider ? { jiraProvider: template.config.jiraProvider } : {}),
    expand: template.config.expand,
    base_paths: { ...template.config.base_paths },
    model_to_files: template.config.model_to_files,
    prompts: { ...template.config.prompts },
  };
}

export function templateFileName(template: Pick<RuleGroupTemplate, "templateKey" | "version">): string {
  return `template-${template.templateKey}-v${template.version}.json`;
}
