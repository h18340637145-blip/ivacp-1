import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { Client, type ClientChannel } from "ssh2";
import type { RemoteShellTarget } from "../src/domain/terminal/types";
import type { RemoteCommandResult, TerminalChannel } from "./session-manager";

function shellPath(value: string): string {
  const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
  return value.startsWith("~/") ? `~/${quote(value.slice(2))}` : quote(value);
}
function sshError(error: Error): Error {
  return /All configured authentication methods failed|Permission denied/i.test(error.message)
    ? new Error("SSH 认证失败，请检查服务端的密码、私钥或 ssh-agent 配置。") : error;
}

/** One authenticated SSH transport per terminal; exec channels never write into its PTY. */
export async function connectSsh(target: RemoteShellTarget, size: { cols: number; rows: number }, commandTimeout = 20_000): Promise<TerminalChannel> {
  const privateKey = target.privateKeyPath ? await fs.readFile(target.privateKeyPath, "utf8") : undefined;
  const client = new Client();
  const events = new EventEmitter();
  const decoder = new StringDecoder("utf8");
  const operations = new Set<(error: Error) => void>();
  let shell: ClientChannel | undefined;
  let closed = false;
  let ready = false;
  let rejectConnect: (error: Error) => void = () => {};
  const close = (error = new Error("SSH 连接已关闭")) => {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer);
    rejectConnect(error);
    for (const cancel of operations) cancel(error);
    operations.clear();
    shell?.destroy();
    client.destroy();
    if (ready) events.emit("close");
  };
  const connectTimer = setTimeout(() => close(new Error("SSH 连接或终端初始化超时")), 18_000);
  function execute(command: string, content?: Buffer): Promise<RemoteCommandResult> {
    if (closed) return Promise.reject(new Error("SSH 连接已关闭"));
    return new Promise((resolve, reject) => {
      let stream: ClientChannel | undefined;
      let settled = false;
      const stdout = new StringDecoder("utf8"), stderr = new StringDecoder("utf8");
      let out = "", err = "";
      let bytes = 0;
      const finish = (error?: Error, code: number | null = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        operations.delete(cancel);
        if (error) { stream?.close(); stream?.destroy(); reject(error); }
        else resolve({ stdout: out + stdout.end(), stderr: err + stderr.end(), code });
      };
      const cancel = (error: Error) => finish(error);
      operations.add(cancel);
      const timer = setTimeout(() => finish(new Error("远端操作超时，已关闭操作通道；请核对远端状态后重试。")), commandTimeout);
      client.exec(command, (error, channel) => {
        if (error) { finish(sshError(error)); return; }
        stream = channel;
        if (settled || closed) { channel.close(); channel.destroy(); return; }
        const collect = (data: Buffer, isError: boolean) => {
          bytes += data.length;
          if (bytes > 40 * 1024 * 1024) { finish(new Error("远端输出超过 40 MB，请缩小操作范围。")); return; }
          if (isError) err += stderr.write(data); else out += stdout.write(data);
        };
        channel.on("data", (data: Buffer) => collect(data, false));
        channel.stderr.on("data", (data: Buffer) => collect(data, true));
        channel.on("error", (error: Error) => finish(error));
        channel.on("close", (code: number | null) => finish(undefined, typeof code === "number" ? code : null));
        if (content) channel.end(content);
        else channel.end();
      });
    });
  }
  const channel: TerminalChannel = {
    write: data => { if (!closed) shell?.write(data); },
    setWindow: (rows, cols) => { if (!closed) shell?.setWindow(rows, cols, 0, 0); },
    close: () => close(),
    on: (event, handler) => { events.on(event, handler); return channel; },
    runCommand: command => execute(command),
    uploadFile: async file => {
      const result = await execute(`mkdir -p ${shellPath(path.posix.dirname(file.remotePath))} && cat > ${shellPath(file.remotePath)}`, file.content);
      if (result.code !== 0) throw new Error(result.stderr || `上传失败，退出码 ${result.code}`);
    },
  };
  return new Promise((resolve, reject) => {
    rejectConnect = reject;
    client.on("error", (error: Error) => close(sshError(error)));
    client.on("close", () => close());
    client.on("ready", () => {
      client.shell({ cols: size.cols, rows: size.rows, term: "xterm-256color" }, (error, stream) => {
        if (error) { close(error); return; }
        if (closed) { stream.destroy(); return; }
        shell = stream;
        // Keep the stream paused until the manager has subscribed and sent connected.
        stream.pause();
        stream.on("data", (data: Buffer) => events.emit("data", decoder.write(data)));
        stream.on("error", (error: Error) => close(error));
        stream.on("close", () => close());
        ready = true;
        clearTimeout(connectTimer);
        resolve(channel);
        setImmediate(() => { if (!closed) stream.resume(); });
      });
    });
    client.connect({ host: target.host, port: target.port, username: target.username,
      privateKey, passphrase: target.privateKeyPassphrase, password: target.password, agent: target.agentSocket,
      readyTimeout: 15_000, keepaliveInterval: 10_000, keepaliveCountMax: 3 });
  });
}
