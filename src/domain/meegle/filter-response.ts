import { z } from "zod";
import type { FilterAudit } from "@/domain/entities";

const item = z.object({ projectKey: z.string().min(1), projectName: z.string().default(""), workItemTypeKey: z.string().min(1),
  workItemId: z.number().int().positive(), workItemName: z.string(), stateName: z.string().default(""), rawData: z.record(z.string(), z.unknown()).default({}) });
const audit = z.object({ id: z.string().min(1), runId: z.string().min(1), trigger: z.enum(["all", "rule_group"]),
  projectKey: z.string(), projectName: z.string().optional(), workItemTypeKey: z.string(), workItemId: z.number().int().nonnegative(),
  workItemName: z.string(), stateName: z.string().optional(), matchedRuleGroupId: z.string().optional(), matchedRuleGroupName: z.string().optional(),
  decision: z.enum(["assigned", "unassigned", "skipped_manual_assignment", "failed"]), reason: z.string(),
  model: z.string().default("MQL"), carModel: z.string().default(""), project: z.string().default(""), platform: z.string().default(""),
  createdAt: z.coerce.date(), targetRuleGroupId: z.string().optional(),
});
const response = z.object({ runId: z.string().min(1), filterResults: z.record(z.string(), z.array(item)),
  audits: z.array(audit), successfulRuleGroupIds: z.array(z.string().min(1)) });

export function parseMeegleFilterResponse(value: unknown) {
  const parsed = response.safeParse(value);
  if (!parsed.success) throw new Error("飞书筛票响应格式无效，缺少完整的结果或成功规则组列表");
  return { ...parsed.data, audits: parsed.data.audits.map((row): FilterAudit => ({ ...row, source: "meegle", ticketKey: String(row.workItemId) })) };
}
