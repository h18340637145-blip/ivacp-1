# Web Remote Shell 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在现有 Next.js 项目中新增 `/terminal` 网页端远程 Shell，用户只能连接服务端白名单服务器，并通过独立 Terminal Gateway 进行实时 SSH 交互。

**架构：** Next.js 负责 `/terminal` 页面、导航和公开服务器元数据接口；独立 `terminal-gateway/` Node.js 进程负责 WebSocket、SSH、命令限制、审计和会话清理。Gateway 绑定本机端口，页面通过 WebSocket 连接它，关闭页面即关闭 SSH 会话。

**技术栈：** Next.js 16、React 19、TypeScript、`@xterm/xterm`、`@xterm/addon-fit`、`ws`、`ssh2`、`tsx`、本地 JSONL 审计日志、现有静态回归脚本模式。

---

## 文件结构

创建：

- `lib/terminal/types.ts`：共享目标服务器、WebSocket 消息、审计事件和命令限制类型。
- `lib/terminal/config.ts`：解析 `REMOTE_SHELL_TARGETS_JSON`，校验字段，返回公开目标和敏感目标配置。
- `lib/terminal/command-guard.ts`：soft/strict 双模式命令限制。
- `terminal-gateway/audit-log.ts`：JSONL 审计写入。
- `terminal-gateway/session-manager.ts`：管理 WebSocket 到 SSH session 的生命周期，支持 fake connector 测试。
- `terminal-gateway/server.ts`：Gateway 入口，启动 WebSocket 服务并接入 session manager。
- `app/api/terminal/targets/route.ts`：返回公开白名单服务器列表，不暴露敏感字段。
- `app/terminal/page.tsx`：终端页面 server component。
- `components/terminal/TerminalWorkbench.tsx`：终端页面 client component，管理目标列表、连接确认、多标签状态。
- `components/terminal/TerminalPane.tsx`：单个 xterm 实例，处理输入、输出、resize、粘贴和关闭。
- `scripts/test-terminal-config.ts`：配置解析单元测试。
- `scripts/test-command-guard.ts`：命令限制单元测试。
- `scripts/test-terminal-audit.ts`：审计日志单元测试。
- `scripts/test-terminal-session-manager.ts`：Gateway 协议和会话清理测试。
- `scripts/check-remote-terminal-flow.mjs`：静态回归检查，覆盖页面、导航、脚本、Gateway 接线和文档。

修改：

- `package.json`：新增依赖和脚本。
- `package-lock.json` / `pnpm-lock.yaml`：由安装命令更新。
- `components/layout/NavBar.tsx`：新增 `/terminal` 导航链接。
- `docs/PRODUCT.md`：新增远程终端第一版产品范围与安全边界。
- `docs/ARCHITECTURE.md`：新增 Terminal Gateway 架构与部署说明。
- `docs/WORKFLOW.md`：新增远程终端连接、命令拦截、审计和断开流程。
- `docs/SEQUENCE_DIAGRAMS.md`：新增远程终端连接时序。
- `session-handoff.md`：记录本轮实现和验证命令。

---

### 任务 1：安装终端与 Gateway 依赖

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`pnpm-lock.yaml`
- 创建：`scripts/check-terminal-dependencies.mjs`

- [ ] **步骤 1：编写失败的依赖接线检查**

创建 `scripts/check-terminal-dependencies.mjs`：

```js
#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

const requiredDeps = [
  "@xterm/xterm",
  "@xterm/addon-fit",
  "ws",
  "ssh2",
  "tsx",
  "concurrently",
  "@types/ws",
  "@types/ssh2",
];

const requiredScripts = [
  "terminal:gateway",
  "dev:with-terminal",
  "test:terminal:config",
  "test:terminal:guard",
  "test:terminal:audit",
  "test:terminal:session",
];

const failures = [
  ...requiredDeps.filter((name) => !deps[name]).map((name) => `missing dependency ${name}`),
  ...requiredScripts.filter((name) => !pkg.scripts?.[name]).map((name) => `missing script ${name}`),
];

if (failures.length > 0) {
  console.error("Terminal dependency checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Terminal dependency checks passed.");
```

- [ ] **步骤 2：运行检查验证失败**

运行：

```bash
node scripts/check-terminal-dependencies.mjs
```

预期：FAIL，至少报告缺少 `@xterm/xterm`、`ws`、`ssh2` 和 `terminal:gateway`。

