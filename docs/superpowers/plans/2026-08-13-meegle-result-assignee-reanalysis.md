# 飞书项目结果页经办人与重新分析实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在飞书项目分析结果页安全修改当前票经办人，并可保留旧版本地重新分析当前票。

**架构：** 结果页读取当前工作项详情以取得 `detailReceipt` 和经办人角色，直接复用 `MeegleAssigneeControl` 的完整成员目录搜索与授权写入链路。重新分析复用 `meegleProcessStore.processAssignment`，该 store 已在创建新 task 前把当前 result 写入 `meegleAnalysisHistories`，因此只需由结果页以当前 assignment 和 rule group 触发它，并在任务结束后重新读取本地上下文。

**技术栈：** Next.js App Router、React 19、TypeScript、Zustand、Dexie、既有 Meegle CLI API。

---

## 文件结构

- 修改：`components/meegle/MeegleResultDetail.tsx`：加载工作项详情、渲染经办人控件和重新分析确认操作，并在完成后刷新本地结果上下文。
- 创建：`lib/meegle/users-route.ts`：承载可注入的人员目录查询处理器，避免 Next.js Route Handler 额外导出。
- 修改：`app/api/meegle/users/route.ts`：仅导出 Next.js 要求的 `GET`。
- 修改：`scripts/check-meegle-result-lifecycle.mjs`：守卫结果页使用工作项详情凭据、经办人控件与 Process Store 的重新分析入口。
- 修改：`scripts/check-meegle-parity-ui.mjs`：守卫经办人控件同时出现在当前工单详情与结果页，且结果页保留确认语义。
- 修改：`docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`、`session-handoff.md`：同步结果页操作与历史保留边界。

### 任务 1：结果页操作的失败回归检查

**文件：**
- 修改：`scripts/check-meegle-result-lifecycle.mjs`
- 修改：`scripts/check-meegle-parity-ui.mjs`

- [x] **步骤 1：编写失败的生命周期断言**

在 `check-meegle-result-lifecycle.mjs` 读取 `MeegleResultDetail.tsx` 后增加：

```js
["result detail loads a fresh work-item receipt", resultDetail.includes("/api/meegle/workitem") && resultDetail.includes("detailReceipt")],
["result detail reuses the assignee control", resultDetail.includes("MeegleAssigneeControl")],
["result detail reanalyzes through the existing process store", resultDetail.includes("processAssignment(assignment, group)")],
["result detail confirms reanalysis keeps history", resultDetail.includes("保留当前结果为历史版本")],
```

- [x] **步骤 2：运行测试确认失败**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results`

预期：FAIL，报告结果页未加载详情凭据、未复用经办人控件和未触发重新分析。

- [x] **步骤 3：补充 UI 位置守卫**

在 `check-meegle-parity-ui.mjs` 读取 `MeegleResultDetail.tsx` 并增加：

```js
assert.match(resultDetail, /MeegleAssigneeControl/);
assert.match(resultDetail, /确认重新分析/);
assert.match(resultDetail, /processAssignment/);
```

- [x] **步骤 4：运行 UI 检查确认失败**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui`

预期：FAIL，指出分析结果页尚未包含经办人与重新分析操作。

### 任务 2：在结果页复用安全经办人控件

**文件：**
- 修改：`components/meegle/MeegleResultDetail.tsx`

- [x] **步骤 1：添加工作项详情状态与加载函数**

导入 `useCallback`、`MeegleAssigneeControl` 及 `MeegleWorkItemDetail` 类型；定义如下结果类型与读取函数，身份全部来自 assignment：

```ts
interface WorkItemDetailResponse {
  detail: MeegleWorkItemDetail | null;
  detailReceipt?: string;
  error?: string;
}

const loadWorkItemDetail = useCallback(async () => {
  const params = new URLSearchParams({
    projectKey: assignment.projectKey,
    workItemTypeKey: "issue",
    workItemId: String(assignment.workItemId),
  });
  const response = await fetch(`/api/meegle/workitem?${params}`, { cache: "no-store" });
  const payload = await response.json() as WorkItemDetailResponse;
  if (!response.ok || !payload.detail) throw new Error(payload.error || "无法加载飞书工单详情");
  setWorkItemDetail(payload.detail);
  setDetailReceipt(payload.detailReceipt);
}, [assignment]);
```

在 assignment 上下文加载完成后调用该函数；请求失败仅显示人员操作区的可重试错误，不阻断现有分析结果、历史、复核或回填。

