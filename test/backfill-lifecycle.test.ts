import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProcessResult, TicketSnapshot } from "@/domain/entities";
import { db } from "@/shared/db/database";
import { backfillResult } from "@/features/tickets/services/backfill";
const result: ProcessResult = { id: "r1", source: "meegle", ticketKey: "99", ruleGroupId: "g1", processTaskId: "t1", snapshotId: "s1", replyText: "结论", reviewStatus: "pending", commentStatus: "not_started", transitionStatus: "not_selected", artifactRef: "ref", analysisReceipt: "receipt", createdAt: new Date() };
const snapshot: TicketSnapshot = { id: "s1", source: "meegle", ticketKey: "99", projectKey: "p", workItemTypeKey: "issue", workItemId: 99, ruleGroupId: "g1", origin: "process", title: "测试", rawData: {}, createdAt: new Date() };
beforeEach(async () => { await db.open(); await db.processResults.clear(); await db.processResults.put(result); });
afterEach(() => vi.unstubAllGlobals());

it("AI 建议通过仍不能回填", async () => {
  await db.processResults.update(result.id, { aiReviewVerdict: "pass" });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(backfillResult({ resultId: result.id, snapshot, body: "结论" })).rejects.toThrow(/复核/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("其他标签页已领取回填时不得再次发表评论", async () => {
  await db.processResults.put({ ...result, reviewStatus: "approved", manualReviewedAt: new Date(), commentStatus: "commenting" });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(backfillResult({ resultId: result.id, snapshot, body: "结论" })).rejects.toThrow(/正在回填/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("规则组已删除且快照没有可信 Jira 来源时阻止外部写入", async () => {
  await db.processResults.put({ ...result, source: "jira", ticketKey: "TEST-1", reviewStatus: "approved" });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(backfillResult({ resultId: result.id, snapshot: { ...snapshot, source: "jira", ticketKey: "TEST-1" }, body: "结论" })).rejects.toThrow(/来源|规则组/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("评论成功而状态流转失败，重试不能重复评论", async () => {
  await db.processResults.update(result.id, { reviewStatus: "approved", manualReviewedAt: new Date() });
  let failTransition = true;
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("authorize") ? { authorization: "signed" } : url.includes("workflow") && failTransition ? { error: "流转失败" } : { success: true, commentId: "c1" }), { status: url.includes("workflow") && failTransition ? 500 : 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const input = { resultId: result.id, snapshot, body: "结论", transition: { id: "state1", state_key: "done", state_name: "完成" } };
  await expect(backfillResult(input)).rejects.toThrow(/流转失败/);
  expect(await db.processResults.get("r1")).toMatchObject({ commentStatus: "succeeded", commentId: "c1", transitionStatus: "failed" });
  failTransition = false;
  await backfillResult(input);
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/meegle/comment")).toHaveLength(1);
  expect(await db.processResults.get("r1")).toMatchObject({ commentStatus: "succeeded", transitionStatus: "succeeded" });
});
