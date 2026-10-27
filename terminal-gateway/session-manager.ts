import { randomUUID } from "node:crypto";
import { checkCommandAllowed } from "../src/domain/terminal/command-guard";
import type { AuditEvent } from "./audit-log";
import type {
  ClientTerminalMessage,
  RemoteShellTarget,
  ServerTerminalMessage,
  TerminalProjectContext,
  TerminalRepoConfig,
  TerminalSignalConfigFile,
  UploadTargetKind,
} from "../src/domain/terminal/types";

export interface TerminalChannel {
  write(data: string): void;
  setWindow(rows: number, cols: number): void;
  close(): void;
  on(event: "data", handler: (data: Buffer | string) => void): this;
  on(event: "close", handler: () => void): this;
}

interface SessionManagerOptions {
  targets: RemoteShellTarget[];
  connectSsh: (target: RemoteShellTarget, size: { cols: number; rows: number }) => Promise<TerminalChannel>;
  runRemoteCommand: (target: RemoteShellTarget, command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>;
  uploadRemoteFile: (target: RemoteShellTarget, file: { remotePath: string; content: Buffer }) => Promise<void>;
  send: (message: ServerTerminalMessage) => void;
  audit: (event: AuditEvent) => Promise<void>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellPath(value: string): string {
  const normalized = value.replace(/\/+/g, "/");
  if (normalized === "~") return "~";
  if (normalized.startsWith("~/")) return `~/${shellQuote(normalized.slice(2))}`;
  return shellQuote(normalized);
}

function joinRemotePath(base: string, child: string): string {
  return `${base.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`;
}

function getPrimaryRepo(context: TerminalProjectContext): TerminalRepoConfig {
  const repo = context.branch.repos[0];
  if (!repo) throw new Error("当前分支没有可用 repo 配置");
  return repo;
}

function uploadDirectory(context: TerminalProjectContext, uploadKind: UploadTargetKind): string {
  if (uploadKind === "xls") {
    return joinRemotePath(context.project.mainPath, context.project.scriptPath);
  }
  const repoRoot = joinRemotePath(context.project.mainPath, getPrimaryRepo(context).repoPath);
  if (uploadKind === "dbc") return joinRemotePath(repoRoot, "tools/sdb");
  return joinRemotePath(repoRoot, "tools/inc");
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\\/]/g, "_");
}

function extractMarkedBase64(stdout: string): string {
  const begin = "__REMOTE_ZIP_BASE64_BEGIN__";
  const end = "__REMOTE_ZIP_BASE64_END__";
  const beginIndex = stdout.indexOf(begin);
  const endIndex = stdout.indexOf(end);
  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    throw new Error("远端打包结果缺少 base64 标记，无法安全下载");
  }
  const raw = stdout.slice(beginIndex + begin.length, endIndex).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    throw new Error("远端打包结果不是有效 base64");
  }
  return raw;
}

function toSignalConfigFile(filePath: string): TerminalSignalConfigFile | null {
  const normalized = filePath.trim().replace(/^\.\/+/, "");
  const fileName = normalized.split("/").at(-1) ?? "";
  const match = /^config_(.+)\.json$/.exec(fileName);
  if (!match) return null;
  return {
    fileName,
    filePath: normalized.startsWith("tools/json/") ? normalized : joinRemotePath("tools/json", fileName),
    label: match[1],
  };
}

export class TerminalSessionManager {
  private sessions = new Map<string, { target: RemoteShellTarget; channel: TerminalChannel; commandBuffer: string }>();
  private targets: Map<string, RemoteShellTarget>;

  constructor(private options: SessionManagerOptions) {
    this.targets = new Map(options.targets.map((target) => [target.id, target]));
  }

  async connect(message: Extract<ClientTerminalMessage, { type: "connect" }>): Promise<string> {
    const target = this.targets.get(message.targetId);
    if (!target) throw new Error(`Unknown target: ${message.targetId}`);
    const sessionId = randomUUID();
    const channel = await this.options.connectSsh(target, { cols: message.cols, rows: message.rows });
    this.sessions.set(sessionId, { target, channel, commandBuffer: "" });
    channel.on("data", (data) => this.options.send({ type: "output", sessionId, data: data.toString() }));
    channel.on("close", () => this.closeSession(sessionId, "remote_closed"));
    await this.options.audit({ event: "connect", sessionId, targetId: target.id });
    this.options.send({ type: "connected", sessionId, targetId: target.id });
    return sessionId;
  }

  async input(sessionId: string, data: string): Promise<void> {
    await this.inputMessage({ type: "input", sessionId, data });
  }