- [ ] **步骤 3：安装依赖**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm install @xterm/xterm @xterm/addon-fit ws ssh2 tsx
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm install -D @types/ws @types/ssh2 concurrently
```

更新 `package.json` 的 scripts：

```json
{
  "terminal:gateway": "tsx terminal-gateway/server.ts",
  "dev:with-terminal": "concurrently \"npm run dev\" \"npm run terminal:gateway\"",
  "test:terminal:config": "tsx scripts/test-terminal-config.ts",
  "test:terminal:guard": "tsx scripts/test-command-guard.ts",
  "test:terminal:audit": "tsx scripts/test-terminal-audit.ts",
  "test:terminal:session": "tsx scripts/test-terminal-session-manager.ts"
}
```

- [ ] **步骤 4：运行检查验证通过**

运行：

```bash
node scripts/check-terminal-dependencies.mjs
```

预期：PASS，输出 `Terminal dependency checks passed.`

- [ ] **步骤 5：Commit**

```bash
git add package.json package-lock.json pnpm-lock.yaml scripts/check-terminal-dependencies.mjs
git commit -m "chore: add remote terminal dependencies"
```

---

### 任务 2：实现服务器白名单配置解析

**文件：**
- 创建：`lib/terminal/types.ts`
- 创建：`lib/terminal/config.ts`
- 创建：`scripts/test-terminal-config.ts`

- [ ] **步骤 1：编写失败的配置测试**

创建 `scripts/test-terminal-config.ts`：

```ts
import assert from "node:assert/strict";
import { parseRemoteShellTargets, toPublicTarget } from "../lib/terminal/config";

const raw = JSON.stringify([
  {
    id: "dev-build-01",
    name: "dev-build-01",
    description: "构建服务器",
    environment: "dev",
    riskLevel: "normal",
    guardMode: "soft",
    host: "10.0.0.10",
    port: 22,
    username: "ops",
    privateKeyPath: "/tmp/key",
  },
]);

const parsed = parseRemoteShellTargets(raw);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].host, "10.0.0.10");

const publicTarget = toPublicTarget(parsed[0]);
assert.deepEqual(Object.keys(publicTarget).sort(), [
  "description",
  "environment",
  "guardMode",
  "id",
  "name",
  "riskLevel",
].sort());
assert.equal("host" in publicTarget, false);
assert.equal("privateKeyPath" in publicTarget, false);

assert.throws(
  () => parseRemoteShellTargets("[{}]"),
  /target\[0\]\.id/,
);

assert.throws(
  () => parseRemoteShellTargets(JSON.stringify([{ ...parsed[0], guardMode: "invalid" }])),
  /guardMode/,
);

console.log("Terminal config tests passed.");
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:config
```

预期：FAIL，报错找不到 `../lib/terminal/config`。

- [ ] **步骤 3：实现类型和配置解析**

创建 `lib/terminal/types.ts`：

```ts
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
  privateKeyPath: string;
  strictAllowlist?: string[];
}

export type PublicRemoteShellTarget = Pick<
  RemoteShellTarget,
  "id" | "name" | "description" | "environment" | "riskLevel" | "guardMode"
>;

export type ClientTerminalMessage =
  | { type: "connect"; targetId: string; cols: number; rows: number }
  | { type: "input"; sessionId: string; data: string }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "disconnect"; sessionId: string };

export type ServerTerminalMessage =
  | { type: "connected"; sessionId: string; targetId: string }
  | { type: "output"; sessionId: string; data: string }
  | { type: "status"; sessionId?: string; status: string; message: string }
  | { type: "blocked"; sessionId: string; command: string; reason: string }
  | { type: "closed"; sessionId: string; reason: string };
```

创建 `lib/terminal/config.ts`：

```ts
import type { PublicRemoteShellTarget, RemoteShellTarget } from "./types";

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: ${field} is required`);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: ${field} must be a positive integer`);
  }
  return value;
}

export function parseRemoteShellTargets(raw: string | undefined): RemoteShellTarget[] {
  if (!raw?.trim()) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("REMOTE_SHELL_TARGETS_JSON invalid: root must be an array");
  }

  return parsed.map((item, index) => {
    const record = item as Record<string, unknown>;
    const guardMode = requireString(record.guardMode, `target[${index}].guardMode`);
    if (guardMode !== "soft" && guardMode !== "strict") {
      throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: target[${index}].guardMode`);
    }
    const riskLevel = requireString(record.riskLevel, `target[${index}].riskLevel`);
    if (riskLevel !== "normal" && riskLevel !== "critical") {
      throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: target[${index}].riskLevel`);
    }

    return {
      id: requireString(record.id, `target[${index}].id`),
      name: requireString(record.name, `target[${index}].name`),
      description: requireString(record.description, `target[${index}].description`),
      environment: requireString(record.environment, `target[${index}].environment`),
      riskLevel,
      guardMode,
      host: requireString(record.host, `target[${index}].host`),
      port: requireNumber(record.port, `target[${index}].port`),
      username: requireString(record.username, `target[${index}].username`),
      privateKeyPath: requireString(record.privateKeyPath, `target[${index}].privateKeyPath`),
      strictAllowlist: Array.isArray(record.strictAllowlist)
        ? record.strictAllowlist.filter((v): v is string => typeof v === "string" && v.trim() !== "")
        : undefined,
    };
  });
}

export function toPublicTarget(target: RemoteShellTarget): PublicRemoteShellTarget {
  return {
    id: target.id,
    name: target.name,
    description: target.description,
    environment: target.environment,
    riskLevel: target.riskLevel,
    guardMode: target.guardMode,
  };
}

