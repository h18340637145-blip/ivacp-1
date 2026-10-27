import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment, ProcessResult, RuleGroup } from "@/domain/entities";
import { emptyPrompts } from "@/domain/rule-groups/form";
import { db } from "@/shared/db/database";
import { loadRuleGroupFilters, runGroupFilter } from "@/features/workflow/filter-service";
import { commitFilterRun, startFilterRun, recoverExpiredFilters } from "@/features/workflow/filter-repository";

const group: RuleGroup = { id: "g1", name: "测试组", sortOrder: 1, jql: "project = TEST", meegleMql: "SELECT * FROM `p`.`issue`", expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: {}, prompts: emptyPrompts(), createdAt: new Date(), updatedAt: new Date() };
const assignment: Assignment = { id: "a1", source: "meegle", ticketKey: "1", workItemId: 1, projectKey: "p", projectName: "项目", workItemTypeKey: "issue", workItemName: "保留结果", stateName: "处理中", ruleGroupId: group.id, assignmentSource: "auto", status: "completed", latestResultId: "r1", assignedAt: new Date() };
const item = { projectKey: "p", projectName: "项目", workItemTypeKey: "issue", workItemId: 2, workItemName: "新工作项", stateName: "待处理", rawData: {} };
const audit = { id: "audit1", runId: "remote1", trigger: "all", ...item, model: "MQL", carModel: "", project: "", platform: "", matchedRuleGroupId: group.id, decision: "assigned", reason: "MQL 查询命中", createdAt: new Date().toISOString() };
const payload = (overrides: Record<string, unknown> = {}) => ({ runId: "remote1", filterResults: { g1: [item] }, audits: [audit], successfulRuleGroupIds: [group.id], ...overrides });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.ruleGroups.put(group);
});
afterEach(() => vi.unstubAllGlobals());

