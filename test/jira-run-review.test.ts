import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewConclusion, type ReviewRequest } from "@/server/pipeline/review/service";

const { chat } = vi.hoisted(() => ({ chat: vi.fn<(system: string, prompt: string, options: unknown) => Promise<string>>(async () => '{"verdict":"PASS","reason":"mock review"}') }));
vi.mock("@/server/ai/qwen", () => ({ chat, runQwenRequest: (fn: () => unknown) => fn() }));

describe("Jira review run evidence", () => {
 let group: string;
 let request: ReviewRequest;
 beforeEach(async () => {
  vi.stubEnv("VALIDATE_QWEN_MODEL", "mock-model");
  vi.stubEnv("VALIDATE_API_KEY", "mock-key");
  group = `jira-review-test-${randomUUID()}`;
  request = { conclusion: "待审结论", issueSummary: "测试", issueKey: "TEST-1", ruleGroupId: group };
  const issueDir = path.join(process.cwd(), "log", group, "unknown", "TEST-1");
  await fs.mkdir(issueDir, { recursive: true });
  await fs.writeFile(path.join(issueDir, "evidence-packet.json"), "旧父目录证据");
  for (const runId of ["default-run", "bosch-run"]) {
   await fs.mkdir(path.join(issueDir, runId));
   await fs.writeFile(path.join(issueDir, runId, "evidence-packet.json"), `${runId}独立证据`);
  }
 });
 afterEach(async () => {
  await fs.rm(path.join(process.cwd(), "log", group), { recursive: true, force: true });
  vi.unstubAllEnvs();
  chat.mockClear();
 });
 it.each(["default-run", "bosch-run"])("reads only the requested %s evidence", async (runId) => {
  await reviewConclusion({ ...request, runId });
  const prompt = String(chat.mock.calls[0]?.[1]);
  expect(prompt).toContain(`${runId}独立证据`);
  expect(prompt).not.toContain("旧父目录证据");
  expect(prompt).not.toContain(`${runId === "default-run" ? "bosch-run" : "default-run"}独立证据`);
 });
 it("rejects missing explicit runs without reading parent evidence or calling Qwen", async () => {
  await expect(reviewConclusion({ ...request, runId: "missing-run" })).rejects.toMatchObject({ status: 404 });
  expect(chat).not.toHaveBeenCalled();
 });
 it("keeps legacy requests without runId reading their parent evidence", async () => {
  await reviewConclusion(request);
  expect(String(chat.mock.calls[0]?.[1])).toContain("旧父目录证据");
 });
 it.each(["../default-run", "", "x".repeat(121)])("rejects invalid explicit runId %s", async (runId) => {
  await expect(reviewConclusion({ ...request, runId })).rejects.toMatchObject({ status: 400 });
  expect(chat).not.toHaveBeenCalled();
 });
});

it("uses the immutable analysis group name even when the current rule id/name has changed", async () => {
 const oldGroup = `jira-review-original-${randomUUID()}`;
 const runDir = path.join(process.cwd(), "log", oldGroup, "unknown", "TEST-2", "original-run");
 vi.stubEnv("VALIDATE_QWEN_MODEL", "mock-model"); vi.stubEnv("VALIDATE_API_KEY", "mock-key");
 try {
  await fs.mkdir(runDir, { recursive: true }); await fs.writeFile(path.join(runDir, "evidence-packet.json"), "不可变原组证据");
  await reviewConclusion({ conclusion: "结论", issueSummary: "标题", issueKey: "TEST-2", ruleGroupId: "renamed-rule-id", ruleGroupName: oldGroup, runId: "original-run" });
  expect(String(chat.mock.calls.at(-1)?.[1])).toContain("不可变原组证据");
 } finally { await fs.rm(path.join(process.cwd(), "log", oldGroup), { recursive: true, force: true }); vi.unstubAllEnvs(); chat.mockClear(); }
});
