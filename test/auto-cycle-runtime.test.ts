import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { db } from "@/shared/db/database";
import { emptyPrompts } from "@/domain/rule-groups/form";
import type { RuleGroup, TicketSnapshot } from "@/domain/entities";
import { runDueAutoCycles } from "@/features/workflow/auto-cycle-service";
const handlers = vi.hoisted(() => ({ filter: vi.fn(), load: vi.fn(), process: vi.fn() }));
vi.mock("@/features/workflow/filter-service", () => ({ runGroupFilter: handlers.filter, loadRuleGroupFilters: handlers.load }));
vi.mock("@/features/tickets/services/process", () => ({ processTicket: handlers.process }));
const group: RuleGroup = { id: "g1", name: "自动组", jql: "project = TEST", expand: "", sortOrder: 0, base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: {}, prompts: emptyPrompts(), createdAt: new Date(), updatedAt: new Date() };
const jira = { id: "s1", source: "jira", ticketKey: "TEST-1", ruleGroupId: "g1" } as TicketSnapshot;
const summary = { jira: { configured: true, status: "completed", issueCount: 1 }, meegle: { configured: true, status: "failed", issueCount: 1 } };
beforeEach(async () => {
  await db.open(); await Promise.all(db.tables.map((table) => table.clear()));
  await db.ruleGroups.put(group);
  await db.autoCycles.put({ ruleGroupId: "g1", isActive: true, intervalMinutes: 5, nextRunAt: new Date(0) });
  handlers.filter.mockReset().mockResolvedValue(summary);
  handlers.load.mockReset().mockResolvedValue({ summary, snapshots: { jira: [jira], meegle: [{ ...jira, id: "ms", source: "meegle" }] } });
  handlers.process.mockReset().mockResolvedValue(undefined);
});
it("并发轮询只执行一次到期周期，只处理成功来源并在结束后重新计时", async () => {
  await Promise.all([runDueAutoCycles(), runDueAutoCycles()]);
  expect(handlers.filter).toHaveBeenCalledTimes(1);
  expect(handlers.process).toHaveBeenCalledTimes(1);
  expect(handlers.process.mock.calls[0][0].source).toBe("jira");
  const saved = await db.autoCycles.get("g1");
  expect(saved?.lastRunAt).toBeInstanceOf(Date);
  expect(+saved!.nextRunAt!).toBeGreaterThan(Date.now());
});
it("筛票期间关闭周期后不再提交分析，不能被旧周期重新开启", async () => {
  handlers.filter.mockImplementationOnce(async () => { await db.autoCycles.update("g1", { isActive: false }); return summary; });
  await runDueAutoCycles();
  expect(handlers.process).not.toHaveBeenCalled();
  expect((await db.autoCycles.get("g1"))?.isActive).toBe(false);
});
it("手动分析尚在运行时不启动新的自动周期", async () => {
  await db.processTasks.put({ id: "t1", source: "jira", ticketKey: "TEST-1", ruleGroupId: "g1", snapshotId: "s1", status: "running", createdAt: new Date() });
  await runDueAutoCycles();
  expect(handlers.filter).not.toHaveBeenCalled();
  expect(handlers.process).not.toHaveBeenCalled();
});
it("未过期租约阻止其他标签页重复执行，失败后释放租约并保留错误", async () => {
  await db.autoCycles.update("g1", { runToken: "another-tab", runningSince: new Date() });
  await runDueAutoCycles();
  expect(handlers.filter).not.toHaveBeenCalled();
  await db.autoCycles.update("g1", { runningSince: new Date(Date.now() - 3 * 60 * 60_000) });
  handlers.filter.mockRejectedValueOnce(new Error("离线"));
  await runDueAutoCycles();
  const state = await db.autoCycles.get("g1");
  expect(state?.runToken).toBeUndefined();
  expect(state?.lastError).toBe("离线");
  expect(state?.isActive).toBe(true);
});