describe("双来源筛票持久化", () => {
  it("归属被其他组改变时不再显示旧组快照，原分析保留", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(payload())));
    await runGroupFilter({ ...group, jql: "" }, [group]);
    const [row] = await db.assignments.toArray();
    await db.assignments.update(row.id, { ruleGroupId: "other-group" });
    const data = await loadRuleGroupFilters(group);
    expect(data.snapshots.meegle).toEqual([]);
    expect(data.summary.meegle.issueCount).toBe(0);
    expect(await db.snapshots.count()).toBe(1);
  });

  it("过期恢复与成功提交并发时不能把新完成态覆盖成过期", async () => {
    const { run } = await startFilterRun(group, "jira");
    await db.filterRuns.update(run.id, { createdAt: new Date(Date.now() - 3600_000) });
    await Promise.all([recoverExpiredFilters(), db.filterRuns.update(run.id, { status: "completed", issueCount: 2 })]);
    expect(await db.filterRuns.get(run.id)).toMatchObject({ status: "completed", issueCount: 2 });
  });
  it("飞书失败不影响 Jira 成功，HTTP 200 失败审计不能算成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("jira")
      ? response({ issues: [{ key: "TEST-1", summary: "实车问题", status: "Open" }], total: 1 })
      : response(payload({ successfulRuleGroupIds: [], audits: [{ ...audit, decision: "failed", reason: "CLI 需要重新登录" }] }))));
    const summary = await runGroupFilter(group, [group]);
    expect(summary.jira).toMatchObject({ status: "completed", issueCount: 1 });
    expect(summary.meegle).toMatchObject({ status: "failed", issueCount: 0, error: "CLI 需要重新登录" });
    expect((await loadRuleGroupFilters(group)).snapshots.jira[0].ticketKey).toBe("TEST-1");
    expect(await db.filterAudits.count()).toBe(1);
  });

  it("成功空 MQL 解除所有未命中归属，保留完成结果、历史和失败组归属", async () => {
    await db.assignments.bulkPut([assignment, { ...assignment, id: "manual", ticketKey: "3", workItemId: 3, assignmentSource: "manual" }, { ...assignment, id: "other", ruleGroupId: "failed-group" }]);
    await db.processResults.put({ id: "r1", source: "meegle", ticketKey: "1", replyText: "历史结论" } as ProcessResult);
    vi.stubGlobal("fetch", vi.fn(async () => response(payload({ filterResults: { g1: [] }, audits: [] }))));
    const summary = await runGroupFilter({ ...group, jql: "" }, [group]);
    expect(summary.meegle).toMatchObject({ status: "completed", issueCount: 0 });
    expect((await db.assignments.get("a1"))?.ruleGroupId).toBe("");
    expect((await db.assignments.get("manual"))?.ruleGroupId).toBe("");
    expect((await db.assignments.get("other"))?.ruleGroupId).toBe("failed-group");
    expect((await db.processResults.get("r1"))?.replyText).toBe("历史结论");
  });

  it("单组筛选携带同项目优先级比较组，不调用我的待办；只展示该组归属", async () => {
    const higher = { ...group, id: "higher", sortOrder: 0 };
    const other = { ...group, id: "other", meegleMql: "SELECT * FROM `other`.`issue`" };
    const fetchMock = vi.fn(async () => response(payload()));
    vi.stubGlobal("fetch", fetchMock);
    await runGroupFilter({ ...group, jql: "" }, [group, higher, other]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/meegle/filter");
    const sent = JSON.parse(String(init.body));
    expect(sent.ruleGroups.map((row: RuleGroup) => row.id).sort()).toEqual(["g1", "higher"]);
    expect(sent.filterRuleGroupId).toBe("g1");
    expect((await db.assignments.toArray())[0]).toMatchObject({ source: "meegle", ticketKey: "2", ruleGroupId: "g1" });
    expect((await loadRuleGroupFilters(group)).snapshots.meegle).toHaveLength(1);
  });

  it("新失败运行不能回退旧成功快照，原快照和结果仍保留", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(payload())));
    const onlyMeegle = { ...group, jql: "" };
    await runGroupFilter(onlyMeegle, [group]);
    const oldCount = await db.snapshots.count();
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "网络失败" }, 500)));
    await runGroupFilter(onlyMeegle, [group]);
    const current = await loadRuleGroupFilters(onlyMeegle);
    expect(current.summary.meegle.status).toBe("failed");
    expect(current.snapshots.meegle).toEqual([]);
    expect(await db.snapshots.count()).toBe(oldCount);
  });

  it("丢弃迟到响应，不能修改新运行的归属或快照", async () => {
    const old = await startFilterRun(group, "meegle", "p");
    await db.filterRuns.update(old.run.id, { status: "expired" });
    const newer = await startFilterRun(group, "meegle", "p");
    await commitFilterRun(newer.run, [], { runId: "remote2", audits: [], successfulRuleGroupIds: [group.id] });
    const stale = await commitFilterRun(old.run, [{ id: "stale", source: "meegle", ticketKey: "2", ruleGroupId: group.id, origin: "filter", filterRunId: old.run.id, title: "过期", rawData: {}, createdAt: new Date() }]);
    expect(stale.status).toBe("expired");
    expect(await db.snapshots.count()).toBe(0);
    expect((await loadRuleGroupFilters(group)).latest.meegle?.id).toBe(newer.run.id);
  });

  it("同规则组重复点击共享运行，不重复外部请求", async () => {
    const fetchMock = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return response(payload()); });
    vi.stubGlobal("fetch", fetchMock);
    const onlyMeegle = { ...group, jql: "" };
    await Promise.all([runGroupFilter(onlyMeegle, [group]), runGroupFilter(onlyMeegle, [group])]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await db.filterRuns.count()).toBe(1);
  });

  it("响应缺失成功组列表时拒绝对账，不清理已有归属", async () => {
    await db.assignments.put(assignment);
    vi.stubGlobal("fetch", vi.fn(async () => response({ runId: "bad", filterResults: { g1: [] }, audits: [] })));
    expect((await runGroupFilter({ ...group, jql: "" }, [group])).meegle.status).toBe("failed");
    expect((await db.assignments.get("a1"))?.ruleGroupId).toBe(group.id);
  });
});
