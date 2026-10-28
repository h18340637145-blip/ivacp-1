import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm, utimes, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
const exec = promisify(execFile);
const root = process.cwd();
let fixture: string;
afterEach(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }); });
async function setup() { fixture = await mkdtemp(path.join(os.tmpdir(), "ivacp-cli-")); return fixture; }
async function run(script: string, args: string[] = [], env: Record<string, string> = {}) {
  const loader = script.endsWith(".ts") ? ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs")] : [];
  return exec(process.execPath, [...loader, path.join(root, "scripts", script), ...args], { cwd: fixture, env: { ...process.env, TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json"), ...env } });
}
describe("运维CLI保留", () => {
  it("package中的全部本地脚本入口存在", async () => {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    for (const command of Object.values(pkg.scripts) as string[]) {
      for (const match of command.matchAll(/(?:^|\s)(scripts\/[\w./-]+\.(?:ts|mjs|js))\b/g)) expect(existsSync(path.join(root, match[1])), match[1]).toBe(true);
    }
  });
  it("运维帮助不执行数据库、评测写入或清理", async () => {
    await setup();
    for (const script of ["build-golden-baseline.mjs", "cleanup-old-data.mjs", "eval-accuracy.ts", "eval-set-coverage.ts", "export-eval-set.ts"]) {
      const result = await run(script, ["--help"], { MYSQL_URL: "invalid-url" }); expect(result.stdout.length).toBeGreaterThan(10);
    }
    expect(existsSync(path.join(fixture, "docs"))).toBe(false);
  });
  it("清理支持只读预览与实际删除，保留月度归档统计，并拒绝危险天数", async () => {
    await setup(); const old = new Date("2000-01-01");
    for (const name of ["jira-issues/group/old.zip", "log/group/model/A-1/old.txt", "log/docupedia-upload-stats/2000-01.jsonl", "log/recent.txt"]) { const file = path.join(fixture, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, "test"); if (!name.includes("recent")) await utimes(file, old, old); }
    await run("cleanup-old-data.mjs", ["--dry-run"], { DATA_RETENTION_DAYS: "90" }); expect(existsSync(path.join(fixture, "jira-issues/group/old.zip"))).toBe(true);
    await run("cleanup-old-data.mjs", [], { DATA_RETENTION_DAYS: "90" }); expect(existsSync(path.join(fixture, "jira-issues/group/old.zip"))).toBe(false); expect(existsSync(path.join(fixture, "log/docupedia-upload-stats/2000-01.jsonl"))).toBe(true); expect(existsSync(path.join(fixture, "log/recent.txt"))).toBe(true);
    await expect(run("cleanup-old-data.mjs", [], { DATA_RETENTION_DAYS: "-1" })).rejects.toThrow();
  });
  it("离线基线、覆盖和准确率命令兼容独立run，并生成报告；无证据显示未知", async () => {
    await setup(); const ticket = path.join(fixture, "log/g/model/A-1"); const runDir = path.join(ticket, "run1"); await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "final_reply.md"), "待确认，缺少证据"); await writeFile(path.join(runDir, "pipeline-metrics.json"), JSON.stringify({ issueKey: "A-1", status: "success", durationMs: 120, evidenceScore: 0, stageDurationsMs: { DONE: 120 } }));
    await run("build-golden-baseline.mjs"); await run("eval-set-coverage.ts"); await run("eval-accuracy.ts");
    const output = path.join(fixture, "docs/golden-baseline"); const report = JSON.parse(await readFile(path.join(output, "eval-report.json"), "utf8"));
    expect(report).toMatchObject({ ticketCount: 1, meanEgr: null, unknownEgrCount: 1 }); expect(JSON.parse(await readFile(path.join(output, "golden-baseline.json"), "utf8"))).toMatchObject({ sampleCount: 1, duration: { averageMs: 120 } });
    expect((await stat(path.join(output, "eval-set-coverage.md"))).size).toBeGreaterThan(0);
  });
});