- [x] **步骤 2：渲染「当前票操作」区与经办人控件**

在结果页顶部操作区之后增加独立 section。仅当详情与 `detailReceipt` 可用时渲染：

```tsx
<section className={styles.workspace} aria-label="当前票操作">
  <div className={styles.panel}>
    <h2 className={styles.sectionTitle}>当前票操作</h2>
    <MeegleAssigneeControl
      projectKey={assignment.projectKey}
      workItemTypeKey="issue"
      workItemId={String(assignment.workItemId)}
      assigneeRole={workItemDetail.assigneeRole}
      detailReceipt={detailReceipt}
      updatedAt={workItemDetail.updatedAt}
      reload={loadWorkItemDetail}
    />
  </div>
</section>
```

不改动 `MeegleAssigneeControl` 内的 `/api/meegle/users` 防抖搜索、`/api/meegle/authorize` 授权、`/api/meegle/assignee` 写入或 409 刷新保护。

- [x] **步骤 3：运行经办人和 UI 回归测试**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-assignee
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-user-directory
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
```

预期：全部 PASS。

### 任务 3：从结果页触发并刷新重新分析

**文件：**
- 修改：`components/meegle/MeegleResultDetail.tsx`

- [x] **步骤 1：使用失败断言锁定调用边界**

先保留任务 1 的 `processAssignment(assignment, group)` 断言，并新增顺序断言，保证先取得 assignment 的规则组再触发：

```js
const reanalysisIndex = resultDetail.indexOf("processAssignment(assignment, group)");
assert.ok(resultDetail.indexOf("db.ruleGroups.get(assignment.ruleGroupId)") < reanalysisIndex);
```

- [x] **步骤 2：实现确认和单次运行状态**

从 store 取得 `processAssignment` 与 `runningIds`。在确认后读取 rule group，拒绝缺失组；调用后重新读取 assignment/context/history/validation：

```ts
async function reanalyzeCurrentAssignment() {
  if (!assignment || !confirm("确认重新分析当前票？当前结果会保留为历史版本。")) return;
  await runAction("reanalyze", async () => {
    const group = await db.ruleGroups.get(assignment.ruleGroupId);
    if (!group) throw new Error("当前规则组不存在，无法重新分析");
    await processAssignment(assignment, group);
    await loadResultContext();
  }, "重新分析完成，已生成新的当前结果");
}
```

按钮使用 `busy === "reanalyze" || runningIds.has(assignment.id)` 禁用状态，并显示「正在重新分析…」。不要直接删除或覆盖旧 result；保留 Process Store 既有的 `createMeegleAnalysisHistory` 事务。

- [x] **步骤 3：运行结果生命周期回归测试**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-lifecycle
```

预期：全部 PASS，且重新分析入口只能通过现有 store 生命周期。

### 任务 4：同步产品与交接文档

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [x] **步骤 1：补充产品与架构边界**

在「飞书项目结果生命周期」说明结果页可修改当前票经办人和重新分析；成员搜索来自完整项目目录，经办人写入复用签名授权/冲突保护，重新分析保留历史版本。

- [x] **步骤 2：补充流程与时序**

写明结果页读取 `detailReceipt` 后调用经办人组件，以及确认重新分析到新 snapshot/task/result 的顺序；明确两项操作不自动执行评论或状态流转。

- [x] **步骤 3：更新交接记录**

在 `session-handoff.md` 顶部增加本轮完成项、验证命令及「未向真实飞书项目写入」边界。

### 任务 5：最终验证和提交

**文件：**
- 修改：本计划涉及的全部文件

- [x] **步骤 1：运行定向检查与类型检查**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-assignee
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-user-directory
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-lifecycle
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
git diff --check
```

预期：全部以 exit code 0 结束。

- [x] **步骤 2：运行生产构建**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run build`

预期：构建成功；已有 Turbopack 文件追踪警告可单独记录，但不得有编译或类型错误。

- [x] **步骤 3：提交本次变更**

运行：

```bash
git add components/meegle/MeegleResultDetail.tsx scripts/check-meegle-result-lifecycle.mjs scripts/check-meegle-parity-ui.mjs docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md docs/superpowers/plans/2026-08-13-meegle-result-assignee-reanalysis.md
git commit -m "feat(飞书结果): 支持经办人修改与重新分析"
```

预期：只提交本计划列出的文件，不包含既有的 Qwen、测试或临时下载文件改动。
