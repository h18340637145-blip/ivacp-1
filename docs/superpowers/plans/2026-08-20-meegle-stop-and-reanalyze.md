# 飞书分析停止与再次分析实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在飞书筛票结果表格中为单票提供真实的“停止分析”和“再次分析”，确保服务端 run、IndexedDB 状态和迟到响应始终一致。

**架构：** 使用进程内 runId 注册表统一持有 `AbortController` 和子进程终止回调，取消 API 负责身份校验、即时终止和 `cancelled.json` 审计。客户端以 `latestAttemptTaskId` 为并发令牌，将 task 与 assignment 原子转换为 `stopped`，并在所有成功/失败写入前执行 runId 条件保护。

**技术栈：** Next.js 16 App Router、React 19、TypeScript、Zustand、Dexie/IndexedDB、Node.js `AbortController` / `ChildProcess`、现有 Node/tsx 回归脚本。

**设计规格：** `docs/superpowers/specs/2026-08-20-meegle-stop-and-reanalyze-design.md`

**工作区前提：** 当前工作区已有尚未提交的 MQL 当前结果边界和陈旧 Meegle 任务恢复修改，且本计划会继续修改 `MeegleAnalysisBoard.tsx`、`meegleProcessStore.ts` 和文档。执行时必须先记录 `git status --short` 与这些文件的基线 diff；不得从 HEAD 新建一个丢失这些前置修改的空 worktree，也不得覆盖或回退现有改动。每次提交前只暂存本任务明确列出的文件，并检查 `git diff --cached --name-only`。

---

## 文件结构

### 新建

- `lib/server/analysis-run-registry.ts`：按 runId 管理服务端 AbortController、身份、运行目录和子进程终止回调。
- `lib/server/meegle-run-artifacts.ts`：在安全目录边界内定位 Meegle run、判断完整成功产物、写入取消审计。
- `app/api/meegle/cancel/route.ts`：校验并执行单个 Meegle run 的幂等取消。
- `scripts/test-analysis-run-registry.ts`：运行注册、重复取消、身份隔离和子进程终止行为测试。
- `scripts/test-meegle-cancel-route.ts`：取消 API 的活动、历史、完成冲突和目录安全测试。
- `scripts/check-meegle-stop-analysis.mjs`：客户端状态、竞态保护和生产表格按钮的回归守卫。

### 修改

- `package.json`：增加 `test:meegle-stop-analysis` 聚合命令。
- `lib/db/schema.ts`：为 Meegle assignment/task 状态增加 `stopped`。
- `lib/meegle/lifecycle.ts`：补充可复用的停止转换与当前 run 条件判断。
- `lib/server/qwen.ts`：文本/图像 Qwen 请求接受并响应 AbortSignal。
- `lib/server/meegle-cli.ts`：Meegle CLI 下载接受 AbortSignal。
- `app/api/issues/process/route.ts`：注册 Meegle run，向下载/解包/解析/绘图/Qwen 传递取消上下文，落盘 cancelled 指标，并阻止成功归档。
- `app/api/meegle/recover/route.ts`：复用安全 run 定位与成功产物判断，不复制目录遍历逻辑。
- `stores/meegleProcessStore.ts`：提供 stop/reanalyze 状态流，按 runId 管理客户端请求，并保护迟到成功/失败写入。
- `components/analysis/MeegleAnalysisBoard.tsx`：在真实生产表格增加 205px 操作列和停止/再次分析交互。
- `scripts/check-meegle-result-lifecycle.mjs`：接受 `stopped` 生命周期和取消接口。
- `scripts/test-meegle-lifecycle.ts`：覆盖停止转换与 runId 条件。
- `scripts/check-meegle-parity-ui.mjs`：覆盖表格操作列、按钮文案和二次确认。
- `docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`、`session-handoff.md`：同步产品、架构、时序、运行和验收事实。

---

### 任务 1：建立可测试的服务端 run 注册表

**文件：**
- 创建：`lib/server/analysis-run-registry.ts`
- 创建：`scripts/test-analysis-run-registry.ts`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的注册表行为测试**

