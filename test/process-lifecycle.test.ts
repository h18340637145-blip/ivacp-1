import { configurationFixture } from "./helpers/configuration-fixture";
import { versionVhalFixture, versionVhalVsFixture } from "./helpers/version-vhal-fixture";
import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { RuleGroup, TicketSnapshot } from "@/domain/entities";
import { emptyPrompts } from "@/domain/rule-groups/form";
import { db } from "@/shared/db/database";
import { processTicket, recoverPendingProcesses } from "@/features/tickets/services/process";
import { aiReviewResult } from "@/features/tickets/services/review";
import { beginProcessAttempt, finishProcessAttempt } from "@/features/tickets/services/process-repository";

vi.mock("@/features/tickets/services/process-result-notify", () => ({ notifyFeishuProcessResultSafely: vi.fn(async () => undefined) }));
const group: RuleGroup = { id: "g1", name: "测试组", sortOrder: 0, jql: "project = TEST", expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: {}, prompts: emptyPrompts(), createdAt: new Date(), updatedAt: new Date() };
const snapshot: TicketSnapshot = { id: "s1", source: "jira", ticketKey: "TEST-1", ruleGroupId: "g1", origin: "filter", title: "实车测试", rawData: { description: "描述" }, createdAt: new Date() };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(async () => { await db.open(); await Promise.all(db.tables.map((table) => table.clear())); await db.ruleGroups.put(group); await db.snapshots.put(snapshot); });
afterEach(() => vi.unstubAllGlobals());

