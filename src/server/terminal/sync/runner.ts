import { parseVhalVersion } from "../../pipeline/vhal-version";
import { readSyncedHeader } from "./vhal";
import { currentHeaderName, currentRtcids, retireNamedHeader, writeNamedHeader } from "./header-identity";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { TerminalProject, TerminalBranchConfig } from "../../../domain/terminal/types";
import type { TerminalSyncBranchResult, TerminalSyncProgress, TerminalSyncReport, TerminalBranchVhal } from "../../../domain/terminal/sync";
import { assertFileName, gitBlobId, type SyncCommit, type SyncReader, type SyncSnapshot } from "./remote";
import { acquireSyncLock, assertNoLinks, atomicJson, branchKey, exists, prepareMappings, readProjects, realDirectory } from "./storage";
import { resolveProjectReadFile } from "../project-file";
interface Manifest { headerFile?: string; vhal?: TerminalBranchVhal; schemaVersion: 1; targetId: string; fingerprint: string; configurationKey: string; files: Array<{ name: string; oid: string }>; repos: Array<{ repoName: string; repoPath: string; branchName: string; latestSyncedCommitId: string; rtcids: string[]; history?: SyncCommit[] }>; sources: Array<{ repoName: string; source: string; name: string; oid: string }>; syncedAt: string }
export interface TerminalSyncOptions { root?: string; targetId: string; targetName?: string; reader: SyncReader; signal?: AbortSignal; progress?: (progress: TerminalSyncProgress) => void }
const fail = (error: unknown) => error instanceof Error ? error.message : String(error);
async function manifestAt(dir: string): Promise<Manifest | undefined> {
  if (!await exists(path.join(dir, ".sync-state.json"))) return;
  const m = JSON.parse(await fs.readFile(path.join(dir, ".sync-state.json"), "utf8")) as Manifest;
  if (m.schemaVersion !== 1 || !Array.isArray(m.files)) throw new Error("本地同步清单格式无效");
  if (typeof m.targetId !== "string" || typeof m.fingerprint !== "string" || typeof m.configurationKey !== "string" || !Array.isArray(m.repos) || !Array.isArray(m.sources)) throw new Error("本地同步清单身份无效");
  for (const repo of m.repos) {
    if (repo.history !== undefined && (!Array.isArray(repo.history) || repo.history.length > 10 || repo.history.some(entry => !entry || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.commitid) || !Array.isArray(entry.rtcids) || entry.rtcids.some(id => typeof id !== "string" || !/^RTC1-\d+$/.test(id))))) throw new Error("本地同步清单提交历史无效");
    if (!repo || typeof repo.repoName !== "string" || typeof repo.repoPath !== "string" || typeof repo.branchName !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(repo.latestSyncedCommitId) || !Array.isArray(repo.rtcids) || repo.rtcids.some(id => typeof id !== "string" || !/^RTC1-\d+$/.test(id))) throw new Error("本地同步清单仓库记录无效");
  }
  for (const f of m.files) { assertFileName(f.name); if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(f.oid)) throw new Error("本地清单blob ID无效"); }
  if (m.headerFile !== undefined) {
    assertFileName(m.headerFile);
    if (!m.files.some(f => f.name === m.headerFile)) throw new Error("当前 type.h 版本文件不在同步清单中");
  }
  return m;
}
async function matches(file: string, oid: string): Promise<boolean> {
  if (!await exists(file)) return false;
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`同步目标不是普通文件：${file}`);
  return gitBlobId(await fs.readFile(file), oid.length) === oid;
}
async function syncBranch(options: TerminalSyncOptions, configFile: string, project: TerminalProject, branch: TerminalBranchConfig): Promise<TerminalSyncBranchResult> {
  const base = path.join(options.root!, "configuration", project.projectName);
  const directory = path.join(base, branch.name), previous = path.join(base, `.${branch.name}.sync-previous`);
  const result: TerminalSyncBranchResult = { projectName: project.projectName, branchName: branch.name, directory: path.relative(options.root!, directory), status: "updated", repos: [], fileCount: 0, backupCount: 0 };
  const snapshots: SyncSnapshot[] = [];
  let stage: string | undefined;
  let recoveryNotice = "";
  try {
  options.signal?.throwIfAborted();
  await realDirectory(base);
  // A process may have stopped between directory publication and project.json commit.
  if (await exists(previous)) {
    await realDirectory(previous); await assertNoLinks(previous);
    let published: Manifest | undefined;
    if (await exists(directory)) {
      await realDirectory(directory); await assertNoLinks(directory);
      published = await manifestAt(directory);
    }
    if (published) {
      if (published.configurationKey !== branchKey(project, branch)) throw new Error("上次同步待恢复，但配置已变化，请先核对分支组配置");
      if (published.repos.length !== branch.repos.length || published.repos.some((r, i) => r.repoName !== branch.repos[i].repoName || r.repoPath !== branch.repos[i].repoPath || r.branchName !== branch.repos[i].branchName)) throw new Error("本地恢复清单仓库与配置不一致");
      let complete = true;
      for (const f of published.files) if (!await matches(path.join(directory, f.name), f.oid)) complete = false;
      if (complete) {
        const saved = published.repos.map(repo => ({ commitid: repo.latestSyncedCommitId, rtcids: repo.rtcids, history: repo.history, files: [], warnings: [] }));
        const mappings = await prepareMappings(configFile, project, branch, saved);
        options.signal?.throwIfAborted();
        if (mappings.changed) await atomicJson(configFile, mappings.projects);
        await fs.rm(previous, { recursive: true, force: true });
      } else {
        // Preserve every current file (including untracked local files) before
        // restoring the last complete snapshot, then continue normal repair.
        const old = await manifestAt(previous);
        if (!old || old.configurationKey !== branchKey(project, branch)) throw new Error("恢复备份身份无效，已保留所有目录");
        for (const f of old.files) if (!await matches(path.join(previous, f.name), f.oid)) throw new Error("恢复备份不完整，已保留所有目录");
        const damaged = path.join(base, `.${branch.name}.sync-damaged-${randomUUID()}`);
        options.signal?.throwIfAborted();
        await fs.rename(directory, damaged);
        await fs.rename(previous, directory);
        recoveryNotice = `上次不完整快照保留于 ${path.relative(options.root!, damaged)}，已恢复备份并继续同步`;
      }
    } else {
      if (await exists(directory)) throw new Error("待恢复的当前目录缺少有效清单，已保留恢复备份");
      options.signal?.throwIfAborted();
      await fs.rename(previous, directory);
    }
  }
    for (const repo of branch.repos) {
      options.signal?.throwIfAborted();
      try {
        const snapshot = await options.reader.snapshot(project, repo);
        snapshots.push(snapshot);
        result.repos.push({ repoName: repo.repoName, repoPath: repo.repoPath, branchName: repo.branchName, commitid: snapshot.commitid, rtcids: snapshot.rtcids, fileCount: snapshot.files.length, warnings: snapshot.warnings, status: snapshot.files.length ? "updated" : "not_applicable" });
      } catch (error) {
        result.repos.push({ repoName: repo.repoName, repoPath: repo.repoPath, branchName: repo.branchName, rtcids: [], fileCount: 0, warnings: [], status: "failed", error: fail(error) });
        throw error;
      }
    }
    if (await exists(directory)) { await realDirectory(directory); await assertNoLinks(directory); }
    const prior = await manifestAt(directory);
    const sources = snapshots.flatMap((snapshot, i) => snapshot.files.map(file => ({ repoName: branch.repos[i].repoName, source: file.source, name: file.name, oid: file.oid })));
    const fingerprint = createHash("sha256").update(JSON.stringify([options.targetId, branchKey(project, branch), snapshots.map(s => [s.commitid, currentRtcids(s)]), sources])).digest("hex");
    const winners = new Map<string, { name: string; oid: string }>();
    for (const f of sources) { assertFileName(f.name); winners.set(f.name, { name: f.name, oid: f.oid }); }
    result.fileCount = winners.size + (winners.has("type.h") ? 1 : 0);
    let complete = prior?.fingerprint === fingerprint;
    if (complete) for (const f of winners.values()) if (!await matches(path.join(directory, f.name), f.oid)) { complete = false; break; }
    if (complete && winners.has("type.h")) {
      const named = prior?.files.find(f => f.name === prior.headerFile);
      complete = !!named && named.oid === winners.get("type.h")!.oid && await matches(path.join(directory, named.name), named.oid);
    }
    if (complete) {
      options.signal?.throwIfAborted();
      const mappings = await prepareMappings(configFile, project, branch, snapshots);
      options.signal?.throwIfAborted();
      if (mappings.changed) await atomicJson(configFile, mappings.projects);
      result.vhal = winners.has("type.h") ? await readSyncedHeader(directory, options.targetId) : undefined;
      const repos = prior!.repos.map((repo, index) => ({ ...repo, rtcids: snapshots[index].rtcids, history: snapshots[index].history }));
      if (prior && (JSON.stringify(prior.vhal) !== JSON.stringify(result.vhal) || JSON.stringify(prior.repos) !== JSON.stringify(repos))) {
        options.signal?.throwIfAborted();
        await atomicJson(path.join(directory, ".sync-state.json"), { ...prior, repos, vhal: result.vhal });
      }
      result.status = recoveryNotice ? "repaired" : "unchanged";
    } else {
      stage = await fs.mkdtemp(path.join(base, `.${branch.name}.sync-stage-`));
      if (await exists(directory)) await fs.cp(directory, stage, { recursive: true });
      const processed = new Set<string>();
      // Capture the old header owner before merging the incoming Git history.
      const oldSource = prior?.sources.filter(s => s.name === "type.h").at(-1);
      let headerOwner = oldSource ? branch.repos.findIndex(r => r.repoName === oldSource.repoName) : -1;
      let headerCommit = headerOwner >= 0 ? prior?.repos[headerOwner]?.latestSyncedCommitId : undefined;
      let headerFromCurrentBatch = false;
      for (const [index, snapshot] of snapshots.entries()) for (const file of snapshot.files) {
        options.signal?.throwIfAborted(); assertFileName(file.name);
        const destination = path.join(stage, file.name);
        const alreadyMatches = await matches(destination, file.oid);
        if (!alreadyMatches) {
          const content = await options.reader.readFile(file);
          options.signal?.throwIfAborted();
          if (gitBlobId(content, file.oid.length) !== file.oid) throw new Error(`文件校验失败：${file.source}`);
          if (await exists(destination)) {
            await realDirectory(path.join(stage, "bak"));
            let backupName = file.name;
            if (file.name === "type.h") {
              const owner = headerOwner >= 0 ? headerOwner : index;
              const mappings = branch.repos[owner]["commid-rtcids-map"] ?? [];
              const mapping = headerCommit ? mappings.find(m => m.commitid === headerCommit) : mappings.at(-1);
              const commitid = headerCommit ?? mapping?.commitid;
              const rtcids = mapping?.rtcids ?? (headerFromCurrentBatch ? snapshots[owner].rtcids : prior?.repos[owner]?.rtcids);
              let version: string;
              try { version = parseVhalVersion(await fs.readFile(destination, "utf8")).raw; }
              catch { version = "unknown-vhal"; }
              if (!commitid || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitid) || !rtcids || rtcids.some(id => !/^RTC1-\d+$/.test(id))) {
                throw new Error("旧 type.h 缺少有效 commit/RTC 映射，已保留原快照，请先核对 project.json");
              }
              backupName = `${commitid}_${rtcids.length ? rtcids.join("_") : "no-rtc"}_${version}`;
              assertFileName(backupName);
              const archive = path.join(stage, "bak", backupName);
              if (await exists(archive) && !(await fs.readFile(archive)).equals(await fs.readFile(destination))) throw new Error(`type.h 归档名冲突：${backupName}`);
            }
            await fs.copyFile(destination, path.join(stage, "bak", backupName)); result.backupCount++;
          }
          await fs.writeFile(destination, content);
        }
        if (file.name === "type.h") { headerOwner = index; headerCommit = snapshot.commitid; headerFromCurrentBatch = true; }
        processed.add(file.name);
      }
      let headerFile: string | undefined;
      if (winners.has("type.h")) {
        headerFile = currentHeaderName(snapshots[headerOwner], await fs.readFile(path.join(stage, "type.h"), "utf8"));
        if (winners.has(headerFile)) throw new Error(`type.h 版本文件名与远程文件重名：${headerFile}`);
        await writeNamedHeader(stage, headerFile);
        processed.add(headerFile);
        winners.set(headerFile, { name: headerFile, oid: winners.get("type.h")!.oid });
      }
      if (prior?.headerFile && prior.headerFile !== headerFile && winners.has(prior.headerFile)) {
        throw new Error(`旧 type.h 版本文件名与远程文件重名：${prior.headerFile}`);
      }
      result.backupCount += await retireNamedHeader(stage, prior?.headerFile, headerFile);
      for (const old of prior?.files ?? []) if (!processed.has(old.name)) await fs.rm(path.join(stage, old.name), { force: true });
      const manifest: Manifest = { schemaVersion: 1, targetId: options.targetId, fingerprint, configurationKey: branchKey(project, branch), files: [...winners.values()], sources,
        repos: branch.repos.map((repo, i) => ({ repoName: repo.repoName, repoPath: repo.repoPath, branchName: repo.branchName, latestSyncedCommitId: snapshots[i].commitid, rtcids: snapshots[i].rtcids, history: snapshots[i].history })), syncedAt: new Date().toISOString() };
      manifest.vhal = winners.has("type.h") ? await readSyncedHeader(stage, options.targetId) : undefined;
      manifest.headerFile = headerFile;
      await atomicJson(path.join(stage, ".sync-state.json"), manifest);
      const mappings = await prepareMappings(configFile, project, branch, snapshots);
      options.signal?.throwIfAborted();
      const hadPrevious = await exists(directory);
      if (hadPrevious) await fs.rename(directory, previous);
      try {
        await fs.rename(stage, directory); stage = undefined;
        if (mappings.changed) await atomicJson(configFile, mappings.projects);
      } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        if (hadPrevious) await fs.rename(previous, directory);
        throw error;
      }
      try { await fs.rm(previous, { recursive: true, force: true }); }
      catch (error) { for (const repo of result.repos) repo.warnings.push("快照已发布，旧恢复备份待下次清理：" + fail(error)); }
      result.vhal = manifest.vhal;
      result.status = prior?.fingerprint === fingerprint ? "repaired" : "updated";
    }
    if (recoveryNotice) for (const repo of result.repos) repo.warnings.push(recoveryNotice);
    result.repos = result.repos.map(repo => ({ ...repo, status: repo.status === "not_applicable" ? repo.status : result.status }));
    return result;
  } catch (error) {
    result.status = "failed"; result.error = fail(error);
    result.repos = result.repos.map(repo => ({ ...repo, status: "failed", error: repo.error || "分支组未发布：" + result.error }));
    // Include repos that were not reached, so every configured task has a visible result.
    for (const repo of branch.repos.slice(result.repos.length)) result.repos.push({ repoName: repo.repoName, repoPath: repo.repoPath, branchName: repo.branchName, rtcids: [], fileCount: 0, warnings: [], status: "failed", error: "分支组前置任务失败，未执行" });
    return result;
  } finally { if (stage) await fs.rm(stage, { recursive: true, force: true }); }
}
export async function runTerminalSync(options: TerminalSyncOptions): Promise<TerminalSyncReport> {
  options = { ...options, root: path.resolve(options.root ?? process.cwd()) };
  const release = await acquireSyncLock(path.join(options.root!, "configuration"));
  try {
    const configFile = await resolveProjectReadFile(options.root!, options.targetName);
    const projects = await readProjects(configFile);
    const report: TerminalSyncReport = { runId: randomUUID(), targetId: options.targetId, totalProjects: projects.length, totalBranches: projects.reduce((n,p) => n + p.branches.length, 0), totalRepos: projects.reduce((n,p) => n + p.branches.reduce((n,b) => n + b.repos.length, 0), 0), completedBranches: 0, message: "同步开始", startedAt: new Date().toISOString(), completedAt: "", branches: [] };
    const emit = (branch?: TerminalSyncBranchResult) => options.progress?.({ runId: report.runId, targetId: report.targetId, totalProjects: report.totalProjects, totalBranches: report.totalBranches, totalRepos: report.totalRepos, completedBranches: report.completedBranches, message: report.message, branch });
    emit();
    for (const project of projects) for (const branch of project.branches) {
      report.message = `正在同步 ${project.projectName} / ${branch.name}`; emit();
      const result = await syncBranch(options, configFile, project, branch);
      report.branches.push(result); report.completedBranches++;
      report.message = `${project.projectName} / ${branch.name}：${result.status === "failed" ? "失败" : "已处理"}`; emit(result);
    }
    report.completedAt = new Date().toISOString();
    report.message = report.branches.some(b => b.status === "failed") ? "同步完成，存在失败项" : "同步完成";
    await atomicJson(path.join(options.root!, "configuration/.sync-last.json"), report);
    return report;
  } finally { await release(); }
}
