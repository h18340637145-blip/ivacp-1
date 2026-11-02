/**
 * 远程终端 WebSocket 网关（独立进程：npm run terminal:gateway）。
 * 浏览器 xterm ⇄ WS ⇄ ssh2 shell；命令输入经 command-guard 校验并写入审计日志（输出不落盘）。
 * 握手时校验 IVACP 登录 Cookie，任意已登录用户均可连接（REMOTE_SHELL_GATEWAY_REQUIRE_AUTH=false 可关闭，仅限本地调试）。
 */
import type { IncomingMessage } from "node:http";
import { loadEnvConfig } from "@next/env";
import { WebSocketServer } from "ws";
import { AUTH_SESSION_COOKIE, verifySessionToken, type AuthSession } from "../src/server/auth/session";
import { loadRemoteShellTargets } from "../src/server/terminal/config";
import type { ClientTerminalMessage } from "../src/domain/terminal/types";
import { connectSsh } from "./ssh-connection";
import { appendAuditEvent } from "./audit-log";
import { TerminalSessionManager } from "./session-manager";

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

const wss = new WebSocketServer({
  host,
  port,
  verifyClient: (info, done) => {
    if (!requireAuth) return done(true);
    const session = readSession(info.req);
    if (!session) return done(false, 401, "未登录或登录已过期");
    done(true);
  },
});
console.log(
  `[terminal-gateway] listening on ws://${host}:${port}, targets=${targets.length}, auth=${requireAuth ? "login" : "disabled"}`,
);

wss.on("connection", (socket, request) => {
  const operator = requireAuth ? readSession(request)?.username : undefined;
  if (operator) void appendAuditEvent(auditPath, { event: "gateway_connected", operator });
  const manager = new TerminalSessionManager({
    targets,
    canSync: () => { const current = readSession(request); return !requireAuth || !!current; },
    connectSsh,
    // Real sessions provide exec/upload on their authenticated channel.
    runRemoteCommand: async () => { throw new Error("SSH 操作通道不可用"); },
    uploadRemoteFile: async () => { throw new Error("SSH 上传通道不可用"); },
    send: (message) => { if (socket.readyState === 1) socket.send(JSON.stringify(message)); },
    audit: (event) => appendAuditEvent(auditPath, { ...event, ...(operator ? { operator } : {}) }),
  });

  socket.on("message", async (raw) => {
    let message: ClientTerminalMessage | undefined;
    try {
      message = JSON.parse(raw.toString()) as ClientTerminalMessage;
      if (message.type === "connect") {
        try {
          await manager.connect(message);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await appendAuditEvent(auditPath, { event: "connect_failed", targetId: message.targetId, reason, operator });
          if (socket.readyState === 1) socket.send(JSON.stringify({ type: "status", requestId: message.requestId, status: "error", message: reason }));
        }
        return;
      }
      if (message.type === "syncProjects") await manager.syncProjects(message);
      if (message.type === "input") await manager.inputMessage(message);
      if (message.type === "resize") manager.resize(message.sessionId, message.cols, message.rows);
      if (message.type === "disconnect") manager.disconnect(message.sessionId, "client_disconnect");
      if (message.type === "projectGitStatus") await manager.refreshGitStatus(message.sessionId, message.projectContext, message.requestId);
      if (message.type === "uploadFile") await manager.uploadFile(message);
      if (message.type === "packageFiles") await manager.packageRemoteFiles(message);
      if (message.type === "packageChecklist") await manager.packageChecklist(message);
      if (message.type === "signalConfigFiles") await manager.listSignalConfigFiles(message);
      if (message.type === "checkoutSignalConfigFiles") await manager.checkoutSignalConfigFiles(message);
      if (message.type === "gitAdd") await manager.gitAdd(message);
      if (message.type === "gitCheckout") await manager.gitCheckout(message);
      if (message.type === "gitReset") await manager.gitReset(message);
    } catch (error) {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "status", requestId: message?.requestId, status: "error", message: error instanceof Error ? error.message : String(error) }));
    }
  });

  socket.on("close", () => manager.disconnectAll("browser_closed"));
});