在 `scripts/test-analysis-run-registry.ts` 使用唯一 runId，覆盖注册、身份匹配取消、重复取消和不同 runId 隔离：

```ts
import assert from "node:assert/strict";
import {
  registerAnalysisRun,
  requestAnalysisRunStop,
  resetAnalysisRunRegistryForTests,
} from "../lib/server/analysis-run-registry";

resetAnalysisRunRegistryForTests();
const killed: string[] = [];
const run = registerAnalysisRun({
  runId: "run-stop-1",
  source: "meegle",
  issueKey: "meegle-7073862958",
});
run.trackChild({ kill: (signal?: NodeJS.Signals | number) => { killed.push(String(signal)); return true; } });

const first = requestAnalysisRunStop({ runId: "run-stop-1", issueKey: "meegle-7073862958", source: "meegle" });
assert.equal(first.status, "stopped");
assert.equal(first.active, true);
assert.equal(run.signal.aborted, true);
assert.deepEqual(killed, ["SIGTERM"]);
assert.equal(requestAnalysisRunStop({ runId: "run-stop-1", issueKey: "meegle-7073862958", source: "meegle" }).status, "stopped");
assert.throws(() => requestAnalysisRunStop({ runId: "run-stop-1", issueKey: "meegle-1", source: "meegle" }), /身份不匹配/);
```

- [ ] **步骤 2：添加聚合测试命令并验证红灯**

在 `package.json` 增加：

```json
"test:meegle-stop-analysis": "node --import tsx scripts/test-analysis-run-registry.ts && node --import tsx scripts/test-meegle-cancel-route.ts && node scripts/check-meegle-stop-analysis.mjs"
```

先仅运行注册表测试：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-analysis-run-registry.ts
```

预期：FAIL，原因是 `analysis-run-registry` 模块或导出尚不存在。

- [ ] **步骤 3：实现最小注册表**

在 `lib/server/analysis-run-registry.ts` 定义清晰接口：

```ts
export interface AnalysisRunIdentity {
  runId: string;
  source: "meegle";
  issueKey: string;
}

export interface AnalysisRunHandle {
  readonly signal: AbortSignal;
  readonly identity: AnalysisRunIdentity;
  setLogRoot(logRoot: string): void;
  trackChild(child: { kill(signal?: NodeJS.Signals | number): boolean }): () => void;
  throwIfCancelled(): void;
  dispose(): void;
}

export type StopAnalysisRunResult = {
  status: "stopped";
  active: boolean;
  alreadyStopped: boolean;
  logRoot?: string;
};
```

实现要求：

- 使用 `globalThis` 上的私有 Map，避免 Next.js 开发热更新产生多个注册表实例。
- 同一活动 runId 重复注册必须抛错。
- `requestAnalysisRunStop` 先核对 source/issueKey，再 abort，并对登记子进程各调用一次 `SIGTERM`。
- 取消记录在活动 run 注销后仍保留到进程退出，使重复取消幂等。
- `dispose()` 只移除活动句柄，不删除 stopped 审计状态。

- [ ] **步骤 4：运行注册表测试验证绿灯**

运行上一步命令，预期输出 `analysis run registry tests passed`，退出码 0。

- [ ] **步骤 5：提交本任务**

```bash
git add lib/server/analysis-run-registry.ts scripts/test-analysis-run-registry.ts package.json
git diff --cached --name-only
git commit -m "feat: 增加分析运行取消注册表"
```

预期暂存文件只有上述三个路径。

---

### 任务 2：实现安全、幂等的 Meegle 取消 API

**文件：**
- 创建：`lib/server/meegle-run-artifacts.ts`
- 创建：`app/api/meegle/cancel/route.ts`
- 创建：`scripts/test-meegle-cancel-route.ts`
- 修改：`app/api/meegle/recover/route.ts`

- [ ] **步骤 1：编写取消路由失败测试**

将路由实现为可注入 `logBase` 和注册表操作的 handler，测试使用 `fs.mkdtemp()` 创建临时日志树，不污染项目 `log/`：

```ts
const runRoot = path.join(tmp, "chery-8155-others", "T1L_FL2_8155_ICE国内", "meegle-7073862958", "run-old");
await fs.mkdir(runRoot, { recursive: true });
await fs.writeFile(path.join(runRoot, "step1_requirements.md"), "partial");

