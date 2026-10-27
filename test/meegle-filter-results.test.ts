import { describe, expect, it } from "vitest";
import type { FilterRun } from "@/domain/entities";
import {
  buildMeegleFilterSnapshots,
  latestCompletedFilterRun,
  latestFilterRun,
  meegleProjectKeyFromMql,
} from "@/domain/meegle/filter-results";

const older: FilterRun = {
  id: "old",
  source: "meegle",
  runId: "r1",
  ruleGroupId: "g1",
  projectKey: "p",
  query: "SELECT 1",
  status: "completed",
  issueCount: 2,
  createdAt: new Date("2026-08-11T10:00:00Z"),
};
const failed: FilterRun = { ...older, id: "failed", runId: "r2", status: "failed", issueCount: 0, createdAt: new Date("2026-08-11T11:00:00Z") };

describe("飞书筛选任务边界", () => {
  it("当前筛票边界保留最新失败任务，历史成功任务可用于过期保护", () => {
    expect(latestFilterRun([older, failed])?.id).toBe("failed");
    expect(latestCompletedFilterRun([older, failed])?.id).toBe("old");
  });

  it("0 票成功任务仍有效；创建时间相同时按 id 稳定选择", () => {
    expect(latestCompletedFilterRun([{ ...older, id: "zero", issueCount: 0 }])?.issueCount).toBe(0);
    expect(latestCompletedFilterRun([{ ...older, id: "a", issueCount: 1 }, { ...older, id: "b", issueCount: 1 }])?.id).toBe("b");
  });
});

describe("飞书筛选快照", () => {
  const item = {
    projectKey: "p",
    projectName: "项目",
    workItemTypeKey: "issue",
    workItemId: 7,
    workItemName: "A",
    stateName: "处理中",
    rawData: {},
  };

  it("同一稳定工作项身份只构建一个统一快照", () => {
    const snapshots = buildMeegleFilterSnapshots({
      taskId: "run:g1",
      ruleGroupId: "g1",
      createdAt: new Date("2026-08-11T12:00:00Z"),
      items: [item, { ...item, workItemName: "A duplicate" }],
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      source: "meegle",
      ticketKey: "7",
      workItemId: 7,
      origin: "filter",
      filterRunId: "run:g1",
      title: "A",
    });
  });

  it("0 票时返回空快照列表", () => {
    expect(buildMeegleFilterSnapshots({ taskId: "empty:g1", ruleGroupId: "g1", createdAt: new Date(), items: [] })).toEqual([]);
  });

  it("从完整 MQL 的 FROM 数据源提取项目 key，旧条件式 MQL 回退", () => {
    expect(meegleProjectKeyFromMql("SELECT `work_item_id` FROM `vehicle-project`.`issue` WHERE `status` = '处理中'")).toBe("vehicle-project");
    expect(meegleProjectKeyFromMql("WHERE `status` = '处理中'")).toBeUndefined();
  });
});
