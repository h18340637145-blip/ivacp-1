import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { processIssue } = vi.hoisted(() => ({ processIssue: vi.fn() }));
vi.mock("@/server/pipeline/process/orchestrator", () => ({ processIssue }));
import { POST } from "@/app/api/issues/process/route";
const context = { params: Promise.resolve({}) };
const validBody = { issueKey: "meegle-123", summary: "测试", rawData: { projectKey: "project", workItemTypeKey: "issue", workItemId: "123" }, prompts: {}, ruleGroupId: "group", source: "meegle", runId: "task-id" };
function request(body: unknown) { return new NextRequest("http://localhost/api/issues/process", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }); }
describe("process compatibility API", () => {
 beforeEach(() => processIssue.mockReset());
 it("rejects malformed identities before starting the pipeline", async () => {
  const response = await POST(request({ ...validBody, issueKey: "meegle-999" }), context);
  expect(response.status).toBe(400); expect(await response.json()).toHaveProperty("error"); expect(processIssue).not.toHaveBeenCalled();
 });
 it("preserves run receipt fields without binding Meegle runs to the HTTP connection", async () => {
  processIssue.mockResolvedValue({ replyText: "结论", artifactRef: "signed-run", analysisReceipt: "receipt", tokenUsage: 12 });
  const incoming = request(validBody); const response = await POST(incoming, context);
  expect(await response.json()).toMatchObject({ artifactRef: "signed-run", analysisReceipt: "receipt", tokenUsage: 12 });
  expect(processIssue).toHaveBeenCalledWith(expect.objectContaining({ runId: "task-id", source: "meegle" }), undefined);
 });
 it("passes HTTP cancellation through for Jira", async () => {
  processIssue.mockResolvedValue({ replyText: "结论" });
  const incoming = request({ ...validBody, source: "jira", issueKey: "ABC-1" });
  await POST(incoming, context);
  expect(processIssue).toHaveBeenCalledWith(expect.objectContaining({ source: "jira" }), incoming.signal);
 });
});
