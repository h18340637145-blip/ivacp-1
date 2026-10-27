# 飞书筛选结果、完整详情与经办人变更实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让规则组持久化展示最近一次飞书 MQL 的 0/N 票，提供不依赖分析结果的完整飞书工单详情，并支持安全、独立地搜索和修改经办人。

**架构：** 新增与 `MeegleAssignment` 分离的筛选任务和筛选快照表，卡片与列表统一读取最近成功快照；新增全字段详情适配器和标准详情页；通过项目成员目录缓存实现部分姓名搜索，并用详情凭据和目标绑定写令牌保护经办人角色替换。现有 MQL 裁决、分析结果和状态流转保持不变。

**技术栈：** Next.js App Router、React、TypeScript、Dexie/IndexedDB、Zustand、Meegle CLI、Node `assert` 测试脚本、ESLint。

---

## 执行前置与工作区边界

- 在专用 worktree 中执行本计划；当前 `main` 工作区包含其他未提交改动，不能混入本功能提交。
- 修改代码前完整阅读 `docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md` 和 `session-handoff.md`。
- 查询符号和影响范围时优先使用 CodeGraph；仅对已确定文件或字面量使用 `rg`/`sed`。
- 所有 Node 命令使用：`source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH`。
- 不执行真实经办人更新验证；写接口使用纯函数测试、授权测试和 CLI `--dry-run`/mock 边界验证。

## 文件结构

### 新建

- `lib/meegle/filter-results.ts`：筛选任务、快照构建和“最近成功任务”纯函数。
- `stores/meegleFilterTaskStore.ts`：飞书筛选任务/快照的 IndexedDB 生命周期。
- `lib/meegle/work-item-detail.ts`：全字段、角色、评论和缺陷描述的规范化类型与纯函数。
- `lib/meegle/assignee.ts`：经办人角色成员比较和 role-operate 构建纯函数。
- `lib/server/meegle-user-directory.ts`：项目团队成员目录构建、缓存、批量用户解析和本地模糊匹配。
- `app/api/meegle/users/route.ts`：部分姓名搜索接口。
- `app/api/meegle/assignee/route.ts`：经办人读取校验与角色替换接口。
- `app/meegle/issues/[workItemId]/page.tsx`：不依赖分析结果的标准详情路由。
- `components/meegle/MeegleWorkItemDetail.tsx`：详情页面容器和分区加载状态。
- `components/meegle/MeegleAssigneeControl.tsx`：人员搜索、选择、确认和刷新。
- `scripts/test-meegle-filter-results.ts`：筛选持久化纯函数测试。
- `scripts/test-meegle-work-item-detail.ts`：详情规范化测试。
- `scripts/test-meegle-user-directory.ts`：成员目录和模糊搜索测试。
- `scripts/test-meegle-assignee.ts`：授权声明、冲突和角色操作测试。
- `scripts/check-meegle-parity-ui.mjs`：卡片、列表和标准详情路由静态回归守卫。

### 修改

- `lib/db/schema.ts`：新增飞书筛选任务/快照类型、表和 Dexie 版本。
- `lib/server/meegle-mql-filtering.ts`：导出按规则组归一化并去重的原始命中结果。
- `app/api/meegle/filter/route.ts`：返回 `filterResults`，保持 assignment/audit 响应兼容。
- `stores/ruleGroupWorkflowStore.ts`：创建/完成/失败飞书筛选任务并从持久化数据恢复摘要。
- `components/rule-group/RuleGroupRow.tsx`：飞书 0/N 票常驻入口和失败/运行提示。
- `components/analysis/MeegleAnalysisBoard.tsx`：列表改读最新筛选快照并关联 assignment 状态。
- `lib/server/meegle-cli.ts`：全字段、用户批量解析、团队和角色更新 helper。
- `app/api/meegle/workitem/route.ts`：严格身份参数、全字段与评论的部分成功响应、详情凭据。
- `lib/server/meegle-write-authorization.ts`：新增详情凭据和 `assignee` 写声明。
- `app/api/meegle/authorize/route.ts`：校验并签发 assignee 写授权。
- `components/meegle/MeegleResultDetail.tsx`：增加返回标准详情入口，不改变现有结果/流转逻辑。
- `package.json`：注册四个专项测试和 UI 守卫。
- `.gitignore`：忽略 `.superpowers/` 原型目录。
- `docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`、`session-handoff.md`：同步已交付行为和后续状态。

