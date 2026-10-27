# Docupedia 异步归档与飞书自动周期实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 分析结果在 Docupedia 上传前即可返回并完成飞书结果持久化，主页自动周期同时处理 Jira 和飞书项目。

**架构：** `/api/issues/process` 在两个成功分支完成产物落盘后，使用 Next.js `after()` 注册尽力执行的当前 `logRoot` 归档，不在 HTTP 响应链等待上传。主页 `KanbanBoard` 在统一筛选后调用既有 `processRuleGroup()`，由该 store 按来源分派 Jira 快照和飞书待处理 assignment。

**技术栈：** Next.js 16 Route Handler `after()`、React/Zustand、Dexie IndexedDB、Node 静态回归检查。

---

## 目标文件与职责

- 修改：`app/api/issues/process/route.ts` — 在响应后调度成功票的 Docupedia 归档。
- 修改：`components/KanbanBoard.tsx` — 自动周期改走 Jira/飞书统一处理分派。
- 修改：`scripts/check-docupedia-archive.mjs` — 断言归档不阻塞两个成功响应分支。
- 修改：`scripts/check-unified-rule-group-board.mjs` — 断言自动周期调用统一处理入口。
- 修改：`docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`、`session-handoff.md` — 记录完成语义与自动周期来源范围。

### 任务 1：让 Docupedia 归档不阻塞分析响应

**文件：**
- 修改：`scripts/check-docupedia-archive.mjs`
- 修改：`app/api/issues/process/route.ts:7,190-218,2557-2565,3182-3189`

- [ ] **步骤 1：编写失败的归档响应边界检查**

在 `scripts/check-docupedia-archive.mjs` 替换成功路径 `await archiveSuccessToDocupedia` 断言，加入：

```js
assertContains(processRoute, 'import { after, NextRequest, NextResponse } from "next/server";', "Process route should import Next.js after");
assertContains(processRoute, "after(() => {", "Success archive should be scheduled after the response");
assertContains(processRoute, "void archiveSuccessToDocupedia({", "After callback should start the archive without delaying the response");
assertNotContains(processRoute, "await archiveSuccessToDocupedia({", "Success response paths must not await Docupedia archival");
```

保留两个成功路径均调度归档、拒绝路径不归档、当前 `logRoot` 限定和开关日志的既有检查。

- [ ] **步骤 2：运行检查验证失败**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:docupedia-archive`

预期：FAIL，提示 `Process route should import Next.js after`，因为路由仍只导入 `NextRequest, NextResponse` 且成功路径仍 await 归档。

- [ ] **步骤 3：实现响应后归档调度**

在路由导入中加入 `after`，并增加：

```ts
function scheduleSuccessArchiveToDocupedia(args: Parameters<typeof archiveSuccessToDocupedia>[0]): void {
  after(() => {
    void archiveSuccessToDocupedia(args).then(
      () => args.logger.flush(args.logRoot),
      () => args.logger.flush(args.logRoot),
    );
  });
}
```

两个成功分支的最终 `logger.flush(logRoot)` 后调用该 helper，再立即 `return NextResponse.json<ProcessResponse>(...)`。归档 helper 继续内部捕获错误并写 `DOCUPEDIA` 日志；不改变当前票目录限制、开关或重试语义。

- [ ] **步骤 4：运行归档检查验证通过**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:docupedia-archive`

预期：PASS，输出 `Docupedia archive integration checks passed`。

- [ ] **步骤 5：提交任务 1**

运行：`git add app/api/issues/process/route.ts scripts/check-docupedia-archive.mjs && git commit -m "fix(归档): 将 Docupedia 上传移出分析响应链"`

### 任务 2：让自动周期复用统一 Jira/飞书处理入口

**文件：**
- 修改：`scripts/check-unified-rule-group-board.mjs`
- 修改：`components/KanbanBoard.tsx:7-12,31-34,88-125`

- [ ] **步骤 1：编写失败的自动周期来源覆盖检查**

在 `scripts/check-unified-rule-group-board.mjs` 添加：

```js
const kanban = read("components/KanbanBoard.tsx");
assert.match(kanban, /await processRuleGroup\(group\)/, "Auto cycle should use the unified Jira and Meegle process dispatcher");
assert.doesNotMatch(kanban, /const latestCompletedTask = tasks/, "Auto cycle must not retain Jira-only snapshot selection");
assert.doesNotMatch(kanban, /await runAll\(group, snapshots\)/, "Auto cycle must not bypass Meegle processing");
```

保留对 `ruleGroupWorkflowStore` 的来源隔离和 `Promise.allSettled` 检查。

- [ ] **步骤 2：运行检查验证失败**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:unified-rule-group-board`

预期：FAIL，提示自动周期没有调用 `processRuleGroup(group)`。

- [ ] **步骤 3：实现统一自动周期处理**

在 `KanbanBoard` 删除仅为自动周期服务的 `db`、`runAll` 引用和 Jira 快照查询。筛选后执行：

```ts
await runUnifiedFilter(group);
await loadLatestTasks();
await loadSourceSummaries(ruleGroups);
await processRuleGroup(group);
await markAutoCycleRun(group.id);
```

保留 `activeAutoCycleRuns` 防重入锁与 `finally` 解锁。不得复制 store 的分派逻辑：`processRuleGroup()` 处理 Jira 最新完成快照及飞书 `pending` / `failed` assignments。

- [ ] **步骤 4：运行统一看板检查验证通过**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:unified-rule-group-board`

预期：PASS，输出 `unified rule-group board checks: PASS`。

- [ ] **步骤 5：提交任务 2**

运行：`git add components/KanbanBoard.tsx scripts/check-unified-rule-group-board.mjs && git commit -m "fix(自动周期): 接入飞书项目统一处理"`

### 任务 3：同步文档并运行完整回归

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：同步完成与归档语义**

在五份文档中写入同一规则：主处理响应成功和 IndexedDB 结果持久化决定分析完成、复核和回填资格；Docupedia 只在响应返回后对当前 run `logRoot` 尽力归档，失败不阻断，且应用重启不恢复未完成上传。自动周期统一筛选后调用 `processRuleGroup()`，分别处理 Jira 最新成功快照与飞书 `pending/failed` assignment，来源失败互不污染。

- [ ] **步骤 2：运行回归**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:docupedia-archive
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:unified-rule-group-board
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
git diff --check
```

预期：前三项 PASS；TypeScript 无新增错误；无空白错误。若 `lib/server/qwen.ts` 的既有 `_cachedHost` 未声明错误仍出现，记录为用户未提交文件导致的既有阻断，不修改该文件。

- [ ] **步骤 3：提交任务 3**

运行：`git add docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md && git commit -m "docs(流程): 同步异步归档与飞书自动周期"`
