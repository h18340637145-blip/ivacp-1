import { afterEach, expect, it } from "vitest";
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
