import { runTerminalSync } from "../src/server/terminal/sync/runner";
import { createGitSyncReader } from "../src/server/terminal/sync/remote";
import type { TerminalSyncProgress } from "../src/domain/terminal/sync";
import { randomUUID } from "node:crypto";
import { terminalContextKey } from "../src/domain/terminal/context";
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

export interface RemoteCommandResult { stdout: string; stderr: string; code: number | null }
export interface TerminalChannel {
  runCommand?(command: string): Promise<RemoteCommandResult>;
  uploadFile?(file: { remotePath: string; content: Buffer }): Promise<void>;
  write(data: string): void;
  setWindow(rows: number, cols: number): void;
  close(): void;
  on(event: "data", handler: (data: Buffer | string) => void): this;
  on(event: "close", handler: () => void): this;
}

interface SessionManagerOptions {
  canSync?: () => boolean;
  syncRoot?: string;
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

function validateRepoFiles(context: TerminalProjectContext, repoPath: string, files: string[]): void {
  if (!context.branch.repos.some(repo => repo.repoPath === repoPath)) throw new Error("仓库不属于当前项目分支");
  if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== "string" || !file || file.startsWith("/") || file.includes("\\") || /[\0\r\n]/.test(file) || file.split("/").includes("..") || file.split("/").every(part => part === "." || !part))) {
    throw new Error("文件路径必须是仓库内的具体相对文件，且列表不能为空");
  }
}

