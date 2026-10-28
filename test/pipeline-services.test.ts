import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeName } from "@/server/pipeline/paths-logging";
import { processIssue } from "@/server/pipeline/process/orchestrator";
import { createProcessContext } from "@/server/pipeline/process/context";
import { processRequestSchema } from "@/server/pipeline/process/request";
import { embedTexts } from "@/server/ai/embeddings";
import { buildProcessResultCard } from "@/server/feishu/process-result";

vi.mock("@/server/handover/handover", () => ({ fetchMeegleHandoverAt: async () => undefined }));
const groups: string[] = [];
afterEach(async () => {
 vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
 for (const group of groups.splice(0)) {
  await fs.rm(path.join(process.cwd(), "log", group), { recursive: true, force: true });
  await fs.rm(path.join(process.cwd(), "jira-issues", group), { recursive: true, force: true });
 }
});
describe("immutable Meegle runs", () => {
 it("keeps dot-only configuration names inside their assigned storage directory", () => {
  expect(sanitizeName("..")).toBe("_"); expect(sanitizeName(".")).toBe("_");
 });
 it("persists a missing-attachment run and returns signed review artifacts without calling AI", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const group = `pipeline-test-${randomUUID()}`; groups.push(group);
  const result = await processIssue({ issueKey: "meegle-123", summary: "台架测试", ruleGroupId: group, rawData: { projectKey: "p", workItemId: "123" }, prompts: {}, source: "meegle", runId: "missing-attachment-run" });
  expect(result.mode).toBe("no_attachments"); expect(result.artifactRef).toBeTruthy(); expect(result.analysisReceipt).toBeTruthy();
  expect(result.replyText).toContain("CAN");
  const metrics = JSON.parse(await fs.readFile(path.join(process.cwd(), "log", group, "unknown", "meegle-123", "missing-attachment-run", "pipeline-metrics.json"), "utf8"));
  expect(metrics.status).toBe("rejected"); expect(metrics.issueKey).toBe("meegle-123");
 });
 it("cannot overwrite artifacts when an existing run id is reused", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const group = `pipeline-test-${randomUUID()}`; groups.push(group);
  const request = { issueKey: "meegle-123", summary: "", ruleGroupId: group, rawData: { projectKey: "p", workItemId: "123" }, prompts: {}, source: "meegle" as const, runId: "run-123" };
  const first = await createProcessContext(request);
  await fs.writeFile(path.join(first.logRoot, "final_reply.md"), "原始结论");
  await expect(createProcessContext(request)).rejects.toMatchObject({ status: 409 });
  expect(await fs.readFile(path.join(first.logRoot, "final_reply.md"), "utf8")).toBe("原始结论");
  const second = await createProcessContext({ ...request, runId: "run-456" });
  expect(second.attachRoot).not.toBe(first.attachRoot);
  expect(second.artifactRef).not.toBe(first.artifactRef);
 });
 it("accepts actual error-pattern payloads and rejects conflicting Meegle identity", () => {
  const body = { issueKey: "meegle-1", summary: "", ruleGroupId: "g", rawData: { projectKey: "p", workItemId: "1" }, prompts: {}, source: "meegle", errorPatterns: [{ code: "signal_missed", label: "漏信号", count: 3, share: 1, checklist: "逐条核对", scope: "rule_group" }] };
  expect(processRequestSchema.safeParse(body).success).toBe(true);
  expect(processRequestSchema.safeParse({ ...body, issueKey: "meegle-2" }).success).toBe(false);
 });
});
describe("embeddings", () => {
 it("restores input ordering from provider indexes", async () => {
  vi.stubEnv("EMBEDING_BASE_URL", "https://embedding.invalid/v1/");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ index: 1, embedding: [2, 3] }, { index: 0, embedding: [0, 1] }] })));
  expect((await embedTexts(["a", "b"])).embeddings).toEqual([[0, 1], [2, 3]]);
 });
 it("rejects vector dimension mismatches", async () => {
  vi.stubEnv("EMBEDING_BASE_URL", "https://embedding.invalid/v1/");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ embeddings: [[1], [2, 3]] })));
  await expect(embedTexts(["a", "b"])).rejects.toMatchObject({ status: 502 });
 });
});
describe("Feishu notification cards", () => {
 it("includes source, conclusion and safe issue/chart links", () => {
  const card = buildProcessResultCard({ source: "meegle", ruleGroupName: "测试组", issueKey: "123", issueSummary: "测试", status: "success", replyText: "结论", issueUrl: "javascript:alert(1)", chartImagePath: "/api/charts/log/g/x.png", origin: "https://example.test" });
  const text = JSON.stringify(card);
  expect(text).toContain("飞书项目处理通知"); expect(text).toContain("结论");
  expect(text).toContain("https://example.test/api/charts/log/g/x.png"); expect(text).not.toContain("javascript:");
 });
});

describe("Jira run and provider storage isolation", () => {
 it("keeps logs per run and attachment caches per Jira site without losing same-site reuse", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const group = `pipeline-test-${randomUUID()}`; groups.push(group);
  const request = { source: "jira" as const, issueKey: "TEST-1", summary: "[D01]", ruleGroupId: group, rawData: {}, prompts: {}, runId: "jira-run-one" };
  const first = await createProcessContext(request);
  await fs.writeFile(path.join(first.logRoot, "final_reply.md"), "默认原结论");
  await fs.writeFile(path.join(first.attachRoot, "cached.txt"), "默认附件缓存");
  const second = await createProcessContext({ ...request, runId: "jira-run-two" });
  expect(second.logRoot).not.toBe(first.logRoot);
  expect(second.attachRoot).toBe(first.attachRoot);
  expect(await fs.readFile(path.join(second.attachRoot, "cached.txt"), "utf8")).toBe("默认附件缓存");
  const bosch = await createProcessContext({ ...request, jiraProvider: "bosch", runId: "bosch-run-one" });
  expect(bosch.logRoot).not.toBe(first.logRoot); expect(bosch.attachRoot).not.toBe(first.attachRoot);
  await expect(fs.access(path.join(bosch.attachRoot, "cached.txt"))).rejects.toThrow();
  await expect(createProcessContext(request)).rejects.toMatchObject({ status: 409 });
  expect(await fs.readFile(path.join(first.logRoot, "final_reply.md"), "utf8")).toBe("默认原结论");
 });
});