describe("统一分析生命周期", () => {
  it.each([versionVhalFixture, versionVhalVsFixture])("persists checks in IndexedDB and retains them when archiving a rerun: %s", async makeCheck => {
    const attempt = await beginProcessAttempt(snapshot, group, false);
    const check = makeCheck();
    const result = await finishProcessAttempt(attempt.task, {replyText:"检查结论",issueKey:"TEST-1",model:"test",versionVhalCheck:check,configurationResolution:configurationFixture()});
    db.close(); await db.open();
    expect((await db.processResults.get(result!.id))?.versionVhalCheck).toEqual(check);
    expect((await db.processResults.get(result!.id))?.configurationResolution).toEqual(configurationFixture());
    await beginProcessAttempt(snapshot,group,true);
    expect((await db.analysisHistories.toArray())[0].versionVhalCheck).toEqual(check);
    expect((await db.analysisHistories.toArray())[0].configurationResolution).toEqual(configurationFixture());
  });
  it("新运行完成后旧 Jira 响应不能成为最新结果", async () => {
    const old = await beginProcessAttempt(snapshot, group, false);
    await db.processTasks.update(old.task.id, { createdAt: new Date(Date.now() - 3 * 3600_000) });
    const newer = await beginProcessAttempt(snapshot, group, true);
    await finishProcessAttempt(newer.task, { replyText: "新结果", issueKey: "TEST-1", model: "qwen" });
    expect(await finishProcessAttempt(old.task, { replyText: "迟到的旧结果", issueKey: "TEST-1", model: "qwen" })).toBeUndefined();
    expect((await db.processResults.toArray()).map((row) => row.replyText)).toEqual(["新结果"]);
  });

  it("归属迁移后旧运行保留结果，但不能改写新归属状态", async () => {
    const input: TicketSnapshot = { ...snapshot, source: "meegle", ticketKey: "99", projectKey: "p", workItemTypeKey: "issue", workItemId: 99 };
    await db.assignments.put({ id: "a1", source: "meegle", ticketKey: "99", workItemId: 99, projectKey: "p", projectName: "P", workItemTypeKey: "issue", workItemName: "测试", stateName: "Open", ruleGroupId: "g1", assignmentSource: "auto", status: "pending", assignedAt: new Date() });
    const attempt = await beginProcessAttempt(input, group, false);
    await db.assignments.update("a1", { ruleGroupId: "g2", status: "pending" });
    await finishProcessAttempt(attempt.task, { replyText: "旧组完成的分析", issueKey: "meegle-99", model: "qwen", artifactRef: "ref", analysisReceipt: "receipt" });
    expect((await db.processResults.toArray())[0].ruleGroupId).toBe("g1");
    expect(await db.assignments.get("a1")).toMatchObject({ ruleGroupId: "g2", status: "pending" });
    expect((await db.assignments.get("a1"))?.latestResultId).toBeUndefined();
  });
  it("成功响应原子保存任务、结果和快照关联，重复点击不创建重复运行", async () => {
    const fetchMock = vi.fn(async (url: string) => url === "/api/issues/process" ? response({ replyText: "分析结论：通过", model: "qwen", tokenUsage: 123 }) : response({}));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([processTicket(snapshot, group), processTicket(snapshot, group)]);
    const [task] = await db.processTasks.toArray();
    const [result] = await db.processResults.toArray();
    expect(await db.processTasks.count()).toBe(1);
    expect(task).toMatchObject({ status: "completed", source: "jira", ticketKey: "TEST-1" });
    expect(result).toMatchObject({ processTaskId: task.id, snapshotId: task.snapshotId, source: "jira", tokenUsage: 123, reviewStatus: "pending", commentStatus: "not_started" });
    expect((await db.snapshots.get(task.snapshotId))?.rawData.description).toBe("描述");
  });

  it("重新分析失败保留原结果并归档历史，不把旧结论当作新成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/issues/process" ? response({ replyText: "旧结论" }) : response({})));
    await processTicket(snapshot, group);
    const [old] = await db.processResults.toArray();
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "模型不可用" }, 500)));
    await processTicket(snapshot, group, { reanalyze: true });
    expect(await db.processResults.count()).toBe(1);
    expect((await db.processResults.get(old.id))?.replyText).toBe("旧结论");
    expect((await db.analysisHistories.toArray())[0]).toMatchObject({ sourceResultId: old.id, replyText: "旧结论" });
    expect((await db.processTasks.toArray()).some((row) => row.status === "failed")).toBe(true);
  });

  it("飞书直接调用共享分析入口；失败重试不经 HTTP 回环；AI 复核仅建议", async () => {
    const meegle: TicketSnapshot = { ...snapshot, id: "ms1", source: "meegle", ticketKey: "99", projectKey: "p", workItemId: 99, workItemTypeKey: "issue" };
    await db.snapshots.put(meegle);
    await db.assignments.put({ id: "a1", source: "meegle", ticketKey: "99", workItemId: 99, projectKey: "p", projectName: "P", workItemTypeKey: "issue", workItemName: "实车测试", stateName: "Open", ruleGroupId: "g1", assignmentSource: "auto", status: "pending", assignedAt: new Date() });
    const fetchMock = vi.fn<typeof fetch>(async (url) => url === "/api/meegle/context" ? response({ rawData: { description: "上下文" } }) : url === "/api/issues/review" ? response({ verdict: "PASS", reason: "AI 建议通过" }) : response({ replyText: "飞书结论", artifactRef: "artifact", analysisReceipt: "receipt" }));
    vi.stubGlobal("fetch", fetchMock);
    await processTicket(meegle, group);
    const [result] = await db.processResults.toArray();
    const [task] = await db.processTasks.toArray();
    const assignment = await db.assignments.get("a1");
    expect(assignment).toMatchObject({ latestResultId: result.id, latestAttemptTaskId: task.id, status: "completed" });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/meegle/analyze")).toBe(false);
    const reviewed = await aiReviewResult({ result, issueSummary: "实车测试" });
    const reviewPayload = JSON.parse(fetchMock.mock.calls.find(([url]) => url === "/api/issues/review")?.[1]?.body as string);
    expect(reviewPayload).toMatchObject({ issueKey: "meegle-99", artifactRef: "artifact" });
    expect(reviewed.aiReviewVerdict).toBe("pass");
    expect(reviewed.reviewStatus).toBe("pending");
    expect(reviewed.manualReviewedAt).toBeUndefined();
  });

  it("刷新恢复只检查原 run，未满2小时且无产物时保持运行", async () => {
    const ms = { ...snapshot, id: "ms", source: "meegle" as const, ticketKey: "99", projectKey: "p", workItemId: 99, workItemTypeKey: "issue", assignmentId: "a1" };
    await db.snapshots.put(ms);
    await db.assignments.put({ id: "a1", source: "meegle", ticketKey: "99", workItemId: 99, projectKey: "p", projectName: "P", workItemTypeKey: "issue", workItemName: "测试", stateName: "Open", ruleGroupId: "g1", assignmentSource: "auto", status: "processing", latestAttemptTaskId: "immutable-run", assignedAt: new Date() });
    await db.processTasks.put({ id: "immutable-run", source: "meegle", ticketKey: "99", ruleGroupId: "g1", snapshotId: ms.id, assignmentId: "a1", status: "running", createdAt: new Date() });
    const fetchMock = vi.fn(async () => response({ recoverable: false }));
    vi.stubGlobal("fetch", fetchMock);
    await recoverPendingProcesses();
    expect((await db.processTasks.get("immutable-run"))?.status).toBe("running");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).runId).toBe("immutable-run");
    await db.processTasks.update("immutable-run", { createdAt: new Date(Date.now() - 3 * 3600_000) });
    await recoverPendingProcesses();
    expect((await db.processTasks.get("immutable-run"))?.status).toBe("failed");
    expect((await db.assignments.get("a1"))?.status).toBe("failed");
  });
});