const response = await handler(new Request("http://localhost/api/meegle/cancel", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    runId: "run-old",
    issueKey: "meegle-7073862958",
    workItemId: "7073862958",
    ruleGroupName: "chery-8155-others",
  }),
}));
assert.equal(response.status, 200);
assert.equal((await response.json()).status, "stopped");
assert.equal(JSON.parse(await fs.readFile(path.join(runRoot, "cancelled.json"), "utf8")).runId, "run-old");
```

另加三例：完整 success 产物返回 409；身份不一致返回 400；重复取消不改变原 `stoppedAt`。

- [ ] **步骤 2：运行测试验证红灯**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-meegle-cancel-route.ts
```

预期：FAIL，取消路由或 handler 尚不存在。

- [ ] **步骤 3：提取安全 run 产物边界**

在 `lib/server/meegle-run-artifacts.ts` 创建：

```ts
export interface MeegleRunLookup {
  runId: string;
  issueKey: string;
  ruleGroupName: string;
}

export async function locateMeegleRunDirectory(logBase: string, lookup: MeegleRunLookup): Promise<string | undefined>;
export async function hasCompleteMeegleSuccess(runDirectory: string, issueKey: string): Promise<boolean>;
export async function writeMeegleCancellation(runDirectory: string, input: {
  runId: string;
  issueKey: string;
  stoppedAt: Date;
  active: boolean;
}): Promise<void>;
```

复用 `assertSafeRunId`，对规则组、车型、issue 和 run 的每一级使用 `path.resolve` + `path.relative` containment。将 `recover/route.ts` 现有目录遍历改为调用该 helper，恢复响应合同保持不变。

- [ ] **步骤 4：实现取消 handler**

在 `app/api/meegle/cancel/route.ts` 导出 `createMeegleCancelHandler` 与默认 `POST`。处理顺序固定为：参数/身份校验 → 定位 run → 完整成功冲突检查 → 请求注册表停止 → 写或复用 `cancelled.json` → 返回 200。

响应合同：

```ts
type MeegleCancelResponse =
  | { status: "stopped"; runId: string; active: boolean; stoppedAt: string }
  | { error: string; status: "completed" };
```

历史卡死任务的注册表结果可为 `active:false`，但只要存在该 run 的安全日志目录且不是完整 success，仍返回 stopped。完全找不到 run 时返回 404，客户端保持 processing。

- [ ] **步骤 5：运行取消路由和恢复回归**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-meegle-cancel-route.ts
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
```

预期：取消路由测试通过；既有 75 项生命周期和无产物恢复测试通过。

- [ ] **步骤 6：提交本任务**

```bash
git add lib/server/meegle-run-artifacts.ts app/api/meegle/cancel/route.ts app/api/meegle/recover/route.ts scripts/test-meegle-cancel-route.ts
git diff --cached --name-only
git commit -m "feat: 增加飞书分析取消接口"
```

---

### 任务 3：让 Qwen 和 Meegle CLI 响应取消信号

**文件：**
- 修改：`lib/server/qwen.ts`
- 修改：`lib/server/meegle-cli.ts`
- 创建：`scripts/test-analysis-abort-propagation.ts`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的 AbortSignal 传播测试**

测试必须验证行为而非只匹配源码：启动本地延迟 HTTP server，将 signal 传给 `callQwen` 的注入式请求路径，abort 后应快速以 `AbortError`/`AnalysisCancelledError` 拒绝且不重试。对 Meegle CLI helper 使用一个长运行的测试子进程，abort 后确认进程退出。

期望调用形状：

```ts
const controller = new AbortController();
const pending = callQwen(messages, { apiKey: "test", signal: controller.signal });
controller.abort();
await assert.rejects(pending, /取消|abort/i);
```

将 `scripts/test-analysis-abort-propagation.ts` 加到 `test:meegle-stop-analysis` 的注册表测试之后。

- [ ] **步骤 2：运行测试验证红灯**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-analysis-abort-propagation.ts
```

