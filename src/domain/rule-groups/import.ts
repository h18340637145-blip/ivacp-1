import type { RuleGroup } from "@/domain/entities";
import { z } from "zod";
import { emptyPrompts } from "./form";
import { modelFilesSchema } from "./model-files";

const text = z.string().default("");
const date = z.union([z.string(), z.number(), z.date()]).transform((value) => new Date(value))
  .refine((value) => Number.isFinite(value.getTime()), "日期无效").optional();
const schema = z.object({
  version: z.literal("1.0").optional(),
  ruleGroups: z.array(z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    jql: text, meegleMql: z.string().optional(), jiraProvider: z.literal("bosch").optional(), expand: text,
    base_paths: z.object({ json_dir: text, dbc_dir: text, proto_dir: text }).default({ json_dir: "", dbc_dir: "", proto_dir: "" }),
    model_to_files: modelFilesSchema,
    prompts: z.record(z.string(), z.string()).default({}),
    sortOrder: z.number().finite().optional(), createdAt: date, updatedAt: date,
  })),
});

/** 先校验完整文件，调用方才可开启覆盖事务。保留旧版导出与车型文件格式兼容。 */
export function parseRuleGroupImport(input: unknown): RuleGroup[] {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`规则组文件格式无效（${issue.path.join(".") || "文件结构"}）：${issue.message}`);
  }
  const ids = new Set<string>();
  const now = new Date();
  return parsed.data.ruleGroups.map((group, index) => {
    if (ids.has(group.id)) throw new Error(`规则组 ID 重复：${group.id}`);
    ids.add(group.id);
    return {
      ...group, prompts: { ...emptyPrompts(), ...group.prompts },
      sortOrder: group.sortOrder ?? index, createdAt: group.createdAt ?? now, updatedAt: group.updatedAt ?? now,
    };
  });
}