it("自动周期关闭时，处理队列跳过尚未开始的工单，已启动任务正常完成", async () => {
  let enabled = true;
  let started = 0;
  let release!: () => void;
  let reached!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const firstThree = new Promise<void>(resolve => { reached = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/issues/process") {
      started++;
      if (started === 3) reached();
      await barrier;
      return response({ replyText: "结论" });
    }
    return response({});
  }));
  const tasks = Array.from({ length: 6 }, (_, index) => processTicket({ ...snapshot, id: `q${index}`, ticketKey: `TEST-Q${index}` }, group, { shouldStart: async () => enabled }));
  await firstThree;
  enabled = false;
  release();
  await Promise.all(tasks);
  expect(started).toBe(3);
  expect(await db.processTasks.count()).toBe(3);
  expect((await db.processTasks.toArray()).every(task => task.status === "completed")).toBe(true);
});

it("同一规则组更换Jira站点后，同名票号的任务、归档和迟到响应独立", async () => {
  const defaultInput = { ...snapshot, jiraProvider: "default" as const };
  const old = await beginProcessAttempt(defaultInput, group, false);
  const boschGroup = { ...group, jiraProvider: "bosch" as const };
  await db.ruleGroups.put(boschGroup);
  const bosch = await beginProcessAttempt({ ...snapshot, jiraProvider: "bosch" }, boschGroup, false);
  expect(bosch.started).toBe(true); expect(bosch.task.id).not.toBe(old.task.id);
  await finishProcessAttempt(bosch.task, { issueKey: snapshot.ticketKey, replyText: "Bosch结论", model: "test" });
  await finishProcessAttempt(old.task, { issueKey: snapshot.ticketKey, replyText: "默认站点结论", model: "test" });
  expect(await db.processResults.count()).toBe(2);
  expect(await db.analysisHistories.count()).toBe(0);
});

it("保存服务端确认的运行ID用于Jira复核，旧结果不会编造日志运行身份", async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/issues/process") { const body = JSON.parse(init!.body as string); return response({ issueKey: "TEST-1", replyText: "结论", model: "test", analysisRunId: body.runId, analysisGroupName: "分析时规则组" }); }
    if (url === "/api/issues/review") return response({ verdict: "PASS", reason: "证据已核对" });
    return response({});
  });
  vi.stubGlobal("fetch", fetchMock);
  const task = await processTicket(snapshot, group);
  const [result] = await db.processResults.toArray();
  expect(result.analysisRunId).toBe(task?.id);
  await aiReviewResult({ result, issueSummary: snapshot.title, ruleGroupName: "改名后规则组" });
  const review = fetchMock.mock.calls.filter(([url]) => url === "/api/issues/review");
  expect(JSON.parse(review[0][1]!.body as string)).toMatchObject({ runId: task?.id, ruleGroupName: "分析时规则组" });
  await aiReviewResult({ result: { ...result, analysisRunId: undefined }, issueSummary: snapshot.title });
  const requests = fetchMock.mock.calls.filter(([url]) => url === "/api/issues/review");
  expect(JSON.parse(requests[1][1]!.body as string)).not.toHaveProperty("runId");
});

it("分析响应运行ID不匹配时不能保存为成功结果", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async url => url === "/api/issues/process" ? response({ issueKey: "TEST-1", replyText: "不匹配结论", model: "test", analysisRunId: "other-run" }) : response({})));
  const task = await processTicket(snapshot, group);
  expect(task?.status).toBe("failed"); expect(task?.error).toContain("运行身份");
  expect(await db.processResults.count()).toBe(0);
});
