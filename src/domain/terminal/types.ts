export type RemoteShellRiskLevel = "normal" | "critical";
export type RemoteShellGuardMode = "soft" | "strict";

export interface RemoteShellTarget {
  id: string;
  name: string;
  description: string;
  environment: string;
  riskLevel: RemoteShellRiskLevel;
  guardMode: RemoteShellGuardMode;
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  password?: string;
  agentSocket?: string;
  strictAllowlist?: string[];
}

export type PublicRemoteShellTarget = Pick<
  RemoteShellTarget,
  "id" | "name" | "description" | "environment" | "riskLevel" | "guardMode"
>;

export interface TerminalRepoConfig {
  repoName: string;
  repoPath: string;
  origin?: string;
  branchName: string;
}

export interface TerminalBranchConfig {
  name: string;
  repos: TerminalRepoConfig[];
}

export interface TerminalProject {
  projectName: string;
  mainPath: string;
  scriptPath: string;
  branches: TerminalBranchConfig[];
}

export type UploadTargetKind = "xls" | "dbc" | "mcuHeader";

export interface TerminalProjectContext {
  project: TerminalProject;
  branch: TerminalBranchConfig;
}

export interface TerminalRepoGitStatus {
  repoName: string;
  repoPath: string;
  branchName: string;
  status: "success" | "failed";
  output: string;
}

export interface TerminalSignalConfigFile {
  fileName: string;
  filePath: string;
  label: string;
}

export interface TerminalRepoSignalConfig {
  repoName: string;
  repoPath: string;
  branchName: string;
  status: "success" | "failed";
  files: TerminalSignalConfigFile[];
  error?: string;
}

export type ClientTerminalMessage =
  | { type: "connect"; targetId: string; cols: number; rows: number }
  | { type: "input"; sessionId: string; data: string; projectContext?: TerminalProjectContext }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "disconnect"; sessionId: string }
  | { type: "projectGitStatus"; sessionId: string; projectContext: TerminalProjectContext }
  | { type: "uploadFile"; sessionId: string; projectContext: TerminalProjectContext; uploadKind: UploadTargetKind; fileName: string; contentBase64: string }
  | { type: "packageFiles"; sessionId: string; projectContext: TerminalProjectContext }
  | { type: "packageChecklist"; sessionId: string; projectContext: TerminalProjectContext }
  | { type: "signalConfigFiles"; sessionId: string; projectContext: TerminalProjectContext }
  | { type: "checkoutSignalConfigFiles"; sessionId: string; projectContext: TerminalProjectContext; repos: Array<{ repoPath: string; files: string[] }> }
  | { type: "gitAdd"; sessionId: string; projectContext: TerminalProjectContext; repoPath: string; files: string[] }
  | { type: "gitCheckout"; sessionId: string; projectContext: TerminalProjectContext; repoPath: string; files: string[] }
  | { type: "gitReset"; sessionId: string; projectContext: TerminalProjectContext; repoPath: string; files: string[] };

export type ServerTerminalMessage =
  | { type: "connected"; sessionId: string; targetId: string }
  | { type: "output"; sessionId: string; data: string }
  | { type: "status"; sessionId?: string; status: string; message: string }
  | { type: "blocked"; sessionId: string; command: string; reason: string }
  | { type: "closed"; sessionId: string; reason: string }
  | { type: "gitStatus"; sessionId: string; statuses: TerminalRepoGitStatus[] }
  | { type: "signalConfigFiles"; sessionId: string; configs: TerminalRepoSignalConfig[] }
  | { type: "fileDownload"; sessionId: string; fileName: string; mimeType: string; contentBase64: string };