export function loadRemoteShellTargets(): RemoteShellTarget[] {
  return parseRemoteShellTargets(process.env.REMOTE_SHELL_TARGETS_JSON);
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:config
```

预期：PASS，输出 `Terminal config tests passed.`

- [ ] **步骤 5：Commit**

```bash
git add lib/terminal/types.ts lib/terminal/config.ts scripts/test-terminal-config.ts package.json
git commit -m "feat: parse remote terminal target config"
```

---

### 任务 3：实现 soft/strict 命令限制

**文件：**
- 创建：`lib/terminal/command-guard.ts`
- 创建：`scripts/test-command-guard.ts`

- [ ] **步骤 1：编写失败的命令限制测试**

创建 `scripts/test-command-guard.ts`：

```ts
import assert from "node:assert/strict";
import { checkCommandAllowed } from "../lib/terminal/command-guard";

assert.equal(checkCommandAllowed("ls -la", { guardMode: "soft" }).allowed, true);
assert.deepEqual(checkCommandAllowed("rm -rf /", { guardMode: "soft" }), {
  allowed: false,
  reason: "blocked_by_soft_guard",
});
assert.deepEqual(checkCommandAllowed("reboot", { guardMode: "soft" }), {
  allowed: false,
  reason: "blocked_by_soft_guard",
});

assert.equal(checkCommandAllowed("cat /var/log/app.log", { guardMode: "strict" }).allowed, true);
assert.deepEqual(checkCommandAllowed("sudo su", { guardMode: "strict" }), {
  allowed: false,
  reason: "blocked_by_strict_guard",
});
assert.deepEqual(checkCommandAllowed("systemctl status app", { guardMode: "strict" }), {
  allowed: false,
  reason: "blocked_by_strict_guard",
});
assert.equal(
  checkCommandAllowed("systemctl status app", {
    guardMode: "strict",
    strictAllowlist: ["systemctl status app"],
  }).allowed,
  true,
);

console.log("Command guard tests passed.");
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:guard
```

预期：FAIL，报错找不到 `../lib/terminal/command-guard`。

- [ ] **步骤 3：实现最少命令限制**

创建 `lib/terminal/command-guard.ts`：

```ts
import type { RemoteShellGuardMode } from "./types";

interface GuardOptions {
  guardMode: RemoteShellGuardMode;
  strictAllowlist?: string[];
}

export interface CommandGuardResult {
  allowed: boolean;
  reason?: "blocked_by_soft_guard" | "blocked_by_strict_guard";
}

const SOFT_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\s+\/(?:\s|$|\*)/,
  /^\s*(reboot|shutdown|halt|poweroff)(\s|$)/,
  /^\s*mkfs(\.| |\t|$)/,
  /:\s*\(\)\s*\{\s*:\|:&\s*\};\s*:/,
];

const STRICT_COMMANDS = new Set([
  "rm",
  "dd",
  "mkfs",
  "mount",
  "umount",
  "systemctl",
  "service",
  "sudo",
  "su",
  "reboot",
  "shutdown",
  "halt",
  "poweroff",
]);

function firstCommand(input: string): string {
  return input.trim().split(/\s+/)[0] ?? "";
}

