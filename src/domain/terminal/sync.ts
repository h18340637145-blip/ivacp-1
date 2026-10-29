export interface TerminalBranchVhal {
  targetId: string;
  raw: string;
  platform: string;
  version: string;
}
export interface TerminalSyncRepoResult {
  repoName: string;
  repoPath: string;
  branchName: string;
  commitid?: string;
  rtcids: string[];
  fileCount: number;
  warnings: string[];
  status: "updated" | "unchanged" | "repaired" | "not_applicable" | "failed";
  error?: string;
}
export interface TerminalSyncBranchResult {
  vhal?: TerminalBranchVhal;
  projectName: string;
  branchName: string;
  directory: string;
  status: "updated" | "unchanged" | "repaired" | "failed";
  repos: TerminalSyncRepoResult[];
  fileCount: number;
  backupCount: number;
  error?: string;
}
export interface TerminalSyncProgress {
  runId: string;
  targetId: string;
  totalProjects: number;
  totalBranches: number;
  totalRepos: number;
  completedBranches: number;
  message: string;
  branch?: TerminalSyncBranchResult;
}
export interface TerminalSyncReport extends TerminalSyncProgress {
  startedAt: string;
  completedAt: string;
  branches: TerminalSyncBranchResult[];
}
