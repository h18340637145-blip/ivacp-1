import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { recordDocupediaUpload } from "@/server/docupedia/upload-stats";
const exec = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ivacp-docstats-")); directories.push(directory); return { directory, uploadedAt: new Date(2026, 9, 8, 12), title: "文章", text: "a".repeat(501), action: "created" as const }; }
it("严格超过500个UTF-16代码单元才创建统计文件", async () => {
  const input = await fixture();
  expect(await recordDocupediaUpload({ ...input, text: "a".repeat(500) })).toBeNull(); expect(await recordDocupediaUpload({ ...input, text: "🙂".repeat(250) })).toBeNull(); expect(await fs.readdir(input.directory)).toEqual([]);
  expect(await recordDocupediaUpload(input)).toMatchObject({ monthlyTotal: 1, characterCount: 501, month: "2026-10", uploadedAt: input.uploadedAt.toISOString() });
  expect(await recordDocupediaUpload({ ...input, title: "emoji", text: "🙂".repeat(251), action: "existing" })).toMatchObject({ monthlyTotal: 2, characterCount: 502, action: "existing" });
});
it("同月并发去重且顺序计数，不同月份独立", async () => {
  const input = await fixture();
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => recordDocupediaUpload({ ...input, title: `文章${index % 10}` })));
  expect(results.filter(Boolean)).toHaveLength(10);
  const records = (await fs.readFile(path.join(input.directory, "2026-10.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(records.map(row => row.monthlyTotal)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1)); expect(new Set(records.map(row => row.title)).size).toBe(10);
  expect(await recordDocupediaUpload({ ...input, title: "文章0", action: "existing" })).toBeNull();
  expect(await recordDocupediaUpload({ ...input, title: "文章0", uploadedAt: new Date(2026, 10, 1) })).toMatchObject({ month: "2026-11", monthlyTotal: 1 });
});
it("按服务器本地月份归档，同时保存UTC上传时间", async () => {
  vi.stubEnv("TZ", "America/Los_Angeles"); const input = await fixture(); const uploadedAt = new Date("2026-11-01T00:30:00Z");
  expect(await recordDocupediaUpload({ ...input, uploadedAt })).toMatchObject({ month: "2026-10", uploadedAt: "2026-11-01T00:30:00.000Z" });
});
it("新进程从持久记录续计，并正确补上缺失的末尾换行", async () => {
  const input = await fixture(); const first = await recordDocupediaUpload(input); await fs.writeFile(path.join(input.directory, "2026-10.jsonl"), JSON.stringify(first));
  const modulePath = path.resolve("src/server/docupedia/upload-stats.ts");
  const code = `const { recordDocupediaUpload } = require(${JSON.stringify(modulePath)}); recordDocupediaUpload({ ...${JSON.stringify({ ...input, title: "重启后", action: "existing" })}, uploadedAt: new Date(${JSON.stringify(input.uploadedAt.toISOString())}) }).then(result => console.log(JSON.stringify(result)));`;
  const { stdout } = await exec(process.execPath, ["--import", "tsx", "-e", code]); expect(JSON.parse(stdout)).toMatchObject({ monthlyTotal: 2, action: "existing" });
  expect((await fs.readFile(path.join(input.directory, "2026-10.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
});
it("损坏日志不被覆盖，修复文件后失败的队列仍可继续", async () => {
  const input = await fixture(); const file = path.join(input.directory, "2026-10.jsonl"); await fs.writeFile(file, "损坏记录\n"); await expect(recordDocupediaUpload(input)).rejects.toThrow(); expect(await fs.readFile(file, "utf8")).toBe("损坏记录\n");
  await fs.writeFile(file, ""); expect(await recordDocupediaUpload(input)).toMatchObject({ monthlyTotal: 1 });
});