export function checkCommandAllowed(input: string, options: GuardOptions): CommandGuardResult {
  const command = input.trim();
  if (!command) return { allowed: true };

  if (options.guardMode === "soft") {
    return SOFT_PATTERNS.some((pattern) => pattern.test(command))
      ? { allowed: false, reason: "blocked_by_soft_guard" }
      : { allowed: true };
  }

  if (options.strictAllowlist?.includes(command)) {
    return { allowed: true };
  }

  return STRICT_COMMANDS.has(firstCommand(command))
    ? { allowed: false, reason: "blocked_by_strict_guard" }
    : { allowed: true };
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:guard
```

预期：PASS，输出 `Command guard tests passed.`

- [ ] **步骤 5：Commit**

```bash
git add lib/terminal/command-guard.ts scripts/test-command-guard.ts
git commit -m "feat: add remote terminal command guard"
```

---

### 任务 4：实现 JSONL 审计日志

**文件：**
- 创建：`terminal-gateway/audit-log.ts`
- 创建：`scripts/test-terminal-audit.ts`

- [ ] **步骤 1：编写失败的审计测试**

创建 `scripts/test-terminal-audit.ts`：

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendAuditEvent } from "../terminal-gateway/audit-log";

const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "terminal-audit-")), "audit.jsonl");

await appendAuditEvent(file, {
  event: "command",
  sessionId: "s1",
  targetId: "dev-build-01",
  command: "echo hello",
});

const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
assert.equal(lines.length, 1);
const record = JSON.parse(lines[0]);
assert.equal(record.event, "command");
assert.equal(record.command, "echo hello");
assert.equal(typeof record.at, "string");
assert.equal("output" in record, false);

console.log("Terminal audit tests passed.");
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:audit
```

预期：FAIL，报错找不到 `../terminal-gateway/audit-log`。

- [ ] **步骤 3：实现审计写入**

创建 `terminal-gateway/audit-log.ts`：

```ts
import fs from "node:fs/promises";
import path from "node:path";

export type AuditEvent =
  | { event: "connect"; sessionId: string; targetId: string }
  | { event: "connect_failed"; targetId: string; reason: string }
  | { event: "command"; sessionId: string; targetId: string; command: string }
  | { event: "blocked"; sessionId: string; targetId: string; command: string; reason: string }
  | { event: "disconnect"; sessionId: string; targetId: string; reason: string }
  | { event: "error"; sessionId?: string; targetId?: string; reason: string };

export async function appendAuditEvent(filePath: string, event: AuditEvent): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n", "utf8");
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:audit
```

预期：PASS，输出 `Terminal audit tests passed.`

- [ ] **步骤 5：Commit**

```bash
git add terminal-gateway/audit-log.ts scripts/test-terminal-audit.ts
git commit -m "feat: add remote terminal audit logger"
```

---

### 任务 5：实现 Gateway 会话管理和协议测试

**文件：**
- 创建：`terminal-gateway/session-manager.ts`
- 创建：`scripts/test-terminal-session-manager.ts`

- [ ] **步骤 1：编写失败的 session manager 测试**

创建 `scripts/test-terminal-session-manager.ts`：

```ts
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { TerminalSessionManager } from "../terminal-gateway/session-manager";
import type { RemoteShellTarget } from "../lib/terminal/types";

class FakeChannel extends EventEmitter {
  writes: string[] = [];
  resized: Array<{ cols: number; rows: number }> = [];
  closed = false;
  write(data: string) { this.writes.push(data); }
  setWindow(rows: number, cols: number) { this.resized.push({ rows, cols }); }
  close() { this.closed = true; this.emit("close"); }
}

const target: RemoteShellTarget = {
  id: "dev",
  name: "dev",
  description: "dev",
  environment: "dev",
  riskLevel: "normal",
  guardMode: "soft",
  host: "127.0.0.1",
  port: 22,
  username: "ops",
  privateKeyPath: "/tmp/key",
};

const channel = new FakeChannel();
const sent: unknown[] = [];
const audited: unknown[] = [];
const manager = new TerminalSessionManager({
  targets: [target],
  connectSsh: async () => channel,
  send: (message) => sent.push(message),
  audit: async (event) => { audited.push(event); },
});

const sessionId = await manager.connect({ targetId: "dev", cols: 80, rows: 24 });
assert.ok(sessionId);
assert.equal(sent.at(-1)?.["type"], "connected");

await manager.input(sessionId, "echo hello\n");
assert.deepEqual(channel.writes, ["echo hello\n"]);
assert.equal(audited.some((event) => event["event"] === "command"), true);

await manager.input(sessionId, "rm -rf /\n");
assert.equal(channel.writes.length, 1);
assert.equal(sent.at(-1)?.["type"], "blocked");

manager.resize(sessionId, 100, 30);
assert.deepEqual(channel.resized.at(-1), { cols: 100, rows: 30 });

manager.disconnect(sessionId, "test");
assert.equal(channel.closed, true);

console.log("Terminal session manager tests passed.");
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:session
```

预期：FAIL，报错找不到 `../terminal-gateway/session-manager`。

- [ ] **步骤 3：实现 session manager**

创建 `terminal-gateway/session-manager.ts`：

```ts
import { randomUUID } from "node:crypto";
import { checkCommandAllowed } from "../lib/terminal/command-guard";
import type { AuditEvent } from "./audit-log";
import type { ClientTerminalMessage, RemoteShellTarget, ServerTerminalMessage } from "../lib/terminal/types";

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
  send: (message: ServerTerminalMessage) => void;
  audit: (event: AuditEvent) => Promise<void>;
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
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.commandBuffer += data;
    if (data.includes("\n") || data.includes("\r")) {
      const command = session.commandBuffer.trim();
      session.commandBuffer = "";
      if (command) {
        const guard = checkCommandAllowed(command, {
          guardMode: session.target.guardMode,
          strictAllowlist: session.target.strictAllowlist,
        });
        if (!guard.allowed) {
          await this.options.audit({ event: "blocked", sessionId, targetId: session.target.id, command, reason: guard.reason ?? "blocked" });
          this.options.send({ type: "blocked", sessionId, command, reason: guard.reason ?? "blocked" });
          return;
        }
        await this.options.audit({ event: "command", sessionId, targetId: session.target.id, command });
      }
    }
    session.channel.write(data);
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
```

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:session
```

预期：PASS，输出 `Terminal session manager tests passed.`

- [ ] **步骤 5：Commit**

```bash
git add terminal-gateway/session-manager.ts scripts/test-terminal-session-manager.ts
git commit -m "feat: add remote terminal session manager"
```

---

### 任务 6：实现 Terminal Gateway WebSocket 入口

**文件：**
- 创建：`terminal-gateway/server.ts`

- [ ] **步骤 1：扩展静态检查覆盖 Gateway 入口**

创建或更新 `scripts/check-remote-terminal-flow.mjs`，先加入 Gateway 检查：

```js
#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : "";
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const server = read("terminal-gateway/server.ts");

const checks = [
  {
    name: "terminal gateway starts a WebSocket server and loads targets",
    pass: () =>
      server.includes("WebSocketServer") &&
      server.includes("loadRemoteShellTargets") &&
      server.includes("TerminalSessionManager") &&
      server.includes("ClientTerminalMessage"),
  },
  {
    name: "package exposes terminal gateway scripts",
    pass: () =>
      pkg.scripts["terminal:gateway"]?.includes("terminal-gateway/server.ts") &&
      pkg.scripts["dev:with-terminal"],
  },
];

const failures = checks.filter((check) => !check.pass());
if (failures.length > 0) {
  console.error("Remote terminal flow checks failed:");
  for (const failure of failures) console.error(`- ${failure.name}`);
  process.exit(1);
}

console.log(`Remote terminal flow checks passed (${checks.length}).`);
```

- [ ] **步骤 2：运行检查验证失败**

运行：

```bash
node scripts/check-remote-terminal-flow.mjs
```

预期：FAIL，报告 gateway 入口缺失。

- [ ] **步骤 3：实现 Gateway 入口**

创建 `terminal-gateway/server.ts`：

```ts
import fs from "node:fs/promises";
import { Client } from "ssh2";
import { WebSocketServer } from "ws";
import { loadRemoteShellTargets } from "../lib/terminal/config";
import type { ClientTerminalMessage, RemoteShellTarget } from "../lib/terminal/types";
import { appendAuditEvent } from "./audit-log";
import { TerminalSessionManager, type TerminalChannel } from "./session-manager";

const port = Number(process.env.REMOTE_SHELL_GATEWAY_PORT ?? "39222");
const auditPath = process.env.REMOTE_SHELL_AUDIT_LOG_PATH ?? "log/remote-shell-audit.jsonl";
const targets = loadRemoteShellTargets();

async function connectSsh(target: RemoteShellTarget, size: { cols: number; rows: number }): Promise<TerminalChannel> {
  const privateKey = await fs.readFile(target.privateKeyPath, "utf8");
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
      .on("error", reject)
      .connect({
        host: target.host,
        port: target.port,
        username: target.username,
        privateKey,
        readyTimeout: 15_000,
      });
  });
}

