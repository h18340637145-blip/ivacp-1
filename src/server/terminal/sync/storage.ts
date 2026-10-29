import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { TerminalProject, TerminalBranchConfig } from "../../../domain/terminal/types";
import type { SyncSnapshot } from "./remote";

export function directoryName(value: string): void {
  if (typeof value !== "string" || !value || value.startsWith(".") || value.length > 100 || /[\\/\x00-\x1f]/.test(value)) throw new Error(`配置目录名无效：${value}`);
}
export async function realDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`本地目录不能是符号链接：${dir}`);
}
export async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function assertNoLinks(dir: string): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error(`同步目录含不支持的文件或符号链接：${file}`);
    if (entry.isDirectory()) await assertNoLinks(file);
  }
}
export async function atomicJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, file);
  } finally { await fs.rm(tmp, { force: true }); }
}
export async function acquireSyncLock(root: string): Promise<() => Promise<void>> {
  await realDirectory(root);
  const lock = path.join(root, ".sync-lock");
  const handle = await fs.open(lock, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  await handle.close();
  if (!(await fs.lstat(lock)).isFile()) throw new Error("同步锁不能是符号链接或目录");
  if ((await fs.lstat(lock)).isSymbolicLink()) throw new Error("同步锁不能是符号链接");
  // Kernel-owned advisory lock: no stale-directory reclamation race; EOF releases
  // it even if the Gateway crashes. Never unlink the lock file (inode identity).
  return new Promise((resolve, reject) => {
    const child = spawn("flock", ["-xn", "-E", "75", lock, "sh", "-c", "printf 'LOCKED\\n'; cat >/dev/null"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => {});
    let ready = false;
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("同步锁领取超时")); }, 5000);
    const exited = new Promise<void>(done => child.once("close", () => done()));
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (!ready) reject(new Error(code === 75 ? "已有同步任务正在运行，请等待完成后重试" : `无法领取同步锁（flock ${code}）`));
    });
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (!ready && output.includes("LOCKED")) {
        ready = true; clearTimeout(timer);
        resolve(async () => { child.stdin.end(); await exited; });
      }
    });
  });
}

export async function readProjects(file: string): Promise<TerminalProject[]> {
  if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("project.json 不能是符号链接");
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  if (!Array.isArray(data)) throw new Error("project.json 必须是数组");
  const projects = new Set<string>();
  for (const project of data) {
    directoryName(project.projectName);
    if (projects.has(project.projectName)) throw new Error("项目名重复"); projects.add(project.projectName);
    if (typeof project.mainPath !== "string" || !project.mainPath || !Array.isArray(project.branches)) throw new Error("项目配置无效");
    const branches = new Set<string>();
    for (const branch of project.branches) {
      directoryName(branch.name);
      if (branches.has(branch.name)) throw new Error("分支组名称重复"); branches.add(branch.name);
      if (!Array.isArray(branch.repos)) throw new Error("仓库配置无效");
      const repos = new Set<string>();
      for (const repo of branch.repos) {
        if (typeof repo.repoName !== "string" || !repo.repoName || typeof repo.repoPath !== "string" || typeof repo.branchName !== "string" || !repo.branchName || repo.branchName.startsWith("-") || /[\0\r\n]/.test(repo.branchName)) throw new Error("仓库配置无效");
        const key = JSON.stringify([repo.repoName, repo.repoPath, repo.branchName]);
        if (repos.has(key)) throw new Error("仓库配置重复"); repos.add(key);
        const mappings = repo["commid-rtcids-map"];
        if (mappings !== undefined && (!Array.isArray(mappings) || mappings.some((m: { commitid?: unknown; rtcids?: unknown }) => !m || typeof m.commitid !== "string" || !Array.isArray(m.rtcids) || m.rtcids.some(id => typeof id !== "string")))) throw new Error("commit/RTC 历史映射格式无效");
      }
    }
  }
  return data;
}
export function branchKey(project: TerminalProject, branch: TerminalBranchConfig): string {
  return JSON.stringify([project.projectName, project.mainPath, branch.name, branch.repos.map(r => [r.repoName, r.repoPath, r.branchName])]);
}
export async function prepareMappings(file: string, project: TerminalProject, branch: TerminalBranchConfig, snapshots: SyncSnapshot[]) {
  const projects = await readProjects(file);
  const currentProject = projects.find(p => p.projectName === project.projectName);
  const currentBranch = currentProject?.branches.find(b => b.name === branch.name);
  if (!currentProject || !currentBranch || branchKey(currentProject, currentBranch) !== branchKey(project, branch)) throw new Error("项目配置已变化，取消当前分支组发布，请重新同步");
  let changed = false;
  currentBranch.repos.forEach((repo, index) => {
    const record = repo as typeof repo & { "commid-rtcids-map"?: Array<{ commitid: string; rtcids: string[] }> };
    const snapshot = snapshots[index];
    const mappings = record["commid-rtcids-map"] ?? [];
    const merged = new Map(mappings.map(m => [m.commitid, m]));
    for (const entry of snapshot.history ?? [{ commitid: snapshot.commitid, rtcids: snapshot.rtcids }]) {
      merged.set(entry.commitid, { commitid: entry.commitid, rtcids: [...new Set(entry.rtcids)] });
    }
    const next = [...merged.values()];
    if (JSON.stringify(mappings) !== JSON.stringify(next)) {
      record["commid-rtcids-map"] = next;
      changed = true;
    }
  });
  return { projects, changed };
}
