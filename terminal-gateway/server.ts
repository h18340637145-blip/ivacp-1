/**
 * 远程终端 WebSocket 网关（独立进程：npm run terminal:gateway）。
 * 浏览器 xterm ⇄ WS ⇄ ssh2 shell；命令输入经 command-guard 校验并写入审计日志（输出不落盘）。
 * 握手时校验 IVACP 登录 Cookie，仅管理员可连接（REMOTE_SHELL_GATEWAY_REQUIRE_AUTH=false 可关闭，仅限本地调试）。
 */
import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { Client, type ConnectConfig } from "ssh2";
import { WebSocketServer } from "ws";
import { hasRole } from "../src/domain/auth/permissions";
import { AUTH_SESSION_COOKIE, verifySessionToken, type AuthSession } from "../src/server/auth/session";
import { loadRemoteShellTargets } from "../src/server/terminal/config";
import type { ClientTerminalMessage, RemoteShellTarget } from "../src/domain/terminal/types";
import { appendAuditEvent } from "./audit-log";
import { TerminalSessionManager, type TerminalChannel } from "./session-manager";

loadEnvConfig(process.cwd());

const port = Number(process.env.REMOTE_SHELL_GATEWAY_PORT ?? "39222");
const host = process.env.REMOTE_SHELL_GATEWAY_HOST ?? "0.0.0.0";
const auditPath = process.env.REMOTE_SHELL_AUDIT_LOG_PATH ?? "log/remote-shell-audit.jsonl";
const requireAuth = process.env.REMOTE_SHELL_GATEWAY_REQUIRE_AUTH !== "false";
const targets = loadRemoteShellTargets();

function readSession(request: IncomingMessage): AuthSession | null {
  const match = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_SESSION_COOKIE}=`));
  return verifySessionToken(match ? decodeURIComponent(match.slice(AUTH_SESSION_COOKIE.length + 1)) : null);
}

function formatSshError(error: unknown, target: RemoteShellTarget): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/All configured authentication methods failed|Permission denied/i.test(message)) {
    return new Error(
      `SSH 认证失败：${target.username}@${target.host} 不接受当前配置的认证材料，请检查 password、privateKeyPath、privateKeyPassphrase 或 agentSocket`,
    );
  }
  return error instanceof Error ? error : new Error(message);
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

async function buildConnectConfig(target: RemoteShellTarget): Promise<ConnectConfig> {
  const privateKey = target.privateKeyPath ? await fs.readFile(target.privateKeyPath, "utf8") : undefined;
  return {
    host: target.host,
    port: target.port,
    username: target.username,
    privateKey,
    passphrase: target.privateKeyPassphrase,
    password: target.password,
    agent: target.agentSocket,
    readyTimeout: 15_000,
  };
}

async function connectSsh(target: RemoteShellTarget, size: { cols: number; rows: number }): Promise<TerminalChannel> {
  const connectConfig = await buildConnectConfig(target);
  const client = new Client();
  return new Promise((resolve, reject) => {
    client
      .on("ready", () => {
        client.shell({ cols: size.cols, rows: size.rows, term: "xterm-256color" }, (err, stream) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }
          stream.on("close", () => client.end());
          const channel: TerminalChannel = {
            write: (data) => stream.write(data),
            setWindow: (rows, cols) => stream.setWindow(rows, cols, 0, 0),
            close: () => stream.end(),
            on: (event, handler) => {
              stream.on(event, handler);
              return channel;
            },
          };
          resolve(channel);
        });
      })
      .on("error", (error) => reject(formatSshError(error, target)))
      .connect(connectConfig);
  });
}

async function runSshCommand(target: RemoteShellTarget, command: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const connectConfig = await buildConnectConfig(target);
  const client = new Client();
  return new Promise((resolve, reject) => {
    let settled = false;
    client
      .on("ready", () => {
        client.exec(command, (err, stream) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }
          let stdout = "";
          let stderr = "";
          stream.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
          });
          stream.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });
          stream.on("close", (code: number | null) => {
            settled = true;
            client.end();
            resolve({ stdout, stderr, code });
          });
        });
      })
      .on("error", (error) => {
        if (!settled) reject(formatSshError(error, target));
      })
      .connect(connectConfig);
  });
}

async function uploadRemoteFile(target: RemoteShellTarget, file: { remotePath: string; content: Buffer }): Promise<void> {
  const connectConfig = await buildConnectConfig(target);
  const client = new Client();
  const remoteDir = path.posix.dirname(file.remotePath);
  const command = `mkdir -p ${shellPath(remoteDir)} && cat > ${shellPath(file.remotePath)}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    client
      .on("ready", () => {
        client.exec(command, (err, stream) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }
          let stderr = "";
          stream.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });
          stream.on("close", (code: number | null) => {
            settled = true;
            client.end();
            if (code === 0) resolve();
            else reject(new Error(stderr || `上传失败，远端命令退出码 ${code}`));
          });
          stream.write(file.content);
          stream.end();
        });
      })
      .on("error", (error) => {
        if (!settled) reject(formatSshError(error, target));
      })
      .connect(connectConfig);
  });
}

const wss = new WebSocketServer({
  host,
  port,
  verifyClient: (info, done) => {
    if (!requireAuth) return done(true);
    const session = readSession(info.req);
    if (!session) return done(false, 401, "未登录或登录已过期");
    if (!hasRole(session, "admin")) return done(false, 403, "仅管理员可使用远程终端");
    done(true);
  },
});
console.log(
  `[terminal-gateway] listening on ws://${host}:${port}, targets=${targets.length}, auth=${requireAuth ? "admin" : "disabled"}`,
);

wss.on("connection", (socket, request) => {
  const operator = requireAuth ? readSession(request)?.username : undefined;
  if (operator) void appendAuditEvent(auditPath, { event: "gateway_connected", operator });
  const manager = new TerminalSessionManager({
    targets,
    connectSsh,
    runRemoteCommand: runSshCommand,
    uploadRemoteFile,
    send: (message) => socket.send(JSON.stringify(message)),
    audit: (event) => appendAuditEvent(auditPath, { ...event, ...(operator ? { operator } : {}) }),
  });

  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientTerminalMessage;
      if (message.type === "connect") {
        try {
          await manager.connect(message);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await appendAuditEvent(auditPath, { event: "connect_failed", targetId: message.targetId, reason, operator });
          socket.send(JSON.stringify({ type: "status", status: "error", message: reason }));
        }
        return;
      }
      if (message.type === "input") await manager.inputMessage(message);
      if (message.type === "resize") manager.resize(message.sessionId, message.cols, message.rows);
      if (message.type === "disconnect") manager.disconnect(message.sessionId, "client_disconnect");
      if (message.type === "projectGitStatus") await manager.refreshGitStatus(message.sessionId, message.projectContext);
      if (message.type === "uploadFile") await manager.uploadFile(message);
      if (message.type === "packageFiles") await manager.packageRemoteFiles(message);
      if (message.type === "packageChecklist") await manager.packageChecklist(message);
      if (message.type === "signalConfigFiles") await manager.listSignalConfigFiles(message);
      if (message.type === "checkoutSignalConfigFiles") await manager.checkoutSignalConfigFiles(message);
      if (message.type === "gitAdd") await manager.gitAdd(message);
      if (message.type === "gitCheckout") await manager.gitCheckout(message);
      if (message.type === "gitReset") await manager.gitReset(message);
    } catch (error) {
      socket.send(JSON.stringify({ type: "status", status: "error", message: error instanceof Error ? error.message : String(error) }));
    }
  });

  socket.on("close", () => manager.disconnectAll("browser_closed"));
});