预期：FAIL，Qwen/Meegle options 尚不接受 signal 或 abort 不会中止请求。

- [ ] **步骤 3：实现 Qwen 取消**

统一扩展 options：

```ts
export interface QwenCallOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
}
```

- `httpPost` 接收 signal；若已 aborted 立即拒绝，否则注册一次性 abort listener 并 `req.destroy()`。
- 请求结束、错误或超时后移除 listener。
- retry catch 首先检查 signal，不将取消归类为可重试网络错误。
- 指数退避使用可被 signal 中断的 timer。
- `chat`、`recognizeImageText` 原样透传 options，不影响未传 signal 的既有调用。

- [ ] **步骤 4：实现 Meegle CLI 取消**

在 `runMeegleJson` / `runMeegle` 的最后一个可选参数接受 `{ timeout?: number; signal?: AbortSignal }`，内部传给 `execFile`。保留现有数字 timeout 调用的兼容包装，避免改坏其他 Meegle API：

```ts
type MeegleRunOptions = number | { timeout?: number; signal?: AbortSignal };
```

- [ ] **步骤 5：运行取消与 Qwen 回归**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-analysis-abort-propagation.ts
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:qwen-network
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-comment-attachments
```

预期全部通过。

- [ ] **步骤 6：提交本任务**

```bash
git add lib/server/qwen.ts lib/server/meegle-cli.ts scripts/test-analysis-abort-propagation.ts package.json
git diff --cached --name-only
git commit -m "feat: 支持模型与飞书命令取消"
```

---

### 任务 4：接入共享分析流水线并终止子进程

**文件：**
- 修改：`app/api/issues/process/route.ts`
- 修改：`scripts/test-analysis-abort-propagation.ts`
- 修改：`scripts/check-meegle-result-lifecycle.mjs`

- [ ] **步骤 1：先增加失败的流水线静态与行为守卫**

在行为测试中登记伪子进程并验证取消；在生命周期脚本中要求共享路由包含以下边界：

```js
[
  ["Meegle process registers immutable run", processRoute.includes("registerAnalysisRun")],
  ["pipeline checks cancellation between stages", processRoute.includes("throwIfCancelled")],
  ["cancelled pipeline writes cancelled metrics", processRoute.includes('"cancelled"')],
  ["active child processes are tracked", processRoute.includes("trackChild")],
]
```

运行 `npm run test:meegle-results`，预期新增检查 FAIL。

- [ ] **步骤 2：为 POST 建立完整生命周期外层**

在 Meegle runId 校验和 `logRoot` 创建后注册：

```ts
const activeRun = source === "meegle" && runId
  ? registerAnalysisRun({ runId: assertSafeRunId(runId), source: "meegle", issueKey })
  : undefined;