const wss = new WebSocketServer({ host: "127.0.0.1", port });
console.log(`[terminal-gateway] listening on ws://127.0.0.1:${port}, targets=${targets.length}`);

wss.on("connection", (socket) => {
  const manager = new TerminalSessionManager({
    targets,
    connectSsh,
    send: (message) => socket.send(JSON.stringify(message)),
    audit: (event) => appendAuditEvent(auditPath, event),
  });

  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientTerminalMessage;
      if (message.type === "connect") await manager.connect(message);
      if (message.type === "input") await manager.input(message.sessionId, message.data);
      if (message.type === "resize") manager.resize(message.sessionId, message.cols, message.rows);
      if (message.type === "disconnect") manager.disconnect(message.sessionId, "client_disconnect");
    } catch (error) {
      socket.send(JSON.stringify({ type: "status", status: "error", message: error instanceof Error ? error.message : String(error) }));
    }
  });

  socket.on("close", () => manager.disconnectAll("browser_closed"));
});
```

- [ ] **步骤 4：运行检查和类型验证**

运行：

```bash
node scripts/check-remote-terminal-flow.mjs
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH ./node_modules/.bin/tsc --noEmit
```

预期：静态检查 PASS，TypeScript PASS。

- [ ] **步骤 5：Commit**

```bash
git add terminal-gateway/server.ts scripts/check-remote-terminal-flow.mjs
git commit -m "feat: add remote terminal gateway server"
```

---

### 任务 7：实现公开目标 API

**文件：**
- 创建：`app/api/terminal/targets/route.ts`
- 修改：`scripts/check-remote-terminal-flow.mjs`

- [ ] **步骤 1：扩展静态检查覆盖 API**

在 `scripts/check-remote-terminal-flow.mjs` 中加入：

```js
const route = read("app/api/terminal/targets/route.ts");

checks.push({
  name: "terminal targets API returns only public target metadata",
  pass: () =>
    route.includes("export async function GET") &&
    route.includes("loadRemoteShellTargets") &&
    route.includes("toPublicTarget") &&
    !route.includes("privateKeyPath") &&
    !route.includes("username"),
});
```

- [ ] **步骤 2：运行检查验证失败**

运行：

```bash
node scripts/check-remote-terminal-flow.mjs
```

预期：FAIL，报告 targets API 缺失。

- [ ] **步骤 3：实现 API Route**

创建 `app/api/terminal/targets/route.ts`：

```ts
import { NextResponse } from "next/server";
import { loadRemoteShellTargets, toPublicTarget } from "@/lib/terminal/config";

export async function GET() {
  try {
    const targets = loadRemoteShellTargets().map(toPublicTarget);
    return NextResponse.json({ targets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "远程终端目标配置无效" },
      { status: 500 },
    );
  }
}
```

- [ ] **步骤 4：运行检查和 TypeScript**

运行：

```bash
node scripts/check-remote-terminal-flow.mjs
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH ./node_modules/.bin/tsc --noEmit
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add app/api/terminal/targets/route.ts scripts/check-remote-terminal-flow.mjs
git commit -m "feat: expose remote terminal targets"
```

---

### 任务 8：实现 `/terminal` 页面和多标签终端 UI

**文件：**
- 创建：`app/terminal/page.tsx`
- 创建：`components/terminal/TerminalWorkbench.tsx`
- 创建：`components/terminal/TerminalPane.tsx`
- 修改：`scripts/check-remote-terminal-flow.mjs`

- [ ] **步骤 1：扩展静态检查覆盖页面和 xterm 接线**

在 `scripts/check-remote-terminal-flow.mjs` 中加入：

```js
const page = read("app/terminal/page.tsx");
const workbench = read("components/terminal/TerminalWorkbench.tsx");
const pane = read("components/terminal/TerminalPane.tsx");