## 任务 1：建立飞书筛选任务与快照数据模型

**文件：**
- 创建：`lib/meegle/filter-results.ts`
- 创建：`scripts/test-meegle-filter-results.ts`
- 修改：`lib/db/schema.ts`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的筛选结果纯函数测试**

在 `scripts/test-meegle-filter-results.ts` 覆盖 0 票、最新成功选择、失败任务不覆盖成功任务以及工作项身份去重：

```ts
import assert from "node:assert/strict";
import { buildMeegleFilterSnapshots, latestCompletedMeegleFilterTask } from "../lib/meegle/filter-results";

const older = { id: "old", runId: "r1", ruleGroupId: "g1", projectKey: "p", mql: "SELECT 1", status: "completed" as const, issueCount: 2, createdAt: new Date("2026-08-11T10:00:00Z") };
const failed = { id: "failed", runId: "r2", ruleGroupId: "g1", projectKey: "p", mql: "SELECT 1", status: "failed" as const, issueCount: 0, createdAt: new Date("2026-08-11T11:00:00Z") };
assert.equal(latestCompletedMeegleFilterTask([older, failed])?.id, "old");
assert.equal(latestCompletedMeegleFilterTask([{ ...older, id: "zero", issueCount: 0 }])?.issueCount, 0);

const snapshots = buildMeegleFilterSnapshots({
  taskId: "run:g1",
  ruleGroupId: "g1",
  createdAt: new Date("2026-08-11T12:00:00Z"),
  items: [
    { projectKey: "p", projectName: "项目", workItemTypeKey: "issue", workItemId: 7, workItemName: "A", stateName: "处理中", rawData: {} },
    { projectKey: "p", projectName: "项目", workItemTypeKey: "issue", workItemId: 7, workItemName: "A duplicate", stateName: "处理中", rawData: {} },
  ],
});
assert.equal(snapshots.length, 1);
assert.equal(snapshots[0].workItemId, 7);
```

- [ ] **步骤 2：运行测试并确认因模块不存在而失败**

