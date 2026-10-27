# 飞书项目长耗时分析持久化修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 移除 Meegle 持久化主链路中的服务端回环请求，让超过 300 秒的共享分析成功响应仍能进入 IndexedDB。

**架构：** `meegleProcessStore` 在保存 context snapshot/task 后直接调用 `/api/issues/process`，请求体携带 Meegle 来源与 task run ID。现有成功和失败 Dexie 事务保持不变，旧 `/api/meegle/analyze` 仅保留兼容用途。

**技术栈：** Next.js 16 App Router、React 19、TypeScript、Zustand、Dexie、Node 静态回归脚本。

---

## 文件职责

- `scripts/check-meegle-result-lifecycle.mjs`：锁定 Meegle 主处理请求不能再次经过回环 adapter。
- `stores/meegleProcessStore.ts`：构造共享处理请求并持久化成功响应。
- `docs/ARCHITECTURE.md`：记录浏览器直接调用共享处理路由的边界。
- `docs/WORKFLOW.md`：更新 Meegle 单票处理步骤。
- `docs/SEQUENCE_DIAGRAMS.md`：更新分析时序参与者和调用关系。
- `session-handoff.md`：记录根因、修复和验证状态。

### 任务 1：建立回归红灯

**文件：**
- 修改：`scripts/check-meegle-result-lifecycle.mjs`

- [x] **步骤 1：添加主链路断言**

在 checks 中加入以下语义断言：

```javascript
["Meegle store calls the shared process route directly",
  processStore.includes('fetch("/api/issues/process"')],
["Meegle store avoids the server-side analyze loopback",
  !processStore.includes('fetch("/api/meegle/analyze"')],
["Meegle direct process request preserves source and run identity",
  processStore.includes('issueKey: `meegle-${assignment.workItemId}`')
    && processStore.includes('source: "meegle"')
    && processStore.includes("runId: task.id")],
```

- [x] **步骤 2：运行测试验证失败**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results`

预期：FAIL，报告 store 尚未直接调用共享处理路由，且仍调用 analyze 回环路由。

### 任务 2：实现最小修复

**文件：**
- 修改：`stores/meegleProcessStore.ts:144-164`

- [x] **步骤 1：改为直接调用共享处理路由**

将分析请求替换为：

```typescript
const analyzeResponse = await fetch("/api/issues/process", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    issueKey: `meegle-${assignment.workItemId}`,
    summary: assignment.workItemName,
    rawData: {
      ...snapshot.rawData,
      source: "meegle",
      projectKey: assignment.projectKey,
      workItemTypeKey: assignment.workItemTypeKey,
      workItemId: String(assignment.workItemId),
      status: assignment.stateName,
      project: assignment.projectName,
    },
    prompts: group.prompts,
    basePaths: group.base_paths,
    modelToFiles: group.model_to_files,
    ruleGroupId: group.id,
    ruleGroupName: group.name,
    source: "meegle",
    runId: task.id,
  }),
});
```

保留后续响应解析及 Dexie transaction，不修改 Jira store 或共享流水线。

- [x] **步骤 2：运行目标测试验证绿灯**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results`

预期：所有 Meegle result lifecycle checks 通过。

### 任务 3：同步文档与交接

**文件：**
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [x] **步骤 1：更新数据流说明**

将 `meegleProcessStore -> /api/meegle/analyze -> /api/issues/process` 改为 `meegleProcessStore -> /api/issues/process`，说明这是为了避免长耗时分析经过服务端回环请求。

- [x] **步骤 2：记录兼容边界**

明确 `/api/meegle/analyze` 暂时保留旧调用兼容，但不参与持久化主链路。

### 任务 4：完成验证

**文件：**
- 验证：本计划涉及的全部文件

- [x] **步骤 1：运行相关行为回归和类型检查**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-lifecycle
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
```

预期：全部退出码为 0。

- [x] **步骤 2：运行 lint 和差异检查**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
git diff --check
```

结果：本次文件定向 lint 无 error，`git diff --check` 退出码为 0。全量 lint 的唯一 error 来自本轮未修改的未提交文件 `components/analysis/MeegleAnalysisBoard.tsx:55`；其余为既有 warning。
