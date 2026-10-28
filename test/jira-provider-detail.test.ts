import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db } from "@/shared/db/database";
import { emptyPrompts } from "@/domain/rule-groups/form";
import { loadTicketDetail } from "@/features/tickets/services/detail";
import { ticketHref } from "@/features/tickets/use-process-action";
beforeEach(async () => { await db.open(); await Promise.all(db.tables.map(table => table.clear())); });
it("同组同名Jira票按站点区分，链接明确provider，旧无站点链接展示上下文选择", async () => {
  await db.ruleGroups.put({ id: "g", name: "组", sortOrder: 0, jql: "", expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: {}, prompts: emptyPrompts(), createdAt: new Date(), updatedAt: new Date() });
  const base = { source: "jira" as const, ticketKey: "TEST-1", ruleGroupId: "g", origin: "process" as const, rawData: {}, createdAt: new Date() };
  await db.snapshots.bulkPut([{ ...base, id: "sd", jiraProvider: "default", title: "默认站点" }, { ...base, id: "sb", jiraProvider: "bosch", title: "Bosch站点" }]);
  expect((await loadTicketDetail({ source: "jira", ticketKey: "TEST-1", groupId: "g" })).context).toBeNull();
  const bosch = await loadTicketDetail({ source: "jira", ticketKey: "TEST-1", groupId: "g", jiraProvider: "bosch" });
  expect(bosch.context?.snapshot.title).toBe("Bosch站点");
  expect(ticketHref(bosch.context!.snapshot)).toContain("provider=bosch");
});
