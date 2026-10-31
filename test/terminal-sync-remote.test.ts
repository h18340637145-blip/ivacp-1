import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGitSyncReader, extractRtcIds } from "@/server/terminal/sync/remote";
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
it("extracts complete RTC identifiers, not partial identifiers or plain numbers", () => {
 expect(extractRtcIds("RTC1-3103704 RTC1-3103704\n[RTC1-42], RTC2-10 20261029 xRTC1-9 RTC1-22abc RTC1-2_foo RTC1-123-456")).toEqual(["RTC1-3103704", "RTC1-42"]);
});
it("reads recursive files from a fixed local Git branch, preserves bytes and never checks out or fetches", async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "sync-git-")); roots.push(root);
 const repoDir = path.join(root, "repo space"); await fs.mkdir(repoDir);
 const git = (...args: string[]) => exec("git", args, { cwd: repoDir });
 await git("init", "-b", "main"); await git("config", "user.email", "test@example.invalid"); await git("config", "user.name", "test");
 for (const dir of ["tools/json/a/deep", "tools/sdb/b", "tools/scripts/c"]) await fs.mkdir(path.join(repoDir, dir), { recursive: true });
 await fs.writeFile(path.join(repoDir, "tools/json/a/deep/any.json"), "{}");
 await fs.writeFile(path.join(repoDir, "tools/sdb/b/data.bin"), Buffer.from([0, 255, 1, 0, 128]));
 await fs.writeFile(path.join(repoDir, "tools/scripts/c/type.h"), "header");
 await fs.writeFile(path.join(repoDir, "tools/scripts/c/types.hal"), "hal");
 await fs.writeFile(path.join(repoDir, "tools/scripts/c/a.xls"), "xls");
 await fs.writeFile(path.join(repoDir, "tools/scripts/c/no.xlsx"), "skip");
 await fs.symlink("/etc/passwd", path.join(repoDir, "tools/sdb/link"));
 await git("add", "."); await git("commit", "-m", "RTC1-3103704\n\nRTC1-3103705"); 
 const commits = [(await git("rev-parse", "HEAD")).stdout.trim()];
 for (let i = 1; i <= 11; i++) {
   await git("commit", "--allow-empty", "-m", i === 11 ? "no ticket" : `RTC1-${i}\n\nRTC1-${i} RTC1-${i + 100}`);
   commits.unshift((await git("rev-parse", "HEAD")).stdout.trim());
 }
 await git("branch", "saved");
 await git("checkout", "-b", "other"); await fs.writeFile(path.join(repoDir, "tools/scripts/c/type.h"), "dirty");
 const commands: string[] = [];
 const reader = createGitSyncReader(async command => { commands.push(command); try { const r = await exec("bash", ["-c", command], { maxBuffer: 50 * 1024 * 1024 }); return { ...r, code: 0 }; } catch (e) { const r = e as { stdout: string; stderr: string; code: number }; return r; } });
 const snapshot = await reader.snapshot({ projectName: "p", mainPath: root, scriptPath: "unused", branches: [] }, { repoName: "r", repoPath: "/repo space", branchName: "saved" });
 expect(snapshot.rtcids).toEqual([]);
 expect(snapshot).toMatchObject({ history: commits.slice(0, 10).map((commitid, i) => ({ commitid, rtcids: i === 0 ? [] : [`RTC1-${11-i}`, `RTC1-${111-i}`] })) });
 expect(snapshot.files.map(f => f.name).sort()).toEqual(["a.xls", "any.json", "data.bin", "type.h", "types.hal"]);
 expect(await reader.readFile(snapshot.files.find(f => f.name === "data.bin")!)).toEqual(Buffer.from([0, 255, 1, 0, 128]));
 expect((await reader.readFile(snapshot.files.find(f => f.name === "type.h")!)).toString()).toBe("header");
 await expect(reader.snapshot({ projectName: "p", mainPath: root, scriptPath: "", branches: [] }, { repoName: "r", repoPath: "repo space", branchName: "missing" })).rejects.toThrow();
 for (const branchName of ["main~1", "main@{1}", "main^{commit}"]) await expect(reader.snapshot({projectName:"p",mainPath:root,scriptPath:"",branches:[]},{repoName:"r",repoPath:"repo space",branchName})).rejects.toThrow();
 expect((await git("branch", "--show-current")).stdout.trim()).toBe("other");
 expect(commands.join("\n")).not.toMatch(/git (fetch|pull|checkout)/);
});


