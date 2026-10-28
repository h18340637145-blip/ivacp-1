import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import https from "node:https";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as stats from "@/server/docupedia/upload-stats";
import { archiveIssueLogToDocupedia, withDocupediaRetries } from "@/server/docupedia/client";
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
const options = { baseUrl: "https://docupedia.invalid", parentId: "parent", spaceKey: "TEST", auth: "basic", requestTimeoutMs: 1000, requestRetries: 2, retryDelayMs: 100, retryMaxDelayMs: 150 };
it("瞬时错误退避重试，永久错误报告实际尝试次数", async () => {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined); const operation = vi.fn().mockRejectedValueOnce(new Error("socket hang up")).mockRejectedValueOnce(new Error("HTTP 429")).mockResolvedValue("完成");
  expect(await withDocupediaRetries({ title: "文章", options, operation, sleep, random: () => 0 })).toBe("完成"); expect(operation).toHaveBeenCalledTimes(3); expect(sleep.mock.calls.map(call => call[0])).toEqual([80, 120]);
  const forbidden = vi.fn().mockRejectedValue(new Error("HTTP 403")); await expect(withDocupediaRetries({ title: "文章", options, operation: forbidden, sleep })).rejects.toThrow("after 1 attempt(s)"); expect(forbidden).toHaveBeenCalledTimes(1);
});
async function archiveFixture(failArticle = false, extraPage = false) {
  await fs.mkdir(path.resolve("tmp"), { recursive: true }); const directory = await fs.mkdtemp(path.resolve("tmp/docupedia-test-")); directories.push(directory); const logRoot = path.join(directory, "TEST-1"); await fs.mkdir(logRoot);
  await fs.writeFile(path.join(logRoot, "step1_a.md"), "a".repeat(260)); await fs.writeFile(path.join(logRoot, "step1_b.md"), "b".repeat(260)); await fs.writeFile(path.join(logRoot, "input_comments.txt"), "不上传"); await fs.writeFile(path.join(logRoot, "chart.png"), Buffer.from([137, 80, 78, 71, 0]));
  if (extraPage) await fs.writeFile(path.join(logRoot, "step2_next.md"), "下一文章".repeat(200));
  for (const [name, value] of Object.entries({ ENABLE_DOCUPEDIA: "1", DOCUPEDIA_AUTH: "basic", DOCUPEDIA_USERNAME: "test", DOCUPEDIA_PASSWORD: "test", DOCUPEDIA_BASE_URL: options.baseUrl, DOCUPEDIA_PARENT_ID: "parent", DOCUPEDIA_SPACE_KEY: "TEST" })) vi.stubEnv(name, value);
  const posts: Array<{ title: string; body: unknown }> = [];
  vi.spyOn(https, "request").mockImplementation(((config: { method: string; hostname: string }, callback: (response: PassThrough & { statusCode: number }) => void) => {
    expect(config.hostname).toBe("docupedia.invalid"); const request = new EventEmitter() as EventEmitter & { write: (data: string) => void; end: () => void; setTimeout: () => unknown; destroy: () => void }; let body = "";
    request.write = data => { body += data; }; request.setTimeout = () => request; request.destroy = () => undefined;
    request.end = () => queueMicrotask(() => {
      const response = new PassThrough() as PassThrough & { statusCode: number }; response.statusCode = 200; let payload: unknown = { results: [] };
      if (config.method === "POST") { const page = JSON.parse(body); posts.push(page); response.statusCode = failArticle && page.title.includes("_step1") ? 403 : 200; payload = { id: `page${posts.length}` }; }
      callback(response); response.end(JSON.stringify(payload));
    }); return request;
  }) as unknown as typeof https.request);
  return { logRoot, posts, input: { issueKey: "TEST-1", summary: "测试", ruleGroupName: "组", carModel: "车型", logRoot } };
}
it("Step文件合并后只计文章一次，目录/评论/图片不计；统计写入失败不改变成功归档", async () => {
  const { input, posts } = await archiveFixture(); const record = vi.spyOn(stats, "recordDocupediaUpload").mockRejectedValue(new Error("统计磁盘不可写")); const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  expect(await archiveIssueLogToDocupedia(input)).toMatchObject({ enabled: true, created: 2, failed: 0, skipped: 2 }); expect(posts).toHaveLength(2); expect(posts[0].title).toMatch(/^meegle_[a-f0-9]{12}$/); expect(posts[1].title).toBe(`${posts[0].title}_step1`); expect(record).toHaveBeenCalledTimes(1);
  expect(record.mock.calls[0][0]).toMatchObject({ action: "created" }); expect(record.mock.calls[0][0].text).toContain("step1_a.md"); expect(record.mock.calls[0][0].text).toContain("step1_b.md"); expect(warning).toHaveBeenCalledWith(expect.stringContaining("statistics write failed"));
});
it("文章最终失败不记上传统计；关闭功能时不发请求", async () => {
  const { input } = await archiveFixture(true); const record = vi.spyOn(stats, "recordDocupediaUpload").mockResolvedValue(null); vi.spyOn(console, "warn").mockImplementation(() => undefined);
  expect(await archiveIssueLogToDocupedia(input)).toMatchObject({ created: 1, failed: 1 }); expect(record).not.toHaveBeenCalled(); const request = vi.mocked(https.request); request.mockClear(); vi.stubEnv("ENABLE_DOCUPEDIA", "0"); expect(await archiveIssueLogToDocupedia(input)).toMatchObject({ enabled: false }); expect(request).not.toHaveBeenCalled();
});

it("Negotiate/curl瞬时错误耗尽重试后停止，抖动等待不超过上限", async () => {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined); const operation = vi.fn().mockRejectedValue(new Error("curl: (22) The requested URL returned error: 502"));
  await expect(withDocupediaRetries({ title: "文章", options, operation, sleep, random: () => 1 })).rejects.toThrow("after 3 attempt(s)");
  expect(operation).toHaveBeenCalledTimes(3); expect(sleep.mock.calls.map(call => call[0])).toEqual([120, 150]);
});
it("失败文章之后继续后续文章，并保留100至150秒生产节流请求", async () => {
  const { input } = await archiveFixture(true, true); const record = vi.spyOn(stats, "recordDocupediaUpload").mockResolvedValue(null); vi.spyOn(console, "warn").mockImplementation(() => undefined);
  // 只加速文章间的长等待，保留并断言传入时长，不触发真实网络或等待。
  const original = globalThis.setTimeout;
  const timers = vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => original(callback, ms && ms >= 100_000 && ms <= 150_000 ? 0 : ms, ...args)) as typeof setTimeout);
  expect(await archiveIssueLogToDocupedia(input)).toMatchObject({ created: 2, failed: 1 }); expect(record).toHaveBeenCalledTimes(1); expect(record.mock.calls[0][0].title).toContain("_step2");
  expect(timers.mock.calls.some(([, ms]) => typeof ms === "number" && ms >= 100_000 && ms <= 150_000)).toBe(true);
});
