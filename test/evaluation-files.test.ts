import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { collectEvalTicketDirs } from "@/server/evaluation/ticket-directories";
import { exportReviewTruth } from "@/server/evaluation/export-truth";
import { serializeRecord } from "@/domain/storage/serialization";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/db/mysql", () => ({ getPool: async () => ({ query }) }));
let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); query.mockReset(); });
async function setup() { root = await mkdtemp(path.join(os.tmpdir(), "ivacp-eval-")); }
async function reply(relative: string, time: number, metrics?: object) {
  const dir = path.join(root, "log", relative); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, "final_reply.md"), "回复"); await utimes(path.join(dir, "final_reply.md"), new Date(time), new Date(time));
  if (metrics) await writeFile(path.join(dir, "pipeline-metrics.json"), JSON.stringify(metrics)); return dir;
}
it("同票选最新完整运行，旧父目录不会压过新run；取消或未提交响应不参与评测", async () => {
  await setup(); const ticket = await reply("g/m/A-1", 1000); const expected = await reply("g/m/A-1/run1", 2000, { status: "success" });
  await reply("g/m/A-1/run2", 3000, { status: "cancelled" }); await reply("g/m/A-1/run3", 4000, { status: "success", responseArtifactVersion: 1 });
  const meegle = await reply("g/m/meegle-42/r1", 2000, { status: "success", responseArtifactVersion: 1 }); await writeFile(path.join(meegle, "process-response.json"), "{}");
  expect(await collectEvalTicketDirs(path.join(root, "log"))).toEqual([{ ticketDir: ticket, runDir: expected }, { ticketDir: path.dirname(meegle), runDir: meegle }]);
});
it("迁移复制改变mtime后，最新运行仍按成功完成时间选择", async () => {
  await setup(); await reply("g/m/A-1", 5000, { status: "success", completedAt: "2026-01-01T00:00:00Z" });
  const expected = await reply("g/m/A-1/march", 1000, { status: "success", completedAt: "2026-03-01T00:00:00Z" });
  await reply("g/m/A-1/february", 6000, { status: "success", completedAt: "2026-02-01T00:00:00Z" });
  expect((await collectEvalTicketDirs(path.join(root, "log")))[0].runDir).toBe(expected);
});
it("真值从新库reviewSamples读取，匹配规范化目录，保留手写条目；dry-run不写文件", async () => {
  await setup(); await reply("组_一/m/meegle-42/run1", 2000); const file = path.join(root, "docs/golden-baseline/eval-set.json"); await mkdir(path.dirname(file), { recursive: true });
  const manual = [{ ruleGroupDir: "手写组", carModelDir: "m", issueKey: "A-1", expectedKeywords: ["手写"] }]; await writeFile(file, JSON.stringify(manual));
  query.mockImplementation(async (sql: string, params: string[]) => {
    expect(sql).toMatch(/^SELECT /); expect(sql).toContain("FROM sync_records"); expect(params[0]).toBe("alice");
    return [params[1] === "ruleGroups" ? [{ record_id: "g", data: serializeRecord({ name: "组/一" }) }] : [{ record_id: "s", data: serializeRecord({ ruleGroupId: "g", source: "meegle", ticketKey: "42", sampleKind: "correction", correctConclusion: "CAN_SIGNAL_A正常，请转对应模块分析", createdAt: new Date(), signalTokens: ["CAN_SIGNAL_A"] }) }]];
  });
  expect(await exportReviewTruth({ root, owner: "alice", dryRun: true })).toMatchObject({ exportable: 1, total: 2, dryRun: true }); expect(JSON.parse(await readFile(file, "utf8"))).toEqual(manual);
  await exportReviewTruth({ root, owner: "alice" }); const entries = JSON.parse(await readFile(file, "utf8")); expect(entries).toHaveLength(2); expect(entries[0]).toEqual(manual[0]); expect(entries[1]).toMatchObject({ source: "mysql-review-sample", issueKey: "meegle-42", ruleGroupDir: "组_一" });
  expect(query.mock.calls.some(([, params]) => params[1] === "reviewSamples")).toBe(true);
});