activeRun?.setLogRoot(logRoot);
```

用外层 `try/catch/finally` 包住所有处理阶段：

- catch 识别取消异常，设置 `stages.CANCELLED`，将 metrics 最终状态写为 `cancelled`，写 `stages.json`、flush logger，并返回不含成功结果的 409/499 JSON。
- cancelled 分支不调用 `scheduleSuccessArchiveToDocupedia`。
- finally 调用 `activeRun?.dispose()`。
- Jira 现有路径的 `activeRun` 为 undefined，行为保持不变。

- [ ] **步骤 3：逐类传递 signal 和子进程登记**

只给内部 helper 增加可选取消上下文，默认 undefined：

```ts
interface ProcessCancellationContext {
  signal: AbortSignal;
  throwIfCancelled(): void;
  trackChild(child: { kill(signal?: NodeJS.Signals | number): boolean }): () => void;
}
```

覆盖以下边界：

- `processImageAttachments` → `downloadAttachment` / `recognizeImageText`。
- `downloadToFile`、Node HTTP 下载、curl/PowerShell/Meegle 下载。
- `extractArchive`、递归解包。
- Python CAN 解析、node plotting、7za 和命令 helper 的所有 `spawn`。
- 所有 `chat()` 和图像模型调用。
- PREPARING、DOWNLOADING、UNPACKING、PARSING、MODEL_INFERENCE、GENERATING_REPLY、SAVING_RESULT 前后调用 `throwIfCancelled()`。

子进程 helper 必须在 exit/error 后调用 `untrack()`；abort 时先 `SIGTERM`，注册表的有界升级逻辑再按测试时钟调用 `SIGKILL`。

- [ ] **步骤 4：确保 metrics 类型允许 cancelled**

将 `finalizePipelineMetrics` 的状态联合扩展为 `"success" | "failed" | "rejected" | "cancelled"`，取消时保留已累计的阶段耗时和产物计数。

- [ ] **步骤 5：运行流水线相关回归**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-analysis-abort-propagation.ts
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase2
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:docupedia-archive
```

预期全部通过，取消用例确认无 success 归档。

- [ ] **步骤 6：提交本任务**

```bash
git add app/api/issues/process/route.ts scripts/test-analysis-abort-propagation.ts scripts/check-meegle-result-lifecycle.mjs
git diff --cached --name-only
git commit -m "feat: 接入共享分析流水线取消"
```

---

### 任务 5：实现 IndexedDB stopped 状态与迟到响应保护

**文件：**
- 修改：`lib/db/schema.ts`
- 修改：`lib/meegle/lifecycle.ts`
- 修改：`stores/meegleProcessStore.ts`
- 修改：`scripts/test-meegle-lifecycle.ts`
- 创建：`scripts/check-meegle-stop-analysis.mjs`

- [ ] **步骤 1：编写失败的状态和源码守卫**

在 `scripts/test-meegle-lifecycle.ts` 增加纯函数行为：

```ts
assert.deepEqual(
  stopMeegleProcessAttempt(
    { status: "processing", latestAttemptTaskId: "run-1" },
    { status: "running", id: "run-1" },
    "run-1",
    stoppedAt,
  ),
  {
    assignmentPatch: { status: "stopped", completedAt: stoppedAt, error: "用户已停止分析" },
    taskPatch: { status: "stopped", completedAt: stoppedAt, error: "用户已停止分析" },
  },
);
assert.equal(canCommitMeegleAttempt({ status: "stopped", latestAttemptTaskId: "run-1" }, "run-1"), false);
assert.equal(canCommitMeegleAttempt({ status: "processing", latestAttemptTaskId: "run-2" }, "run-1"), false);
```

在 `scripts/check-meegle-stop-analysis.mjs` 要求 store 暴露 `stopAssignment`、`stoppingIds`，并要求成功/失败写入前同时检查 `status === "processing"` 和 `latestAttemptTaskId === task.id`。