it("publishes only the api-public fixed-branch root Proto with repair, backup, removal and atomic failure recovery", async () => {
 const { runTerminalSync } = await import("@/server/terminal/sync/runner");
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "sync-proto-")); roots.push(root);
 const repoDir = path.join(root, "remote"), app = path.join(root, "app");
 await fs.mkdir(repoDir); await fs.mkdir(path.join(app, "docs"), { recursive: true });
 const git = (...args: string[]) => exec("git", args, { cwd: repoDir });
 const proto = "com.bosch.cm.platform.vehicle.proto";
 await git("init", "-b", "fixed"); await git("config", "user.email", "test@example.invalid"); await git("config", "user.name", "test");
 await fs.mkdir(path.join(repoDir, "tools/json"), { recursive: true });
 await fs.writeFile(path.join(repoDir, "tools/json/data.json"), "old-json");
 await fs.writeFile(path.join(repoDir, proto), "committed-proto");
 await fs.writeFile(path.join(repoDir, "other.proto"), "skip");
 await fs.mkdir(path.join(repoDir, "nested")); await fs.writeFile(path.join(repoDir, "nested", proto), "skip nested");
 await git("add", "."); await git("commit", "-m", "RTC1-10");
 const commitid = (await git("rev-parse", "HEAD")).stdout.trim();
 await git("checkout", "-b", "dirty"); await fs.writeFile(path.join(repoDir, proto), "dirty-proto");
 const project = { projectName: "p", mainPath: root, scriptPath: "nested", branches: [{ name: "group", repos: [{ repoName: "api-public", repoPath: "remote", branchName: "fixed" }] }] };
 await fs.writeFile(path.join(app, "docs/project.json"), JSON.stringify([project]));
 const commands: string[] = [];
 let failTransfer = false, corruptTransfer = false;
 const reader = createGitSyncReader(async command => {
  commands.push(command);
  if (failTransfer && command.includes("git cat-file")) return { stdout: "", stderr: "transfer failed", code: 1 };
  if (corruptTransfer && command.includes("git cat-file")) return { stdout: Buffer.from("corrupt-proto").toString("base64"), stderr: "", code: 0 };
  try { return { ...await exec("bash", ["-c", command]), code: 0 }; }
  catch (error) { return error as { stdout: string; stderr: string; code: number }; }
 });
 const snapshot = await reader.snapshot(project, project.branches[0].repos[0]);
 expect(snapshot.files.map(file => file.source)).toEqual([proto, "tools/json/data.json"]);
 expect(snapshot.commitid).toBe(commitid);
 expect((await reader.readFile(snapshot.files.find(file => file.source === proto)!)).toString()).toBe("committed-proto");
 for (const repoName of ["api-private", "API-PUBLIC", "r"]) {
  const other = await reader.snapshot(project, { ...project.branches[0].repos[0], repoName });
  expect(other.files.some(file => file.name.endsWith(".proto"))).toBe(false);
  expect(other.warnings.join(" ")).not.toContain(proto);
 }
 const directory = path.join(app, "configuration/p/group"), output = path.join(directory, proto);
 const run = () => runTerminalSync({ root: app, targetId: "test", reader });
 expect((await run()).branches[0].status).toBe("updated");
 expect(await fs.readFile(output, "utf8")).toBe("committed-proto");
 const manifestFile = path.join(directory, ".sync-state.json");
 const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
 expect(manifest.sources.find((file: {name:string}) => file.name === proto)).toEqual({ repoName: "api-public", source: proto, name: proto, oid: snapshot.files.find(file => file.name === proto)!.oid });
 expect((await run()).branches[0].status).toBe("unchanged");
 await fs.unlink(output); expect((await run()).branches[0].status).toBe("repaired");
 expect(await fs.readFile(output, "utf8")).toBe("committed-proto");
 await git("checkout", "--", proto); await git("checkout", "fixed");
 await fs.writeFile(path.join(repoDir, proto), "next-proto"); await fs.writeFile(path.join(repoDir, "tools/json/data.json"), "new-json");
 await git("add", "."); await git("commit", "-m", "RTC1-11");
 const previousState = await fs.readFile(manifestFile, "utf8"), previousConfig = await fs.readFile(path.join(app, "docs/project.json"), "utf8");
 failTransfer = true;
 expect((await run()).branches[0]).toMatchObject({ status: "failed", error: "transfer failed" });
 expect(await fs.readFile(output, "utf8")).toBe("committed-proto");
 expect(await fs.readFile(path.join(directory, "data.json"), "utf8")).toBe("old-json");
 expect(await fs.readFile(manifestFile, "utf8")).toBe(previousState);
 expect(await fs.readFile(path.join(app, "docs/project.json"), "utf8")).toBe(previousConfig);
 failTransfer = false;
 corruptTransfer = true;
 expect((await run()).branches[0]).toMatchObject({ status: "failed", error: `文件传输校验失败：${proto}` });
 expect(await fs.readFile(output, "utf8")).toBe("committed-proto");
 expect(await fs.readFile(manifestFile, "utf8")).toBe(previousState);
 corruptTransfer = false;
 // Fail publication after staging: the previous complete branch and provenance survive.
 const rename = fs.rename.bind(fs);
 const publishFailure = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
  if (String(from).includes(".group.sync-stage-") && String(to) === directory) throw new Error("publication failed");
  return rename(from, to);
 });
 try { expect((await run()).branches[0].status).toBe("failed"); } finally { publishFailure.mockRestore(); }
 expect(await fs.readFile(output, "utf8")).toBe("committed-proto");
 expect(await fs.readFile(manifestFile, "utf8")).toBe(previousState);
 expect(await fs.readFile(path.join(app, "docs/project.json"), "utf8")).toBe(previousConfig);
 expect((await run()).branches[0].status).toBe("updated");
 expect(await fs.readFile(output, "utf8")).toBe("next-proto");
 expect(await fs.readFile(path.join(directory, "bak", proto), "utf8")).toBe("committed-proto");
 await git("rm", proto); await git("commit", "-m", "RTC1-12");
 const removed = await run(); expect(removed.branches[0].status).toBe("updated");
 expect(removed.branches[0].repos[0].warnings.join(" ")).toContain(proto);
 expect(await fs.stat(output).catch(() => null)).toBeNull();
 expect(JSON.parse(await fs.readFile(manifestFile, "utf8")).files.some((file: {name:string}) => file.name === proto)).toBe(false);
 expect((await reader.snapshot(project, project.branches[0].repos[0])).warnings.join(" ")).toContain(proto);
 expect(commands.join("\n")).not.toMatch(/git (fetch|pull|checkout)/);
});
