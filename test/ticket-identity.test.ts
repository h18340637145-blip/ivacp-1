import { expect, it } from "vitest";
import type { TicketSnapshot } from "@/domain/entities";
import { sameTicketIdentity } from "@/domain/issue-source/ticket-identity";
const row = { source: "meegle", ticketKey: "99", projectKey: "p", workItemTypeKey: "issue" } as TicketSnapshot;
it("同号工单不能跨项目、类型或 Jira 站点关联状态", () => {
  expect(sameTicketIdentity(row, row)).toBe(true);
  expect(sameTicketIdentity({ ...row, projectKey: "q" }, row)).toBe(false);
  expect(sameTicketIdentity({ ...row, workItemTypeKey: "story" }, row)).toBe(false);
  expect(sameTicketIdentity({ ...row, source: "jira", jiraProvider: "bosch" }, { ...row, source: "jira", jiraProvider: "default" })).toBe(false);
});