- [ ] **步骤 2：运行测试验证红灯**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-lifecycle
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node scripts/check-meegle-stop-analysis.mjs
```

预期：FAIL，stopped 状态和 store API 尚不存在。

- [ ] **步骤 3：扩展 schema 和纯生命周期 helper**

- `MeegleAssignment.status` 增加 `stopped`。
- `MeegleProcessTask.status` 增加 `stopped`。
- `stopMeegleProcessAttempt` 只接受 processing/running 且 runId 匹配，否则返回 undefined。
- `canCommitMeegleAttempt` 作为成功、失败、恢复提交的单一条件 helper。
- 陈旧恢复逻辑遇到已 stopped 时保持不变，不改写为 failed。

- [ ] **步骤 4：实现 store 的 run-aware 取消**

Store 合同增加：

```ts
stoppingIds: Set<string>;
stopErrorsByAssignment: Record<string, string | undefined>;
stopAssignment: (assignmentId: string) => Promise<void>;
reanalyzeAssignment: (assignment: MeegleAssignment, group: RuleGroup) => Promise<void>;
```

实现要点：

- 模块级 Map 保存 `{ assignmentId, runId, AbortController }`，处理 fetch 传入 signal。
- `stopAssignment` 在请求前写 stoppingIds，调用 `/api/meegle/cancel`；成功后在同一 Dexie 事务重新检查 current assignment/runId，再 put stopped task/assignment。
- 服务端确认后 abort 客户端等待请求并 reload assignments。
- 取消 API 失败时移除 stoppingIds、保存错误、保持 processing。
- 处理 catch 若该 run 正在 stopping 或数据库已 stopped，跳过 failed 持久化和失败通知。
- 处理 success 在写 result 前读取 current；`canCommitMeegleAttempt` 为 false 时丢弃迟到结果。
- finally 只有活动 Map 的 runId 与自身 task.id 相等时才清理，防止旧 run 清掉新 run。
- `reanalyzeAssignment` 只接受 stopped/failed，清理该行停止错误后调用既有 `processAssignment`，新 task 继续由 nanoid 生成。

- [ ] **步骤 5：运行状态、生命周期和类型检查**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-lifecycle
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node scripts/check-meegle-stop-analysis.mjs
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
```

预期全部通过。

- [ ] **步骤 6：提交本任务**

提交前特别检查 `stores/meegleProcessStore.ts` 的既有陈旧任务恢复改动仍在：

```bash
git diff -- stores/meegleProcessStore.ts
git add lib/db/schema.ts lib/meegle/lifecycle.ts stores/meegleProcessStore.ts scripts/test-meegle-lifecycle.ts scripts/check-meegle-stop-analysis.mjs
git diff --cached --name-only
git commit -m "feat: 持久化飞书分析停止状态"
```

---

### 任务 6：在真实飞书分析表格增加固定操作列

**文件：**
- 修改：`components/analysis/MeegleAnalysisBoard.tsx`
- 修改：`scripts/check-meegle-parity-ui.mjs`
- 修改：`scripts/check-meegle-stop-analysis.mjs`

- [ ] **步骤 1：编写失败的 UI 守卫**

要求真实生产组件而非旧拖拽组件包含：

```js
assert.match(board, /操作/);
assert.match(board, /停止分析/);
assert.match(board, /正在停止/);
assert.match(board, /再次分析/);
assert.match(board, /确认停止当前分析/);
assert.match(board, /stopAssignment/);
assert.match(board, /reanalyzeAssignment/);
assert.match(board, /205px/);
assert.doesNotMatch(legacyCard, /停止分析/);
```

运行 `test:meegle-parity-ui` 和 `check-meegle-stop-analysis.mjs`，预期因操作列不存在而 FAIL。

- [ ] **步骤 2：接入 store 状态和页面 handler**

从 store 订阅 `stoppingIds`、`stopErrorsByAssignment`、`stopAssignment`、`reanalyzeAssignment`。页面 handler 均在完成后调用 `loadData()`；停止前使用明确确认文案：

```ts
if (!window.confirm("确认停止当前分析？服务端运行将被终止，已生成日志会保留。")) return;
await stopAssignment(assignment.id);
```

- [ ] **步骤 3：新增操作列并收敛 AI 状态列职责**

表头和行统一使用：

```ts
gridTemplateColumns: "100px minmax(240px, 1fr) 100px 80px 80px 140px 205px"
```

- AI 状态列只展示阶段、待处理、失败、已停止或结果/复核状态，不再放置处理按钮。
- 操作列使用两个完整文字按钮：停止、分析。
- pending 的分析按钮文案为“开始分析”；failed/stopped 为“再次分析”；processing/completed 时按规格禁用。
- stopping 时停止按钮显示 Loader2 + “正在停止…”，两个按钮均禁用。
- 行级错误以 205px 列内的小号红色文本显示并放在 title 中，不扩大其他列。
- 表格外层允许横向滚动，设置与列宽匹配的 `minWidth`，窄屏不压缩文字为图标。

- [ ] **步骤 4：补充 stopped 状态展示**

`AssignmentStatusBadge` 增加：

