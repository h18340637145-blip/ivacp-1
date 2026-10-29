"use client";
import type { TerminalSyncBranchResult, TerminalSyncProgress } from "@/domain/terminal/sync";
import { Button } from "@/shared/ui/button";
const labels = { updated: "已更新", unchanged: "未变化", repaired: "已补齐", not_applicable: "无匹配配置文件", failed: "失败" };
interface Props {
  connected: boolean;
  running: boolean;
  targetName: string;
  counts: { projects: number; branches: number; repos: number };
  progress?: TerminalSyncProgress;
  branches: TerminalSyncBranchResult[];
  error: string;
  start: () => void;
}
export function SyncPanel({ connected, running, targetName, counts, progress, branches, error, start }: Props) {
  return <section aria-label="全部项目同步" className="space-y-3 border-b border-border bg-surface p-3">
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="primary" disabled={!connected || running || !counts.projects} onClick={start}>{running ? "同步中…" : "同步全部项目"}</Button>
      <p className="min-w-0 break-all text-xs text-muted-foreground">{targetName} · 全部 {progress?.totalProjects ?? counts.projects} 个项目 / {progress?.totalBranches ?? counts.branches} 个分支组 / {progress?.totalRepos ?? counts.repos} 个仓库任务</p>
    </div>
    <p className="text-xs text-muted-foreground">读取服务器本地分支；文件保存至 IVACP 的 configuration/项目/分支组/。同名异内容先备份到 bak/ 再覆盖。</p>
    {progress && <p role="status" className="break-all text-sm">{progress.message}（{progress.completedBranches}/{progress.totalBranches} 个分支组）</p>}
    {error && <p role="alert" className="break-all text-sm text-destructive">{error}</p>}
    {branches.length > 0 && <details open className="min-w-0 rounded-md border border-border p-2">
      <summary className="cursor-pointer text-sm">同步结果：{branches.filter(b => b.status !== "failed").length} 个成功，{branches.filter(b => b.status === "failed").length} 个失败</summary>
      <ul className="mt-3 grid gap-3">
        {branches.map(branch => <li key={JSON.stringify([branch.projectName, branch.branchName])} className="min-w-0 space-y-1 rounded-md bg-surface-2 p-3 text-xs">
          <p className="break-all font-medium">{branch.projectName} / {branch.branchName} · {labels[branch.status]} · {branch.fileCount} 个文件 · {branch.backupCount} 次备份</p>
          <p className="break-all text-muted-foreground">目录：{branch.directory}</p>
          {branch.error && <p className="break-all text-destructive">{branch.error}</p>}
          {branch.repos.map((repo, i) => <div key={i} className="min-w-0 space-y-1 border-t border-border pt-2">
            <p className="break-all">{repo.repoName} · {repo.branchName} · {labels[repo.status]} · {repo.fileCount} 个源文件</p>
            <p className="break-all text-muted-foreground">{repo.repoPath}</p>
            {repo.commitid && <p className="break-all">Commit：<code className="select-all">{repo.commitid}</code></p>}
            <p className="break-all">RTC：{repo.rtcids.join("、") || "未识别"}</p>
            {repo.warnings.map((warning, j) => <p key={j} className="break-all text-muted-foreground">{warning}</p>)}
            {repo.error && <p className="break-all text-destructive">{repo.error}</p>}
          </div>)}
        </li>)}
      </ul>
    </details>}
  </section>;
}