checks.push(
  {
    name: "terminal page renders TerminalWorkbench",
    pass: () => page.includes("TerminalWorkbench") && page.includes("远程终端"),
  },
  {
    name: "terminal workbench fetches targets and uses WebSocket",
    pass: () =>
      workbench.includes("/api/terminal/targets") &&
      workbench.includes("WebSocket") &&
      workbench.includes("REMOTE_SHELL_GATEWAY") &&
      workbench.includes("确认连接"),
  },
  {
    name: "terminal pane wires xterm input output paste and resize",
    pass: () =>
      pane.includes("@xterm/xterm") &&
      pane.includes("@xterm/addon-fit") &&
      pane.includes("onData") &&
      pane.includes("ResizeObserver") &&
      pane.includes("fitAddon.fit"),
  },
);
```

- [ ] **步骤 2：运行检查验证失败**

运行：

```bash
node scripts/check-remote-terminal-flow.mjs
```

预期：FAIL，报告 terminal page 和 components 缺失。

- [ ] **步骤 3：创建页面**

创建 `app/terminal/page.tsx`：

```tsx
import { TerminalWorkbench } from "@/components/terminal/TerminalWorkbench";

export default function TerminalPage() {
  return (
    <div style={{ minHeight: "calc(100vh - 52px)", background: "var(--c-bg)" }}>
      <TerminalWorkbench />
    </div>
  );
}
```

- [ ] **步骤 4：创建 Workbench**

创建 `components/terminal/TerminalWorkbench.tsx`：

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicRemoteShellTarget, ServerTerminalMessage } from "@/lib/terminal/types";
import { TerminalPane } from "./TerminalPane";

interface TerminalTab {
  id: string;
  target: PublicRemoteShellTarget;
  sessionId?: string;
  status: "connecting" | "connected" | "closed" | "failed";
  messages: ServerTerminalMessage[];
}

const gatewayUrl = process.env.NEXT_PUBLIC_REMOTE_SHELL_GATEWAY_URL ?? "ws://localhost:39222";

export function TerminalWorkbench() {
  const [targets, setTargets] = useState<PublicRemoteShellTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/terminal/targets")
      .then((res) => res.json())
      .then((data: { targets?: PublicRemoteShellTarget[]; error?: string }) => {
        if (data.error) setError(data.error);
        setTargets(data.targets ?? []);
        setSelectedTargetId(data.targets?.[0]?.id ?? "");
      })
      .catch(() => setError("终端网关目标列表加载失败"));
  }, []);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [tabs, activeTabId]);
  const selectedTarget = targets.find((target) => target.id === selectedTargetId);

  function connectSelectedTarget() {
    if (!selectedTarget) return;
    if (!window.confirm(`确认连接 ${selectedTarget.name}？\n风险等级：${selectedTarget.riskLevel}\n限制模式：${selectedTarget.guardMode}`)) {
      return;
    }
    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      target: selectedTarget,
      status: "connecting",
      messages: [],
    };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(tabId: string) {
    setTabs((current) => current.filter((tab) => tab.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId(tabs.find((tab) => tab.id !== tabId)?.id ?? "");
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", minHeight: "calc(100vh - 52px)" }}>
      <aside style={{ borderRight: "1px solid var(--c-border)", padding: 16 }}>
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>远程终端</h1>
        {error && <p style={{ color: "var(--c-red)", marginBottom: 12 }}>{error}</p>}
        <select value={selectedTargetId} onChange={(e) => setSelectedTargetId(e.target.value)} style={{ width: "100%", marginBottom: 12 }}>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>{target.name} · {target.environment}</option>
          ))}
        </select>
        <button onClick={connectSelectedTarget} disabled={!selectedTarget}>连接所选服务器</button>
        <p style={{ marginTop: 16, color: "var(--c-text-2)", fontSize: 12 }}>命令输入会被审计，命令输出不保存。</p>
      </aside>

      <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, padding: 8, borderBottom: "1px solid var(--c-border)" }}>
          {tabs.map((tab) => (
            <span key={tab.id} style={{ display: "inline-flex", gap: 4 }}>
              <button onClick={() => setActiveTabId(tab.id)}>
                {tab.target.name} · {tab.status}
              </button>
              <button aria-label={`关闭 ${tab.target.name}`} onClick={() => closeTab(tab.id)}>×</button>
            </span>
          ))}
        </div>
        {activeTab ? (
          <TerminalPane
            key={activeTab.id}
            tab={activeTab}
            gatewayUrl={gatewayUrl}
            onStatus={(status, sessionId) => {
              setTabs((current) => current.map((tab) => tab.id === activeTab.id ? { ...tab, status, sessionId } : tab));
            }}
          />
        ) : (
          <div style={{ padding: 24, color: "var(--c-text-2)" }}>请选择服务器并连接。</div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **步骤 5：创建 TerminalPane**

创建 `components/terminal/TerminalPane.tsx`：

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ServerTerminalMessage } from "@/lib/terminal/types";

interface TerminalPaneProps {
  tab: { id: string; target: { id: string; name: string }; sessionId?: string };
  gatewayUrl: string;
  onStatus: (status: "connecting" | "connected" | "closed" | "failed", sessionId?: string) => void;
}

export function TerminalPane({ tab, gatewayUrl, onStatus }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({ cursorBlink: true, fontFamily: "var(--f-mono)", theme: { background: "#050706" } });
    const fitAddon = new FitAddon();
    const socket = new WebSocket(gatewayUrl);
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "connect", targetId: tab.target.id, cols: terminal.cols, rows: terminal.rows }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerTerminalMessage;
      if (message.type === "connected") {
        sessionIdRef.current = message.sessionId;
        onStatus("connected", message.sessionId);
      }
      if (message.type === "output") terminal.write(message.data);
      if (message.type === "blocked") terminal.write(`\r\n[blocked] ${message.reason}: ${message.command}\r\n`);
      if (message.type === "closed") onStatus("closed");
      if (message.type === "status") terminal.write(`\r\n[status] ${message.message}\r\n`);
    });
    socket.addEventListener("error", () => onStatus("failed"));

    const inputDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN && sessionIdRef.current) {
        socket.send(JSON.stringify({ type: "input", sessionId: sessionIdRef.current, data }));
      }
    });
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      if (socket.readyState === WebSocket.OPEN && sessionIdRef.current) {
        socket.send(JSON.stringify({ type: "resize", sessionId: sessionIdRef.current, cols: terminal.cols, rows: terminal.rows }));
      }
    });
    observer.observe(containerRef.current);

    return () => {
      inputDisposable.dispose();
      observer.disconnect();
      if (socket.readyState === WebSocket.OPEN && sessionIdRef.current) {
        socket.send(JSON.stringify({ type: "disconnect", sessionId: sessionIdRef.current }));
      }
      socket.close();
      terminal.dispose();
    };
  }, [gatewayUrl, onStatus, tab.target.id]);

  return <div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: 8 }} />;
}
```