```ts
stopped: { color: "var(--c-text-2)", label: "已停止" }
```

AI 状态单元在 stopped 时显示“已停止”，不展示旋转 Loader。

- [ ] **步骤 5：运行 UI、React、类型和 lint 回归**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node scripts/check-meegle-stop-analysis.mjs
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node scripts/check-react-lint-guards.mjs
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
```

预期全部测试退出 0；lint 允许既有 warning，但不得新增 error/warning。

- [ ] **步骤 6：提交本任务**

```bash
git add components/analysis/MeegleAnalysisBoard.tsx scripts/check-meegle-parity-ui.mjs scripts/check-meegle-stop-analysis.mjs
git diff --cached --name-only
git commit -m "feat: 增加飞书单票停止与再次分析操作"
```

---

### 任务 7：同步文档并完成端到端验证

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：更新文档的明确事实**

- PRODUCT：`processing → stopped → processing(new runId)`、按钮可见条件、日志保留。
- ARCHITECTURE：全局运行注册表、取消 API、AbortSignal/子进程、latestAttemptTaskId 竞态门禁。
- WORKFLOW：活动 run 和历史卡死 run 的停止顺序、重复停止、完成冲突、再次分析。
- SEQUENCE_DIAGRAMS：UI → cancel API → registry/subprocess → cancelled.json → IndexedDB，以及迟到 success 被拒绝。
- session-handoff：记录 #7073862958 的实测 runId、取消响应、cancelled.json、刷新后状态与新 runId。

- [ ] **步骤 2：运行完整自动化验证**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-stop-analysis
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-lifecycle
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-mql-filtering
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-filter-results
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:unified-rule-group-board
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-unified-rule-group-workflow.ts
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
git diff --check
```

预期全部退出 0；记录 lint warning 数量并确认无新增。

- [ ] **步骤 3：运行生产构建**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run build
```

若沙箱因 Turbopack 内部端口返回 `Operation not permitted`，按权限流程在沙箱外重跑同一命令；只有退出码 0 才算通过。记录既有文件追踪 warning 数量。

- [ ] **步骤 4：启动真实页面并验证历史卡死任务**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run dev
```

使用浏览器登录现有本地系统，打开 #7073862958 所在 `/analysis/{ruleGroupId}/meegle`：

1. 确认处理中行显示停止按钮与禁用的再次分析按钮。
2. 点击停止并确认；保存取消 API 响应和旧 runId。
3. 检查 `log/chery-8155-others/T1L_FL2_8155_ICE国内/meegle-7073862958/<oldRunId>/cancelled.json`。
4. 刷新页面，确认 assignment 仍为“已停止”。
5. 点击再次分析，检查 IndexedDB/页面对应的新 runId 与 oldRunId 不同。
6. 等待旧请求退出，确认它没有覆盖新 run 或 stopped 历史。

不得在验收中写回飞书评论、改变飞书状态或经办人。

- [ ] **步骤 5：更新 handoff 验证项并做最终差异审查**

```bash
git status --short
git diff --stat
git diff --check
```

逐文件确认未覆盖本计划开始前的 MQL 当前结果边界和陈旧任务恢复改动；`.codegraph/daemon.pid` 与 `.superpowers/brainstorm/` 不进入提交。

- [ ] **步骤 6：提交文档和验证记录**

```bash
git add docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
git diff --cached --name-only
git commit -m "docs: 同步飞书分析停止流程"
```

预期暂存文件只有五个文档路径。

---

## 最终完成标准

- #7073862958 可在真实飞书分析表格中停止，并在刷新后保持“已停止”。
- 对应旧 run 的服务端执行已中止或被确认不活跃，且写有 `cancelled.json`。
- 再次分析创建全新 runId，旧 run 的迟到响应无法覆盖新状态。
- 同规则组其他 Meegle 任务和 Jira 流程不受影响。
- 所有列出的自动化测试、TypeScript、lint、生产构建和端到端检查都有本轮新鲜证据。
- 产品/架构/流程/时序文档及 `session-handoff.md` 已同步。
