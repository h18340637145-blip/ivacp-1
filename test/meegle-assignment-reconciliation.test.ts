import { describe, expect, it } from "vitest";
import type { Assignment, FilterAudit } from "@/domain/entities";
import { autoAssignmentIdsToUnassign } from "@/domain/meegle/filter-assignment-reconciliation";

const assignment = (id: string, overrides: Partial<Assignment> = {}): Assignment => {
  const workItemId = overrides.workItemId ?? 1;
  return {
    id,
    source: "meegle",
    ticketKey: String(workItemId),
    workItemId,
    workItemTypeKey: "bug",
    workItemName: id,
    projectKey: "vehicle",
    projectName: "车型项目",
    stateName: "处理中",
    ruleGroupId: "successful-group",
    assignmentSource: "auto",
    status: "pending",
    assignedAt: new Date("2026-08-10T08:00:00.000Z"),
    ...overrides,
  };
};

const audit = (workItemId: number, decision: FilterAudit["decision"] = "assigned"): FilterAudit => ({
  id: `run-2:${workItemId}`,
  source: "meegle",
  runId: "run-2",
  trigger: "all",
  projectKey: "vehicle",
  projectName: "车型项目",
  workItemTypeKey: "bug",
  workItemId,
  ticketKey: String(workItemId),
  workItemName: "仍命中的工单",
  stateName: "处理中",
  model: "MQL",
  carModel: "",
  project: "",
  platform: "",
  decision,
  matchedRuleGroupId: "successful-group",
  reason: "MQL 查询命中",
  createdAt: new Date("2026-08-10T09:00:00.000Z"),
});

describe("MQL 自动分配对账", () => {
  it("成功查询组保留本轮命中（含人工分配），清理未命中分配；失败查询组保留", () => {
    const staleIds = autoAssignmentIdsToUnassign({
      successfulRuleGroupIds: ["successful-group"],
      audits: [audit(2), audit(8, "skipped_manual_assignment")],
      assignments: [
        assignment("stale-pending"),
        assignment("stale-processing", { workItemId: 3, status: "processing" }),
        assignment("stale-failed", { workItemId: 4, status: "failed" }),
        assignment("still-assigned", { workItemId: 2 }),
        assignment("completed", { workItemId: 5, status: "completed" }),
        assignment("manual", { workItemId: 6, assignmentSource: "manual" }),
        assignment("matched-manual", { workItemId: 8, assignmentSource: "manual" }),
        assignment("failed-query-group", { workItemId: 7, ruleGroupId: "failed-group" }),
      ],
    });
    expect(staleIds.sort()).toEqual(["completed", "manual", "stale-failed", "stale-pending", "stale-processing"]);
  });
});