- [ ] **步骤 6：运行检查和 TypeScript**

运行：

```bash
node scripts/check-remote-terminal-flow.mjs
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH ./node_modules/.bin/tsc --noEmit
```

预期：PASS。

- [ ] **步骤 7：Commit**

```bash
git add app/terminal/page.tsx components/terminal/TerminalWorkbench.tsx components/terminal/TerminalPane.tsx scripts/check-remote-terminal-flow.mjs
git commit -m "feat: add remote terminal page"
```

---

### 任务 9：导航入口与文档同步

**文件：**
- 修改：`components/layout/NavBar.tsx`
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`
- 修改：`scripts/check-remote-terminal-flow.mjs`

- [ ] **步骤 1：扩展静态检查覆盖导航和文档**

在 `scripts/check-remote-terminal-flow.mjs` 中加入：

```js
const nav = read("components/layout/NavBar.tsx");
const product = read("docs/PRODUCT.md");
const architecture = read("docs/ARCHITECTURE.md");
const workflow = read("docs/WORKFLOW.md");
const sequence = read("docs/SEQUENCE_DIAGRAMS.md");
const handoff = read("session-handoff.md");

checks.push({
  name: "navigation and docs include remote terminal",
  pass: () =>
    nav.includes("/terminal") &&
    nav.includes("远程终端") &&
    product.includes("远程终端") &&
    architecture.includes("Terminal Gateway") &&
    workflow.includes("远程终端连接流程") &&
    sequence.includes("远程终端连接时序") &&
    handoff.includes("Web Remote Shell"),
});
```

- [ ] **步骤 2：运行检查验证失败**

运行：

```bash
node scripts/check-remote-terminal-flow.mjs
```

预期：FAIL，报告导航或文档缺失。

- [ ] **步骤 3：修改导航**

在 `components/layout/NavBar.tsx` 中加入链接：

```tsx
<a
  href="/terminal"
  style={{
    fontSize: "12px",
    color: "var(--c-text-2)",
    fontFamily: "var(--f-mono)",
    padding: "4px 8px",
    border: "1px solid var(--c-border-2)",
    borderRadius: "3px",
  }}
>
  远程终端
</a>
```

放在右侧 `v0.1.0` 前面，避免改变品牌区。

- [ ] **步骤 4：更新文档**

在 `docs/PRODUCT.md` 增加 `远程终端` 第一版范围：

```md
### 3.x 远程终端（Remote Shell）

第一版提供 `/terminal` 内网页面，只允许连接服务端环境变量配置的白名单服务器。用户可多标签打开实时 SSH 终端；关闭标签或页面即断开 SSH。命令输入会写入审计日志，命令输出不落盘。第一版不提供登录和角色权限，因此只能部署在可信内网。
```

在 `docs/ARCHITECTURE.md` 增加 Terminal Gateway 段落：

```md
### Terminal Gateway