运行：

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-meegle-filter-results.ts
```

预期：FAIL，包含 `Cannot find module '../lib/meegle/filter-results'`。

- [ ] **步骤 3：实现筛选类型和最小纯函数**

在 `lib/db/schema.ts` 新增：

```ts
export interface MeegleFilterTask {
  id: string;
  runId: string;
  ruleGroupId: string;
  projectKey: string;
  mql: string;
  status: "running" | "completed" | "failed";
  issueCount: number;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface MeegleFilteredIssueSnapshot {
  id: string;
  filterTaskId: string;
  ruleGroupId: string;
  projectKey: string;
  projectName: string;
  workItemTypeKey: string;
  workItemId: number;
  workItemName: string;
  stateName: string;
  rawData: Record<string, unknown>;
  createdAt: Date;
}
```

给 `AnalyzerDB` 增加两个 `Table`，新增 Dexie 版本：

```ts
this.version(9).stores({
  meegleFilterTasks: "id, runId, ruleGroupId, status, createdAt",
  meegleFilteredIssueSnapshots: "id, filterTaskId, ruleGroupId, workItemId, createdAt",
});
```

在 `lib/meegle/filter-results.ts` 实现稳定身份键、去重构建和最新成功选择；排序必须使用 `createdAt`，相同时间用 `id` 稳定兜底。

- [ ] **步骤 4：注册测试并验证通过**

在 `package.json` 增加：

```json
"test:meegle-filter-results": "node --import tsx scripts/test-meegle-filter-results.ts"
```

运行：

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-filter-results
```

预期：PASS，输出 `Meegle filter result tests passed.`。

- [ ] **步骤 5：提交任务 1**

```bash
git add lib/db/schema.ts lib/meegle/filter-results.ts scripts/test-meegle-filter-results.ts package.json
git commit -m "feat: 持久化飞书筛选任务与快照"
```

## 任务 2：让 MQL 接口返回可持久化的原始命中集合

**文件：**
- 修改：`lib/server/meegle-mql-filtering.ts`
- 修改：`app/api/meegle/filter/route.ts`
- 修改：`scripts/test-meegle-mql-filtering.ts`

- [ ] **步骤 1：为按规则组归一化结果添加失败测试**

在 `scripts/test-meegle-mql-filtering.ts` 增加断言：同一身份重复项只保留一张，原始命中不因人工分配或高优先级裁决而消失，失败组没有成功结果：

```ts
const rawIssue = (workItemId: number) => ({
  work_item_id: workItemId,
  work_item_type_key: "issue",
  project_key: "p",
  name: `工单 ${workItemId}`,
  status: "处理中",
});
const results = normalizeMeegleFilterResults({
  projectKey: "p",
  queryResults: [
    { ruleGroupId: "g1", items: [rawIssue(7), rawIssue(7)] },
    { ruleGroupId: "g2", error: new Error("query failed") },
  ],
});
assert.equal(results.g1.length, 1);
assert.equal(results.g1[0].workItemId, 7);
assert.equal(Object.hasOwn(results, "g2"), false);
```

- [ ] **步骤 2：运行现有 MQL 测试并确认新导出不存在**

运行：

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-mql-filtering
```

预期：FAIL，指出 `normalizeMeegleFilterResults` 未导出。

- [ ] **步骤 3：实现规范化返回并接入路由**

新增共享类型：

```ts
export interface MeegleFilteredItem {
  projectKey: string;
  projectName: string;
  workItemTypeKey: string;
  workItemId: number;
  workItemName: string;
  stateName: string;
  rawData: Record<string, unknown>;
}
```

`/api/meegle/filter` 响应增加：

```ts
filterResults: Record<string, MeegleFilteredItem[]>;
```

`total` 改为目标规则组 `filterResults[groupId].length` 的和，确保票数与实际快照一致；保留 `assignments`、`audits`、`successfulRuleGroupIds` 字段兼容现有调用方。

- [ ] **步骤 4：运行 MQL 与 assignment 回归测试**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-mql-filtering
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-filter-assignment
```

预期：两组均 PASS；唯一归属、失败组保留和人工分配保护断言不变。

- [ ] **步骤 5：提交任务 2**

```bash
git add lib/server/meegle-mql-filtering.ts app/api/meegle/filter/route.ts scripts/test-meegle-mql-filtering.ts
git commit -m "feat: 返回飞书 MQL 原始筛选集合"
```

## 任务 3：持久化筛选生命周期并接入卡片和列表

**文件：**
- 创建：`stores/meegleFilterTaskStore.ts`
- 创建：`scripts/check-meegle-parity-ui.mjs`
- 修改：`stores/ruleGroupWorkflowStore.ts`
- 修改：`components/rule-group/RuleGroupRow.tsx`
- 修改：`components/analysis/MeegleAnalysisBoard.tsx`
- 修改：`package.json`

- [ ] **步骤 1：编写 UI 与持久化静态守卫**

`scripts/check-meegle-parity-ui.mjs` 至少读取目标文件并断言：

```js
check("card renders configured Meegle badge without truthy count gate",
  source.includes("sourceSummary?.meegle.configured") && !source.includes("!sourceSummary.meegle.issueCount"));
check("Meegle board reads filtered snapshots",
  board.includes("meegleFilteredIssueSnapshots") && !board.includes('db.meegleAssignments\n        .where("ruleGroupId")'));
check("zero count links to Meegle result list",
  source.includes('/analysis/${groupId}/meegle'));
```

- [ ] **步骤 2：运行守卫并确认当前 0 票隐藏、列表读 assignment**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node scripts/check-meegle-parity-ui.mjs
```

预期：FAIL，至少报告 `card renders configured Meegle badge without truthy count gate`。

- [ ] **步骤 3：实现筛选任务 store**

提供明确方法：

```ts
startTask(input): Promise<MeegleFilterTask>
completeTask(taskId, items): Promise<void>
failTask(taskId, error): Promise<void>
loadLatestCompleted(groups): Promise<Record<string, MeegleFilterTask | undefined>>
loadSnapshots(taskId): Promise<MeegleFilteredIssueSnapshot[]>
```

`completeTask` 必须在一个 Dexie 事务中删除该 task 的旧快照、批量写入新快照并更新任务为 `completed`；空数组合法。

- [ ] **步骤 4：接入 workflow、卡片和列表**

`runMeegleFilter` 在请求前 `startTask`，成功后 `completeTask`，异常时 `failTask` 后重新抛出。`loadSourceSummaries` 从最新成功任务读取 `issueCount`。

`MeegleBadge` 只以 `configured` 决定是否渲染，显示：

```tsx
飞书 {sourceSummary.meegle.issueCount ?? 0} 票
```

`MeegleAnalysisBoard` 读取最新成功 task 的 snapshots，并按工作项身份查找 assignment。只有 assignment 当前仍属于该规则组时才允许处理；否则展示“未分配/归属其他组”，但详情链接保持可用。

- [ ] **步骤 5：运行专项与既有结果测试**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-filter-results
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node scripts/check-meegle-parity-ui.mjs
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
```

预期：全部 PASS；0 票徽标和快照列表守卫通过。

- [ ] **步骤 6：注册守卫并提交任务 3**

在 `package.json` 增加：

```json
"test:meegle-parity-ui": "node scripts/check-meegle-parity-ui.mjs"
```

```bash
git add stores/meegleFilterTaskStore.ts stores/ruleGroupWorkflowStore.ts components/rule-group/RuleGroupRow.tsx components/analysis/MeegleAnalysisBoard.tsx scripts/check-meegle-parity-ui.mjs package.json
git commit -m "feat: 常驻展示飞书筛选票数与列表"
```

## 任务 4：规范化全字段详情和评论

**文件：**
- 创建：`lib/meegle/work-item-detail.ts`
- 创建：`scripts/test-meegle-work-item-detail.ts`
- 修改：`lib/server/meegle-cli.ts`
- 修改：`app/api/meegle/workitem/route.ts`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的详情规范化测试**

测试输入必须包含：101 个分页字段、`description` 中的“实际结果”、独立 `缺陷描述` 字段、经办人角色、带 Markdown 图片的评论以及 creator user key：

```ts
const detail = normalizeMeegleWorkItemDetail({
  identity: { projectKey: "p", workItemTypeKey: "issue", workItemId: "7" },
  workItem: {
    work_item_attribute: { role_members: [{ key: "role_x", name: "经办人", members: [{ key: "u1", name: "旧用户" }] }] },
    work_item_fields: [
      { key: "description", name: "描述", value: "【实际结果】充电时间不符\n【期待结果】时间相符" },
      { key: "defect", name: "缺陷描述", value: "必须完整显示" },
    ],
  },
  comments: [{ comment_id: "c1", creator: "u2", created_at: "2026-08-11 10:00:00", content: "备注正文\n![](https://example.test/a.png)" }],
  users: [{ key: "u2", name: "评论人" }],
});
assert.equal(detail.descriptionFields.some((field) => field.name === "缺陷描述"), true);
assert.equal(detail.assigneeRole?.key, "role_x");
assert.equal(detail.comments[0].authorName, "评论人");
assert.equal(detail.comments[0].body.includes("备注正文"), true);
assert.equal(detail.comments[0].attachments.length, 1);
```

- [ ] **步骤 2：运行测试并确认模块不存在**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-meegle-work-item-detail.ts
```

预期：FAIL，指出详情规范化模块不存在。

- [ ] **步骤 3：实现 CLI helper 和规范化纯函数**

把 `getMeegleWorkItem` 改为：

```ts
return runMeegleJson(["workitem", "get", "--project-key", projectKey,
  "--work-item-id", workItemId, "--fields", '["_all"]', "--auto-paginate"]);
```

新增 `resolveMeegleUsers(userKeys)`，每批最多 20 个 key。规范化函数保留字段值结构，仅为展示派生 description fields、assignee role、纯文本正文和安全附件 URL；不得用正则删除整段换行。

- [ ] **步骤 4：重写详情 GET 接口为部分成功响应**

严格要求 `projectKey, workItemTypeKey=issue, workItemId`。使用 `Promise.allSettled` 并返回：

```ts
{
  detail: MeegleWorkItemDetail | null,
  errors: { workItem?: string; comments?: string; commentAuthors?: string }
}
```

工作项失败时 HTTP 502；仅评论或作者解析失败时 HTTP 200 并保留已成功的详情。

- [ ] **步骤 5：运行详情测试并注册脚本**

在 `package.json` 增加：

```json
"test:meegle-workitem-detail": "node --import tsx scripts/test-meegle-work-item-detail.ts"
```

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-workitem-detail
```

预期：PASS，输出 `Meegle work item detail tests passed.`。

- [ ] **步骤 6：提交任务 4**

```bash
git add lib/meegle/work-item-detail.ts lib/server/meegle-cli.ts app/api/meegle/workitem/route.ts scripts/test-meegle-work-item-detail.ts package.json
git commit -m "feat: 加载飞书全字段详情与评论"
```

## 任务 5：新增不依赖分析结果的标准详情页

**文件：**
- 创建：`app/meegle/issues/[workItemId]/page.tsx`
- 创建：`components/meegle/MeegleWorkItemDetail.tsx`
- 修改：`components/analysis/MeegleAnalysisBoard.tsx`
- 修改：`components/meegle/MeegleResultDetail.tsx`
- 修改：`scripts/check-meegle-parity-ui.mjs`

- [ ] **步骤 1：扩展静态守卫并确认失败**

新增断言：标准详情路由存在；列表链接不再直接指向 `/result`；详情组件展示“基本信息”“描述”“缺陷描述”“评论 / 备注”。

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
```

预期：FAIL，报告标准详情路由或详情分区缺失。

- [ ] **步骤 2：实现服务端路由参数和客户端详情容器**

页面读取 `projectKey`、`workItemTypeKey`、`ruleGroupId` 查询参数并传给组件。组件在同一文件内定义专用展示子组件并分别渲染：

```tsx
<MeegleBasicInfo attributes={detail.attributes} assigneeRole={detail.assigneeRole} />
<MeegleDescription fields={detail.descriptionFields} />
<MeegleComments comments={detail.comments} error={errors.comments} />
```

正文一律使用 React 文本节点和 `whiteSpace: "pre-wrap"`；附件使用受控 `<a>`/图片代理，不使用 `dangerouslySetInnerHTML`。

- [ ] **步骤 3：更新所有筛选列表链接和结果页返回入口**

快照列表链接格式：

```ts
`/meegle/issues/${snapshot.workItemId}?projectKey=${encodeURIComponent(snapshot.projectKey)}&workItemTypeKey=${encodeURIComponent(snapshot.workItemTypeKey)}&ruleGroupId=${encodeURIComponent(ruleGroupId)}`
```

详情页根据 assignment 的 `latestResultId` 显示“查看分析结果”；结果页提供“查看当前工单详情”返回入口。现有结果页评论和状态流转逻辑不移动。

- [ ] **步骤 4：验证静态守卫和 React lint**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx eslint app/meegle/issues/[workItemId]/page.tsx components/meegle/MeegleWorkItemDetail.tsx components/analysis/MeegleAnalysisBoard.tsx components/meegle/MeegleResultDetail.tsx
```

预期：全部 PASS，无 React hooks error。

- [ ] **步骤 5：提交任务 5**

```bash
git add app/meegle/issues/[workItemId]/page.tsx components/meegle/MeegleWorkItemDetail.tsx components/analysis/MeegleAnalysisBoard.tsx components/meegle/MeegleResultDetail.tsx scripts/check-meegle-parity-ui.mjs
git commit -m "feat: 展示飞书当前完整工单详情"
```

## 任务 6：构建项目成员目录和部分姓名搜索

**文件：**
- 创建：`lib/server/meegle-user-directory.ts`
- 创建：`app/api/meegle/users/route.ts`
- 创建：`scripts/test-meegle-user-directory.ts`
- 修改：`lib/server/meegle-cli.ts`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的目录聚合与搜索测试**

用依赖注入 fake 覆盖 2 个团队、重复 user key、超过 20 个 key 的分批解析、中文部分姓名和团队失败：

```ts
const directory = await buildMeegleUserDirectory("p", {
  listTeams: async () => [{ teamId: "t1", teamName: "A" }, { teamId: "t2", teamName: "B" }],
  listMembers: async (_project, teamId) => teamId === "t1" ? ["u1", "u2"] : ["u2", "u3"],
  resolveUsers: async (keys) => keys.map((key) => ({ key, name: key === "u2" ? "卫晨雨" : `用户${key}`, email: `${key}@test` })),
});
assert.equal(directory.length, 3);
assert.deepEqual(searchMeegleUsers(directory, "晨雨").map((user) => user.key), ["u2"]);
await assert.rejects(() => buildMeegleUserDirectory("p", {
  listTeams: async () => [{ teamId: "t1", teamName: "A" }],
  listMembers: async () => { throw new Error("upstream failed"); },
  resolveUsers: async () => [],
}), /成员目录加载失败/);
```

- [ ] **步骤 2：运行测试确认模块不存在**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-meegle-user-directory.ts
```

预期：FAIL，指出 `meegle-user-directory` 不存在。

- [ ] **步骤 3：实现 CLI helper、目录构建和缓存**

helper 解析实际返回：`team list` 的 `data[{team_id,team_name}]`；`team list-members` 的 `members: string[]`；`user search` 每批最多 20 个 key。

目录构建限制团队查询并发为 6，任何团队或用户批次失败都拒绝整个构建。按 `projectKey` 缓存完整成功目录 5 分钟；失败结果不缓存。姓名/邮箱搜索使用 `normalize("NFKC").toLocaleLowerCase()` 后的 `includes`，最多返回 50 人并按姓名、user key 稳定排序。

- [ ] **步骤 4：实现 GET 搜索接口**

要求 `projectKey` 和至少 1 个非空字符的 `q`；返回：

```ts
{ users: Array<{ key: string; name: string; email?: string; teamNames: string[] }>, complete: true }
```

目录构建失败返回 502 和安全中文错误；不返回部分结果。

- [ ] **步骤 5：注册并运行目录测试**

先在 `package.json` 注册：

```json
"test:meegle-user-directory": "node --import tsx scripts/test-meegle-user-directory.ts"
```

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-user-directory
```

预期：PASS，输出 `Meegle user directory tests passed.`。

- [ ] **步骤 6：提交任务 6**

```bash
git add lib/server/meegle-user-directory.ts app/api/meegle/users/route.ts scripts/test-meegle-user-directory.ts lib/server/meegle-cli.ts package.json
git commit -m "feat: 支持飞书人员部分姓名搜索"
```

## 任务 7：实现详情凭据和经办人角色替换

**文件：**
- 创建：`lib/meegle/assignee.ts`
- 创建：`app/api/meegle/assignee/route.ts`
- 创建：`scripts/test-meegle-assignee.ts`
- 修改：`lib/server/meegle-write-authorization.ts`
- 修改：`app/api/meegle/authorize/route.ts`
- 修改：`app/api/meegle/workitem/route.ts`
- 修改：`lib/server/meegle-cli.ts`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的凭据、冲突和角色操作测试**

测试必须固定排序 expected users，验证篡改 target、expected users 或 work item 均失败：

```ts
const detailReceipt = createMeegleDetailReceipt({
  projectKey: "p", workItemTypeKey: "issue", workItemId: "7",
  assigneeRoleKey: "role_x", assigneeUserKeys: ["u2", "u1"], updatedAt: "v1",
});
const expectedCurrentUserKeys = ["u1", "u2"];
const claims = { action: "assignee" as const, projectKey: "p", workItemTypeKey: "issue" as const,
  workItemId: "7", expectedCurrentUserKeys, targetUserKey: "u3", detailReceipt };
const token = createMeegleWriteAuthorization(claims);
verifyMeegleWriteAuthorization(token, claims);
assert.throws(() => verifyMeegleWriteAuthorization(token, { ...claims, targetUserKey: "u4" }));
assert.deepEqual(buildAssigneeRoleOperate("role_x", expectedCurrentUserKeys, "u3"), [
  { op: "remove", role_key: "role_x", user_keys: ["u1", "u2"] },
  { op: "add", role_key: "role_x", user_keys: ["u3"] },
]);
```

`buildAssigneeRoleOperate` 从 `lib/meegle/assignee.ts` 导入；凭据函数从 `lib/server/meegle-write-authorization.ts` 导入。

- [ ] **步骤 2：运行测试并确认新 action/函数不存在**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node --import tsx scripts/test-meegle-assignee.ts
```

预期：FAIL，指出 `createMeegleDetailReceipt` 或 `buildAssigneeRoleOperate` 不存在。

- [ ] **步骤 3：把授权声明改为判别联合类型**

保持现有 comment/transition 字段不变，新增：

```ts
export interface MeegleAssigneeWriteClaims {
  action: "assignee";
  projectKey: string;
  workItemTypeKey: "issue";
  workItemId: string;
  expectedCurrentUserKeys: string[];
  targetUserKey: string;
  detailReceipt: string;
}
```

详情凭据签名内容包括角色 key、排序后的当前成员 keys 和 `updatedAt`。`/api/meegle/workitem` 成功读取详情时签发该凭据。`/authorize` 对 assignee 分支验证详情凭据，不要求 `resultId` 或 `analysisReceipt`；comment/transition 分支仍要求原字段。

- [ ] **步骤 4：实现经办人 POST 接口**

流程必须按以下顺序：验证写 token；重新读取详情；动态查找名称精确为“经办人”的角色；比较排序后的当前 keys；若与 expected 不同返回 409；若目标已是唯一经办人返回 `{success:true, changed:false}`；否则确认目标用户可解析，再调用：

```ts
runMeegleJson(["workitem", "update", "--project-key", projectKey,
  "--work-item-id", workItemId, "--role-operate", JSON.stringify(roleOperate)]);
```

成功返回 `{success:true, changed:true}`。CLI 错误返回安全 502，不泄露命令和令牌。

- [ ] **步骤 5：注册并运行授权与既有生命周期回归测试**

先在 `package.json` 注册：

```json
"test:meegle-assignee": "node --import tsx scripts/test-meegle-assignee.ts"
```

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-assignee
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
```

预期：全部 PASS，现有 comment/transition 授权断言不变。

- [ ] **步骤 6：提交任务 7**

```bash
git add lib/meegle/assignee.ts app/api/meegle/assignee/route.ts scripts/test-meegle-assignee.ts lib/server/meegle-write-authorization.ts app/api/meegle/authorize/route.ts app/api/meegle/workitem/route.ts lib/server/meegle-cli.ts package.json
git commit -m "feat: 安全修改飞书工单经办人"
```

## 任务 8：接入独立经办人交互

**文件：**
- 创建：`components/meegle/MeegleAssigneeControl.tsx`
- 修改：`components/meegle/MeegleWorkItemDetail.tsx`
- 修改：`scripts/check-meegle-parity-ui.mjs`

- [ ] **步骤 1：扩展 UI 守卫并确认失败**

守卫断言详情包含独立经办人组件、部分姓名输入、当前到目标预览、授权请求和 assignee POST；禁止把 assignee 参数传给 `/api/meegle/workflow`。

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
```

预期：FAIL，报告 assignee control 缺失。

- [ ] **步骤 2：实现搜索和二次确认组件**

组件状态至少包含：

```ts
query, users, selectedUser, searchStatus, confirmOpen, submitStatus, error
```

输入 300ms 防抖，每次新请求取消旧 `AbortController`。选择人员后展示 `当前：{currentNames} -> 目标：{selectedUser.name}`；只有用户点击确认按钮才先请求 `/api/meegle/authorize`，再携带 token 请求 `/api/meegle/assignee`。

- [ ] **步骤 3：处理成功、409 和其他失败**

- 成功：关闭确认框，清空选择，调用父组件 `reload()`。
- 409：显示“经办人已被其他人修改，请刷新后重新确认”，并立即刷新详情。
- 搜索 502：不保留旧候选，显示“人员目录加载失败，可重试”。
- 更新 502：保留当前经办人和已选目标，允许再次确认。
- 状态流转区域不读取此组件状态，也不因成功自动执行 workflow。

- [ ] **步骤 4：运行 UI 守卫、组件 lint 和类型检查**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx eslint components/meegle/MeegleAssigneeControl.tsx components/meegle/MeegleWorkItemDetail.tsx
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
```

预期：全部 PASS。

- [ ] **步骤 5：提交任务 8**

```bash
git add components/meegle/MeegleAssigneeControl.tsx components/meegle/MeegleWorkItemDetail.tsx scripts/check-meegle-parity-ui.mjs
git commit -m "feat: 新增飞书经办人独立流转操作"
```

## 任务 9：同步文档并完成全量回归

**文件：**
- 修改：`.gitignore`
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：更新产品与架构文档**

`PRODUCT.md` 明确卡片最近成功原始 MQL 命中口径、0 票入口、完整详情和独立经办人操作；`ARCHITECTURE.md` 记录 filter task/snapshot 与 assignment 的边界、成员目录缓存、详情/写授权接口。

- [ ] **步骤 2：更新流程、时序图和交接文档**

`WORKFLOW.md` 添加筛选持久化、详情读取和人员更新流程；`SEQUENCE_DIAGRAMS.md` 添加 MQL 快照写入、跨团队目录构建、详情凭据到经办人更新的时序；`session-handoff.md` 把本功能记为已完成，并记录验证命令和仍存在的真实待处理项。

- [ ] **步骤 3：忽略视觉原型目录**

在 `.gitignore` 增加一行：

```gitignore
.superpowers/
```

不得提交 `.superpowers/brainstorm/` 中的 HTML、事件或服务信息。

- [ ] **步骤 4：运行全部相关专项测试**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-mql-filtering
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-filter-assignment
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-filter-results
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-workitem-detail
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-user-directory
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-assignee
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-parity-ui
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-results
```

预期：全部 PASS。

- [ ] **步骤 5：运行项目级质量门禁**

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run build
git diff --check
```

预期：类型检查、构建和 diff check 通过；lint 为 0 errors，既有 warnings 单独报告。

- [ ] **步骤 6：浏览器端到端验证**

使用 webpack dev 启动：

```bash
source ~/.bashrc && PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run dev
```

验证：规则组卡片在 0 票和 N 票时均可点击；刷新后数字不变；0 票进入空列表；N 票列表数量一致；未分析票可打开完整描述和评论；部分姓名能返回完整名称；经办人确认框显示当前到目标。经办人最终 POST 使用 mock 或明确不提交，避免修改真实飞书工单。

- [ ] **步骤 7：提交文档与最终验证结果**

```bash
git add .gitignore docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
git commit -m "docs: 同步飞书筛选详情与经办人流程"
```

## 完成判定

- 所有 9 个任务按顺序完成且各自验证通过。
- 卡片数量与最新成功筛选快照完全一致，0 票也持久化并可点击。
- 详情不依赖分析结果，完整展示描述、缺陷描述和评论/备注。
- 部分姓名搜索基于完整项目成员目录，失败时不返回伪全量结果。
- 经办人更新使用动态角色 key、并发冲突保护和目标绑定授权，不修改状态。
- 现有 Jira、Meegle MQL、assignment、分析结果、评论和状态流转无回归。
- 文档和 `session-handoff.md` 已同步，原型目录未进入提交。
