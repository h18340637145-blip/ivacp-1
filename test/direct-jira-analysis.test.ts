import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db } from "@/shared/db/database";
import type { RuleGroup } from "@/domain/entities";
import { emptyPrompts } from "@/domain/rule-groups/form";
import { runDirectJiraAnalysis } from "@/features/direct-analysis/service";
vi.mock("@/features/tickets/services/process-result-notify", () => ({ notifyFeishuProcessResultSafely: vi.fn(async () => undefined) }));
const group = (id: string, model = "D01", bosch = false): RuleGroup => ({ id, name: id, sortOrder: Number(id.slice(1)) || 0, jql: "project = OTHER", jiraProvider: bosch ? "bosch" : undefined, expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: { [model]: { json: "sample.json", dbc: ["sample.dbc"], proto: "sample.proto" } }, prompts: emptyPrompts(), createdAt: new Date(), updatedAt: new Date() });
const issue = { key: "TEST-1", summary: "【D01】实车信号问题", status: "Open", description: "完整上下文", comments: [], attachments: [] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(async () => { await db.open(); await Promise.all(db.tables.map(table => table.clear())); await db.ruleGroups.bulkPut([group("g1"), group("g2", "D01_8255"), group("g3", "D01", true), group("g4", "T10")]); });
afterEach(() => vi.unstubAllGlobals());
it("非法票号拒绝请求；准确核对返回票号，不取搜索结果首票", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => json({ issues: [{ ...issue, key: "OTHER-2" }], total: 1 })); vi.stubGlobal("fetch", fetchMock);
  await expect(runDirectJiraAnalysis("TEST-1 OR project = OTHER", "default")).rejects.toThrow("票号"); expect(fetchMock).not.toHaveBeenCalled();
  await expect(runDirectJiraAnalysis(" test-1 ", "default")).rejects.toThrow("TEST-1");
  expect(await db.snapshots.count()).toBe(0);
});
it("全部匹配同站点规则组，直接分析不改写已有筛票和当前列表", async () => {
  const payloads: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/jira/filter") { expect(JSON.parse(init!.body as string)).toMatchObject({ jql: "issue = TEST-1" }); return json({ issues: [issue], total: 1 }); }
    if (url === "/api/issues/process") { payloads.push(JSON.parse(init!.body as string)); return json({ issueKey: "TEST-1", replyText: "分析结论：通过", model: "test" }); }
    return json({});
  }));
  await db.filterRuns.put({ id: "batch", source: "jira", ruleGroupId: "g1", status: "completed", query: "project = OTHER", createdAt: new Date(), completedAt: new Date(), issueCount: 8 });
  const report = await runDirectJiraAnalysis("test-1", "default");
  expect(report.model).toBe("D01"); expect(report.rows.map(row => row.groupId)).toEqual(["g1", "g2"]);
  expect(report.rows.every(row => row.status === "completed")).toBe(true);
  expect(payloads).toHaveLength(2); expect(payloads.every(body => (body.rawData as Record<string, unknown>).description === "完整上下文")).toBe(true);
  expect(await db.filterRuns.count()).toBe(1); expect((await db.filterRuns.get("batch"))?.issueCount).toBe(8);
  expect((await db.snapshots.toArray()).every(row => row.origin === "process" && !row.filterRunId && row.jiraProvider === "default")).toBe(true);
});
it("Bosch查询和处理均沿用所选站点，失败来源不尝试另一个站点", async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(init!.body as string);
    if (url === "/api/jira/filter") { expect(body.provider).toBe("bosch"); return json({ issues: [issue] }); }
    if (url === "/api/issues/process") { expect(body.jiraProvider).toBe("bosch"); return json({ issueKey: "TEST-1", replyText: "Bosch结论", model: "test" }); }
    return json({});
  }); vi.stubGlobal("fetch", fetchMock);
  const report = await runDirectJiraAnalysis("TEST-1", "bosch"); expect(report.rows.map(row => row.groupId)).toEqual(["g3"]);
  expect((await db.snapshots.toArray())[0].jiraProvider).toBe("bosch");
  fetchMock.mockImplementation(async () => json({ error: "Bosch无权限" }, 403));
  await expect(runDirectJiraAnalysis("TEST-2", "bosch")).rejects.toThrow("Bosch无权限");
});
it("缺车型/无匹配/查询已取消都不创建分析任务", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => json({ issues: [{ ...issue, summary: "无车型标题" }] })));
  await expect(runDirectJiraAnalysis("TEST-1", "default")).rejects.toThrow("车型");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => json({ issues: [{ ...issue, summary: "[UNKNOWN]" }] })));
  await expect(runDirectJiraAnalysis("TEST-1", "default")).rejects.toThrow("规则组");
  const controller = new AbortController(); controller.abort();
  await expect(runDirectJiraAnalysis("TEST-1", "default", { signal: controller.signal })).rejects.toThrow();
  expect(await db.processTasks.count()).toBe(0);
});
it("并发重复提交复用运行，逐组失败不掩盖成功，重跑保留历史", async () => {
  let fail = true, searches = 0, analyses = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/jira/filter") { searches++; return json({ issues: [issue] }); }
    if (url === "/api/issues/process") { analyses++; const body = JSON.parse(init!.body as string); return fail && body.ruleGroupId === "g2" ? json({ error: "模型暂不可用" }, 500) : json({ issueKey: "TEST-1", replyText: "结论", model: "test" }); }
    return json({});
  }));
  const [first, second] = await Promise.all([runDirectJiraAnalysis("TEST-1", "default"), runDirectJiraAnalysis(" test-1 ", "default")]);
  expect(first).toEqual(second); expect(searches).toBe(1); expect(analyses).toBe(2);
  expect(first.rows.map(row => row.status)).toEqual(["completed", "failed"]); expect(first.rows[1].error).toContain("模型暂不可用");
  fail = false; await runDirectJiraAnalysis("TEST-1", "default");
  expect(await db.analysisHistories.count()).toBe(1); expect(await db.processResults.count()).toBe(3);
});
it("全局并发排队期间分析配置变化，不按旧提示词或文件路径提交", async () => {
  await db.ruleGroups.clear(); await db.ruleGroups.bulkPut([1, 2, 3, 4, 5].map(id => group(`g${id}`)));
  let started = 0; let ready!: () => void; let release!: () => void;
  const active = new Promise<void>(resolve => { ready = resolve; }); const barrier = new Promise<void>(resolve => { release = resolve; });
  const submitted: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/jira/filter") return json({ issues: [issue] });
    if (url === "/api/issues/process") { const body = JSON.parse(init!.body as string); submitted.push(body.ruleGroupId); if (++started === 3) ready(); await barrier; return json({ issueKey: "TEST-1", replyText: "结论", model: "test" }); }
    return json({});
  }));
  const running = runDirectJiraAnalysis("TEST-1", "default");
  await active;
  await db.ruleGroups.update("g4", { prompts: { ...emptyPrompts(), REQUIREMENT_EXTRACT_SYSTEM: "新的提示词" } });
  release(); const result = await running;
  expect(submitted).not.toContain("g4");
  expect(result.rows.find(row => row.groupId === "g4")?.status).toBe("skipped");
  expect(await db.processTasks.count()).toBe(4);
});
it("查询返回前取消，即使响应随后到达也不产生隐藏分析", async () => {
  let ready!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; }); const barrier = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, init) => { expect(init?.signal).toBe(controller.signal); ready(); await barrier; return json({ issues: [issue] }); }));
  const pending = runDirectJiraAnalysis("TEST-1", "default", { signal: controller.signal });
  await started; controller.abort(); release(); await expect(pending).rejects.toThrow("取消");
  expect(await db.processTasks.count()).toBe(0); expect(await db.snapshots.count()).toBe(0);
});
it("单票记录可重新查询最近入口，按站点/组保留最新任务，不混入批量快照", async () => {
  const { loadRecentDirectAnalyses } = await import("@/features/direct-analysis/service");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async url => url === "/api/jira/filter" ? json({ issues: [issue] }) : url === "/api/issues/process" ? json({ issueKey: "TEST-1", replyText: "结论", model: "test" }) : json({})));
  await runDirectJiraAnalysis("TEST-1", "default"); await runDirectJiraAnalysis("TEST-1", "default");
  const recent = await loadRecentDirectAnalyses();
  expect(recent).toHaveLength(2); expect(recent.every(row => row.status === "completed" && row.provider === "default")).toBe(true);
  expect(recent[0].href).toContain("provider=default");
  expect((await db.snapshots.toArray()).every(row => row.analysisTrigger === "direct")).toBe(true);
});