远程终端使用独立 Node.js Gateway 进程，绑定本机端口，负责 WebSocket、SSH、PTY、命令限制和审计。Next.js 只负责 `/terminal` 页面和公开目标列表 API。
```

在 `docs/WORKFLOW.md` 增加连接流程：

```md
## 远程终端连接流程

用户进入 `/terminal`，选择白名单服务器，确认风险等级和命令限制模式后建立 WebSocket。Gateway 用服务端配置的 SSH key 连接目标服务器。关闭标签或页面时 Gateway 断开对应 SSH。
```

在 `docs/SEQUENCE_DIAGRAMS.md` 增加时序：

```md
## 远程终端连接时序

浏览器 -> Next.js: GET /api/terminal/targets
浏览器 -> Terminal Gateway: WebSocket connect(targetId)
Terminal Gateway -> SSH Server: SSH + PTY
SSH Server -> Terminal Gateway: shell output
Terminal Gateway -> 浏览器: output
浏览器 -> Terminal Gateway: input / resize / disconnect
```

在 `session-handoff.md` 增加本轮条目，列出实现文件和验证命令。

- [ ] **步骤 5：运行检查验证通过**

运行：

```bash
node scripts/check-remote-terminal-flow.mjs
```

预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add components/layout/NavBar.tsx docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md scripts/check-remote-terminal-flow.mjs
git commit -m "docs: document remote terminal workflow"
```

---

### 任务 10：完整验证与手动验收

**文件：**
- 修改：按验证发现的问题修正相关文件。

- [ ] **步骤 1：运行全部新增测试**

运行：

```bash
node scripts/check-terminal-dependencies.mjs
node scripts/check-remote-terminal-flow.mjs
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:config
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:guard
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:audit
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:terminal:session
```

预期：全部 PASS。

- [ ] **步骤 2：运行项目级验证**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH ./node_modules/.bin/tsc --noEmit
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run build
```

预期：lint、TypeScript、build 通过。若 sandbox 中 build 因 Turbopack/PostCSS 端口绑定失败，按现有项目惯例在沙箱外重跑并记录结果。

- [ ] **步骤 3：配置本地测试目标**

在本地 shell 中设置临时环境变量：

```bash
export REMOTE_SHELL_GATEWAY_PORT=39222
export REMOTE_SHELL_AUDIT_LOG_PATH=/tmp/remote-shell-audit.jsonl
export REMOTE_SHELL_TARGETS_JSON="$(printf '[{"id":"local-test","name":"local-test","description":"本地 SSH 测试目标","environment":"dev","riskLevel":"normal","guardMode":"soft","host":"127.0.0.1","port":22,"username":"%s","privateKeyPath":"%s"}]' "$(whoami)" "$HOME/.ssh/id_rsa")"
```

若当前用户没有可用的 `$HOME/.ssh/id_rsa` 或本机没有 SSH server，则使用一台测试服务器的低权限账号和 key 路径重新设置 `REMOTE_SHELL_TARGETS_JSON`，字段名保持一致。

- [ ] **步骤 4：启动服务做手动验收**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run terminal:gateway
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run dev
```

打开 `http://localhost:3000/terminal`，验证：

- 服务器列表只显示公开字段。
- 点击连接前出现确认。
- 终端能输入 `pwd`、`whoami`、`ls`。
- Ctrl+C 能中断 `sleep 30`。
- 浏览器 resize 后远程 `stty size` 变化。
- 打开两个标签，关闭其中一个只断开对应 SSH。
- 输入 `rm -rf /` 被 soft guard 拦截。
- `/tmp/remote-shell-audit.jsonl` 包含 command 和 blocked 记录，但不包含命令输出。

- [ ] **步骤 5：Commit 验证修正**

如果步骤 1-4 产生修正：

```bash
git add package.json package-lock.json pnpm-lock.yaml \
  lib/terminal terminal-gateway app/api/terminal app/terminal components/terminal \
  components/layout/NavBar.tsx scripts/check-terminal-dependencies.mjs \
  scripts/check-remote-terminal-flow.mjs scripts/test-terminal-config.ts \
  scripts/test-command-guard.ts scripts/test-terminal-audit.ts \
  scripts/test-terminal-session-manager.ts docs/PRODUCT.md docs/ARCHITECTURE.md \
  docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
git commit -m "fix: stabilize remote terminal validation"
```

如果没有修正，不需要 commit。

---

## 规格覆盖检查

- `/terminal` 页面和导航：任务 8、任务 9。
- 白名单服务器配置和敏感字段不暴露：任务 2、任务 7。
- 固定 SSH key 和独立 Gateway：任务 1、任务 5、任务 6。
- 二次确认、多标签、复制粘贴、resize：任务 8、任务 10。
- 页面关闭即断开：任务 5、任务 8、任务 10。
- soft/strict 命令限制：任务 3、任务 5、任务 10。
- 审计命令输入但不记录输出：任务 4、任务 5、任务 10。
- 无访问控制但限定可信内网的安全边界：任务 9。
- 文档同步和交接记录：任务 9。