  async inputMessage(message: Extract<ClientTerminalMessage, { type: "input" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    session.commandBuffer += message.data;
    if (message.data.includes("\n") || message.data.includes("\r")) {
      const command = session.commandBuffer.trim();
      session.commandBuffer = "";
      if (command) {
        const guard = checkCommandAllowed(command, {
          guardMode: session.target.guardMode,
          strictAllowlist: session.target.strictAllowlist,
        });
        if (!guard.allowed) {
          await this.options.audit({ event: "blocked", sessionId: message.sessionId, targetId: session.target.id, command, reason: guard.reason ?? "blocked" });
          this.options.send({ type: "blocked", sessionId: message.sessionId, command, reason: guard.reason ?? "blocked" });
          return;
        }
        await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command });
        const projectContext = message.projectContext;
        if (projectContext) {
          setTimeout(() => void this.refreshGitStatus(message.sessionId, projectContext), 1200);
        }
      }
    }
    session.channel.write(message.data);
  }

  async refreshGitStatus(sessionId: string, projectContext: TerminalProjectContext): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const statuses = await Promise.all(projectContext.branch.repos.map(async (repo) => {
      const repoDir = joinRemotePath(projectContext.project.mainPath, repo.repoPath);
      const command = `cd ${shellPath(repoDir)} && git status --short --branch`;
      try {
        const result = await this.options.runRemoteCommand(session.target, command);
        return {
          repoName: repo.repoName,
          repoPath: repo.repoPath,
          branchName: repo.branchName,
          status: result.code === 0 ? "success" as const : "failed" as const,
          output: [result.stdout, result.stderr].filter(Boolean).join("\n").replace(/\s+$/, "") || `exit ${result.code}`,
        };
      } catch (error) {
        return {
          repoName: repo.repoName,
          repoPath: repo.repoPath,
          branchName: repo.branchName,
          status: "failed" as const,
          output: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    this.options.send({ type: "gitStatus", sessionId, statuses });
  }

  async uploadFile(message: Extract<ClientTerminalMessage, { type: "uploadFile" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const directory = uploadDirectory(message.projectContext, message.uploadKind);
    const remotePath = joinRemotePath(directory, sanitizeFileName(message.fileName));
    const content = Buffer.from(message.contentBase64, "base64");
    await this.options.uploadRemoteFile(session.target, { remotePath, content });
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command: `upload ${message.uploadKind} ${remotePath}` });
    this.options.send({ type: "status", sessionId: message.sessionId, status: "info", message: `上传完成：${remotePath}` });
    await this.refreshGitStatus(message.sessionId, message.projectContext);
  }

  async packageRemoteFiles(message: Extract<ClientTerminalMessage, { type: "packageFiles" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const scriptDir = joinRemotePath(message.projectContext.project.mainPath, message.projectContext.project.scriptPath);
    const fileName = `${message.projectContext.project.projectName}-${message.projectContext.branch.name}-script-files.zip`;
    const remoteZip = `/tmp/${Date.now()}-${fileName}`;
    const command = [
      `cd ${shellPath(scriptDir)}`,
      `zip -q -j ${shellPath(remoteZip)} types.hal VHAL_SIGNAL_CHECKLIST_s.xls com.bosch.cm.platform.vehicle.proto CHERY_8255_VHAL_SIGNAL_V*.xls`,
      `printf '\\n__REMOTE_ZIP_BASE64_BEGIN__\\n'`,
      `base64 ${shellPath(remoteZip)}`,
      `printf '\\n__REMOTE_ZIP_BASE64_END__\\n'`,
      `rm -f ${shellPath(remoteZip)}`,
    ].join(" && ");
    const result = await this.options.runRemoteCommand(session.target, command);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "远端打包失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command: `package ${scriptDir}` });
    this.options.send({
      type: "fileDownload",
      sessionId: message.sessionId,
      fileName,
      mimeType: "application/zip",
      contentBase64: extractMarkedBase64(result.stdout),
    });
  }

  async packageChecklist(message: Extract<ClientTerminalMessage, { type: "packageChecklist" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const scriptDir = joinRemotePath(message.projectContext.project.mainPath, message.projectContext.project.scriptPath);
    const fileName = "VHAL_SIGNAL_CHECKLIST_s.xls";
    const remoteFile = joinRemotePath(scriptDir, fileName);
    const command = [
      `printf '\\n__REMOTE_ZIP_BASE64_BEGIN__\\n'`,
      `base64 ${shellPath(remoteFile)}`,
      `printf '\\n__REMOTE_ZIP_BASE64_END__\\n'`,
    ].join(" && ");
    const result = await this.options.runRemoteCommand(session.target, command);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "远端下载 checklist 失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command: `packageChecklist ${remoteFile}` });
    this.options.send({
      type: "fileDownload",
      sessionId: message.sessionId,
      fileName,
      mimeType: "application/vnd.ms-excel",
      contentBase64: extractMarkedBase64(result.stdout),
    });
  }

  async listSignalConfigFiles(message: Extract<ClientTerminalMessage, { type: "signalConfigFiles" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const configs = await Promise.all(message.projectContext.branch.repos.map(async (repo) => {
      const repoDir = joinRemotePath(message.projectContext.project.mainPath, repo.repoPath);
      const command = `cd ${shellPath(repoDir)} && if [ -d tools/json ]; then find tools/json -maxdepth 1 -type f -name 'config_*.json' | sort; fi`;
      try {
        const result = await this.options.runRemoteCommand(session.target, command);
        const files = result.stdout
          .split("\n")
          .map(toSignalConfigFile)
          .filter((file): file is TerminalSignalConfigFile => Boolean(file));
        return {
          repoName: repo.repoName,
          repoPath: repo.repoPath,
          branchName: repo.branchName,
          status: result.code === 0 ? "success" as const : "failed" as const,
          files,
          error: result.code === 0 ? undefined : (result.stderr || result.stdout || `exit ${result.code}`),
        };
      } catch (error) {
        return {
          repoName: repo.repoName,
          repoPath: repo.repoPath,
          branchName: repo.branchName,
          status: "failed" as const,
          files: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    this.options.send({ type: "signalConfigFiles", sessionId: message.sessionId, configs });
  }

  async checkoutSignalConfigFiles(message: Extract<ClientTerminalMessage, { type: "checkoutSignalConfigFiles" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    let total = 0;
    for (const repo of message.repos) {
      const files = repo.files.filter((file) => /^tools\/json\/config_[^/]+\.json$/.test(file));
      if (files.length === 0) continue;
      const repoDir = joinRemotePath(message.projectContext.project.mainPath, repo.repoPath);
      const quotedFiles = files.map(file => shellQuote(file)).join(" ");
      const command = `cd ${shellPath(repoDir)} && git checkout -- ${quotedFiles}`;
      const result = await this.options.runRemoteCommand(session.target, command);
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || "配置文件 checkout 执行失败");
      }
      total += files.length;
      await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command });
    }
    this.options.send({ type: "status", sessionId: message.sessionId, status: "info", message: `配置完成：已 checkout ${total} 个未选配置文件` });
    await this.refreshGitStatus(message.sessionId, message.projectContext);
    await this.listSignalConfigFiles({ type: "signalConfigFiles", sessionId: message.sessionId, projectContext: message.projectContext });
  }

  async gitAdd(message: Extract<ClientTerminalMessage, { type: "gitAdd" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const repoDir = joinRemotePath(message.projectContext.project.mainPath, message.repoPath);
    const quotedFiles = message.files.map(file => shellQuote(file)).join(" ");
    const command = `cd ${shellPath(repoDir)} && git add ${quotedFiles}`;
    const result = await this.options.runRemoteCommand(session.target, command);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "git add 执行失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command });
    this.options.send({ type: "status", sessionId: message.sessionId, status: "info", message: `git add 成功：已暂存 ${message.files.length} 个文件` });
    await this.refreshGitStatus(message.sessionId, message.projectContext);
  }

  async gitCheckout(message: Extract<ClientTerminalMessage, { type: "gitCheckout" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const repoDir = joinRemotePath(message.projectContext.project.mainPath, message.repoPath);
    const fileCommands = message.files.map(file => {
      const qFile = shellQuote(file);
      return `if git ls-files --error-unmatch ${qFile} >/dev/null 2>&1; then git checkout -- ${qFile}; else rm -rf ${qFile}; fi`;
    }).join(" ; ");
    const command = `cd ${shellPath(repoDir)} && ( ${fileCommands} )`;
    const result = await this.options.runRemoteCommand(session.target, command);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "git checkout 执行失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command });
    this.options.send({ type: "status", sessionId: message.sessionId, status: "info", message: `git checkout 成功：已撤销/删除 ${message.files.length} 个文件` });
    await this.refreshGitStatus(message.sessionId, message.projectContext);
  }

  async gitReset(message: Extract<ClientTerminalMessage, { type: "gitReset" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const repoDir = joinRemotePath(message.projectContext.project.mainPath, message.repoPath);
    const quotedFiles = message.files.map(file => shellQuote(file)).join(" ");
    const command = `cd ${shellPath(repoDir)} && git reset HEAD ${quotedFiles}`;
    const result = await this.options.runRemoteCommand(session.target, command);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "git reset 执行失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command });
    this.options.send({ type: "status", sessionId: message.sessionId, status: "info", message: `git reset 成功：已撤出暂存区 ${message.files.length} 个文件` });
    await this.refreshGitStatus(message.sessionId, message.projectContext);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.channel.setWindow(rows, cols);
  }

  disconnect(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.channel.close();
    void this.closeSession(sessionId, reason);
  }

  disconnectAll(reason: string): void {
    for (const sessionId of Array.from(this.sessions.keys())) {
      this.disconnect(sessionId, reason);
    }
  }

  private async closeSession(sessionId: string, reason: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await this.options.audit({ event: "disconnect", sessionId, targetId: session.target.id, reason });
    this.options.send({ type: "closed", sessionId, reason });
  }
}