function updateCommandBuffer(current: string, data: string): string {
  for (const char of data) {
    if (char === "\x03" || char === "\x15") current = "";
    else if (char === "\b" || char === "\x7f") current = current.slice(0, -1);
    else current += char;
  }
  return current;
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
  private sessions = new Map<string, { target: RemoteShellTarget; channel: TerminalChannel; commandBuffer: string; inputTail: Promise<void>; refreshTimer?: ReturnType<typeof setTimeout>; refreshing?: boolean; refreshContext?: TerminalProjectContext }>();
  private disposed = false;
  private syncControllers = new Map<string, AbortController>();
  private targets: Map<string, RemoteShellTarget>;

  constructor(private options: SessionManagerOptions) {
    this.targets = new Map(options.targets.map((target) => [target.id, target]));
  }

  async connect(message: Extract<ClientTerminalMessage, { type: "connect" }>): Promise<string> {
    if (this.disposed) throw new Error("终端连接已关闭");
    const target = this.targets.get(message.targetId);
    if (!target) throw new Error(`Unknown target: ${message.targetId}`);
    const sessionId = randomUUID();
    const channel = await this.options.connectSsh(target, { cols: message.cols, rows: message.rows });
    if (this.disposed) { channel.close(); throw new Error("终端连接已关闭"); }
    this.sessions.set(sessionId, { target, channel, commandBuffer: "", inputTail: Promise.resolve() });
    let connected = false;
    let initialOutput = "";
    channel.on("data", (data) => {
      if (!this.sessions.has(sessionId)) return;
      if (!connected) {
        // Auth/audit may still be pending; the browser rejects output before connected.
        initialOutput = (initialOutput + data.toString()).slice(-256 * 1024);
      } else this.options.send({ type: "output", sessionId, data: data.toString() });
    });
    channel.on("close", () => { void this.closeSession(sessionId, "remote_closed").catch(() => {}); });
    try { await this.options.audit({ event: "connect", sessionId, targetId: target.id }); }
    catch (error) { this.sessions.delete(sessionId); channel.close(); throw error; }
    if (!this.sessions.has(sessionId)) throw new Error("终端连接已关闭");
    this.options.send({ type: "connected", sessionId, targetId: target.id });
    connected = true;
    if (initialOutput) this.options.send({ type: "output", sessionId, data: initialOutput });
    return sessionId;
  }

  async syncProjects(message: Extract<ClientTerminalMessage, { type: "syncProjects" }>): Promise<void> {
    if (!this.options.canSync?.()) throw new Error("仅已登录管理员可启动同步");
    const session = this.sessions.get(message.sessionId);
    if (!session || !session.channel.runCommand) throw new Error("SSH 会话不可用，请重新连接");
    if (typeof message.requestId !== "string" || !message.requestId || message.requestId.length > 200) throw new Error("同步请求标识无效");
    if (this.syncControllers.has(message.sessionId)) throw new Error("该会话已有同步任务正在运行");
    const controller = new AbortController();
    this.syncControllers.set(message.sessionId, controller);
    let latest: TerminalSyncProgress | undefined;
    const sendProgress = (progress: TerminalSyncProgress) => {
      latest = progress;
      if (this.sessions.get(message.sessionId) === session)
        this.options.send({ type: "syncProgress", sessionId: message.sessionId, requestId: message.requestId, progress });
    };
    const heartbeat = setInterval(() => { if (latest) sendProgress({ ...latest, branch: undefined }); }, 5000);
    try {
      await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command: "syncProjects: all configured local branches (read-only Git)" });
      const reader = createGitSyncReader(async command => {
        controller.signal.throwIfAborted();
        const result = await session.channel.runCommand!(command);
        controller.signal.throwIfAborted();
        return result;
      });
      const report = await runTerminalSync({ root: this.options.syncRoot, targetId: session.target.id, reader, signal: controller.signal, progress: sendProgress });
      if (this.sessions.get(message.sessionId) === session)
        this.options.send({ type: "syncResult", sessionId: message.sessionId, requestId: message.requestId, report });
    } finally {
      clearInterval(heartbeat);
      this.syncControllers.delete(message.sessionId);
    }
  }

  async input(sessionId: string, data: string): Promise<void> {
    await this.inputMessage({ type: "input", sessionId, data });
  }

  async inputMessage(message: Extract<ClientTerminalMessage, { type: "input" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const pending = session.inputTail.catch(() => {}).then(async () => {
      if (this.sessions.get(message.sessionId) !== session) return;
      // 每个换行独立校验，不把多行粘贴当成一个shell命令。
      for (const part of message.data.match(/[^\r\n]+|\r\n|\r|\n/g) ?? []) {
        if (this.sessions.get(message.sessionId) !== session) return;
        if (!/^[\r\n]+$/.test(part)) {
          session.commandBuffer = updateCommandBuffer(session.commandBuffer, part);
          session.channel.write(part);
          continue;
        }
        const command = session.commandBuffer.trim();
        session.commandBuffer = "";
        if (command) {
          const guard = checkCommandAllowed(command, { guardMode: session.target.guardMode, strictAllowlist: session.target.strictAllowlist });
          if (!guard.allowed) {
            // 前缀可能已实时写入PTY；取消当前行，不能残留给下一次Enter。
            session.channel.write("\x03");
            await this.options.audit({ event: "blocked", sessionId: message.sessionId, targetId: session.target.id, command, reason: guard.reason ?? "blocked" });
            this.options.send({ type: "blocked", sessionId: message.sessionId, command, reason: guard.reason ?? "blocked" });
            continue;
          }
          try { await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command }); }
          catch (error) { session.channel.write("\x03"); throw error; }
          if (message.projectContext) {
            const context = message.projectContext;
            session.refreshContext = context;
            clearTimeout(session.refreshTimer);
            session.refreshTimer = setTimeout(() => {
              session.refreshTimer = undefined;
              void this.autoRefresh(message.sessionId);
            }, 1200);
          }
        }
        if (this.sessions.get(message.sessionId) === session) session.channel.write(part);
      }
    });
    session.inputTail = pending;
    return pending;
  }

  private async autoRefresh(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.refreshing || !session.refreshContext) return;
    const context = session.refreshContext;
    session.refreshContext = undefined;
    session.refreshing = true;
    try { await this.refreshGitStatus(sessionId, context); }
    catch { /* Individual repo failures are reported in gitStatus. */ }
    finally {
      session.refreshing = false;
      if (this.sessions.has(sessionId) && session.refreshContext && !session.refreshTimer)
        session.refreshTimer = setTimeout(() => { session.refreshTimer = undefined; void this.autoRefresh(sessionId); }, 1200);
    }
  }

  async refreshGitStatus(sessionId: string, projectContext: TerminalProjectContext, requestId?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const statuses = await Promise.all(projectContext.branch.repos.map(async (repo) => {
      const repoDir = joinRemotePath(projectContext.project.mainPath, repo.repoPath);
      const command = `cd ${shellPath(repoDir)} && git status --short --branch`;
      try {
        const result = await (session.channel.runCommand ? session.channel.runCommand(command) : this.options.runRemoteCommand(session.target, command));
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
    if (this.sessions.has(sessionId)) this.options.send({ type: "gitStatus", sessionId, statuses, requestId, contextKey: terminalContextKey(projectContext) });
  }

  async uploadFile(message: Extract<ClientTerminalMessage, { type: "uploadFile" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    const directory = uploadDirectory(message.projectContext, message.uploadKind);
    const remotePath = joinRemotePath(directory, sanitizeFileName(message.fileName));
    const content = Buffer.from(message.contentBase64, "base64");
    await (session.channel.uploadFile ? session.channel.uploadFile({ remotePath, content }) : this.options.uploadRemoteFile(session.target, { remotePath, content }));
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command: `upload ${message.uploadKind} ${remotePath}` });
    this.options.send({ type: "status", sessionId: message.sessionId, requestId: message.requestId, contextKey: terminalContextKey(message.projectContext), status: "info", message: `上传完成：${remotePath}` });
    await this.refreshGitStatus(message.sessionId, message.projectContext, message.requestId);
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
    const result = await (session.channel.runCommand ? session.channel.runCommand(command) : this.options.runRemoteCommand(session.target, command));
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "远端打包失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command: `package ${scriptDir}` });
    this.options.send({
      type: "fileDownload",
      sessionId: message.sessionId,
      requestId: message.requestId,
      contextKey: terminalContextKey(message.projectContext),
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
    const result = await (session.channel.runCommand ? session.channel.runCommand(command) : this.options.runRemoteCommand(session.target, command));
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "远端下载 checklist 失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command: `packageChecklist ${remoteFile}` });
    this.options.send({
      type: "fileDownload",
      sessionId: message.sessionId,
      requestId: message.requestId,
      contextKey: terminalContextKey(message.projectContext),
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
        const result = await (session.channel.runCommand ? session.channel.runCommand(command) : this.options.runRemoteCommand(session.target, command));
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
    if (this.sessions.has(message.sessionId)) this.options.send({ type: "signalConfigFiles", sessionId: message.sessionId, configs, requestId: message.requestId, contextKey: terminalContextKey(message.projectContext) });
  }

  async checkoutSignalConfigFiles(message: Extract<ClientTerminalMessage, { type: "checkoutSignalConfigFiles" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    let total = 0;
    for (const repo of message.repos) {
      validateRepoFiles(message.projectContext, repo.repoPath, repo.files);
      const files = repo.files.filter((file) => /^tools\/json\/config_[^/]+\.json$/.test(file));
      if (files.length === 0) continue;
      const repoDir = joinRemotePath(message.projectContext.project.mainPath, repo.repoPath);
      const quotedFiles = files.map(file => shellQuote(file)).join(" ");
      const command = `cd ${shellPath(repoDir)} && git --literal-pathspecs checkout -- ${quotedFiles}`;
      const result = await (session.channel.runCommand ? session.channel.runCommand(command) : this.options.runRemoteCommand(session.target, command));
      if (result.code !== 0) {
        throw new Error(result.stderr || result.stdout || "配置文件 checkout 执行失败");
      }
      total += files.length;
      await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command });
    }
    this.options.send({ type: "status", sessionId: message.sessionId, requestId: message.requestId, contextKey: terminalContextKey(message.projectContext), status: "info", message: `配置完成：已 checkout ${total} 个未选配置文件` });
    await this.refreshGitStatus(message.sessionId, message.projectContext, message.requestId);
    await this.listSignalConfigFiles({ type: "signalConfigFiles", sessionId: message.sessionId, projectContext: message.projectContext, requestId: message.requestId });
  }

  async gitAdd(message: Extract<ClientTerminalMessage, { type: "gitAdd" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    validateRepoFiles(message.projectContext, message.repoPath, message.files);
    const repoDir = joinRemotePath(message.projectContext.project.mainPath, message.repoPath);
    const quotedFiles = message.files.map(file => shellQuote(file)).join(" ");
    const command = `cd ${shellPath(repoDir)} && git --literal-pathspecs add -- ${quotedFiles}`;
    const result = await (session.channel.runCommand ? session.channel.runCommand(command) : this.options.runRemoteCommand(session.target, command));
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "git add 执行失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command });
    this.options.send({ type: "status", sessionId: message.sessionId, requestId: message.requestId, contextKey: terminalContextKey(message.projectContext), status: "info", message: `git add 成功：已暂存 ${message.files.length} 个文件` });
    await this.refreshGitStatus(message.sessionId, message.projectContext, message.requestId);
  }

  async gitCheckout(message: Extract<ClientTerminalMessage, { type: "gitCheckout" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    validateRepoFiles(message.projectContext, message.repoPath, message.files);
    const repoDir = joinRemotePath(message.projectContext.project.mainPath, message.repoPath);
    const fileCommands = message.files.map(file => {
      const qFile = shellQuote(file);
      return `if git --literal-pathspecs ls-files --error-unmatch -- ${qFile} >/dev/null 2>&1; then git --literal-pathspecs checkout -- ${qFile}; else rm -rf -- ${qFile}; fi`;
    }).join(" && ");
    const command = `cd ${shellPath(repoDir)} && ( ${fileCommands} )`;
    const result = await (session.channel.runCommand ? session.channel.runCommand(command) : this.options.runRemoteCommand(session.target, command));
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "git checkout 执行失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command });
    this.options.send({ type: "status", sessionId: message.sessionId, requestId: message.requestId, contextKey: terminalContextKey(message.projectContext), status: "info", message: `git checkout 成功：已撤销/删除 ${message.files.length} 个文件` });
    await this.refreshGitStatus(message.sessionId, message.projectContext, message.requestId);
  }

  async gitReset(message: Extract<ClientTerminalMessage, { type: "gitReset" }>): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    validateRepoFiles(message.projectContext, message.repoPath, message.files);
    const repoDir = joinRemotePath(message.projectContext.project.mainPath, message.repoPath);
    const quotedFiles = message.files.map(file => shellQuote(file)).join(" ");
    const command = `cd ${shellPath(repoDir)} && git --literal-pathspecs reset HEAD -- ${quotedFiles}`;
    const result = await (session.channel.runCommand ? session.channel.runCommand(command) : this.options.runRemoteCommand(session.target, command));
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "git reset 执行失败");
    }
    await this.options.audit({ event: "command", sessionId: message.sessionId, targetId: session.target.id, command });
    this.options.send({ type: "status", sessionId: message.sessionId, requestId: message.requestId, contextKey: terminalContextKey(message.projectContext), status: "info", message: `git reset 成功：已撤出暂存区 ${message.files.length} 个文件` });
    await this.refreshGitStatus(message.sessionId, message.projectContext, message.requestId);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.channel.setWindow(rows, cols);
  }

  disconnect(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    void this.closeSession(sessionId, reason).catch(() => {});
    session.channel.close();
  }

  disconnectAll(reason: string): void {
    this.disposed = true;
    for (const sessionId of Array.from(this.sessions.keys())) {
      this.disconnect(sessionId, reason);
    }
  }

  private async closeSession(sessionId: string, reason: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.syncControllers.get(sessionId)?.abort(new Error("SSH 连接已断开，同步已停止"));
    clearTimeout(session.refreshTimer);
    await this.options.audit({ event: "disconnect", sessionId, targetId: session.target.id, reason });
    this.options.send({ type: "closed", sessionId, reason });
  }
}
