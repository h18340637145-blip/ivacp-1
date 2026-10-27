import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import type { Assignment, ProcessResult, TicketSnapshot } from "@/domain/entities";
import { db } from "@/shared/db/database";
import { loadTicketDetail } from "@/features/tickets/services/detail";
beforeEach(async () => { await db.open(); await Promise.all(db.tables.map((table) => table.clear())); });
it("旧assignmentId链接精确定位同票号的项目和原结果组，不跨项目选择", async () => {
  const snapshot: TicketSnapshot = { id: "s1", source: "meegle", ticketKey: "99", ruleGroupId: "old-group", origin: "process", assignmentId: "a1", projectKey: "p1", workItemTypeKey: "issue", workItemId: 99, title: "旧组分析", rawData: {}, createdAt: new Date() };
  await db.snapshots.bulkPut([snapshot, { ...snapshot, id: "s2", assignmentId: "a2", ruleGroupId: "another", projectKey: "p2", title: "另一个项目" }]);
  await db.processTasks.put({ id: "t1", source: "meegle", ticketKey: "99", ruleGroupId: "old-group", snapshotId: "s1", assignmentId: "a1", status: "completed", createdAt: new Date() });
  await db.processResults.put({ id: "r1", source: "meegle", ticketKey: "99", ruleGroupId: "old-group", snapshotId: "s1", processTaskId: "t1", assignmentId: "a1", replyText: "精确结果", createdAt: new Date() } as ProcessResult);
  await db.assignments.put({ id: "a1", source: "meegle", ticketKey: "99", workItemId: 99, projectKey: "p1", workItemTypeKey: "issue", ruleGroupId: "new-group", latestResultId: "r1", status: "pending", assignedAt: new Date() } as Assignment);
  const value = await loadTicketDetail({ source: "meegle", ticketKey: "99", assignmentId: "a1" });
  expect(value.context?.result?.id).toBe("r1");
  expect(value.context?.snapshot.projectKey).toBe("p1");
  expect(value.context?.snapshot.ruleGroupId).toBe("old-group");
  expect((await loadTicketDetail({ source: "meegle", ticketKey: "99" })).candidates).toHaveLength(2);
});
