# Jira 与飞书项目统一规则组看板实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将飞书项目 MQL 筛选、处理、AI 分析、人工复核和回填接入主页规则组看板，并将 `/meegle` 改为主页入口的兼容跳转。

**架构：** 新增一个客户端规则组工作流编排层，把现有 Jira 的 `filterTaskStore`/`processTaskStore` 与飞书的 `meegleAssignmentStore`/`meegleProcessStore` 组合为同一规则组操作。各平台的 IndexedDB 表和 API 保持隔离；来源标识和统一摘要模型只在编排与展示层使用。Jira 仍执行 JQL，飞书项目仍执行 MQL，任一来源的失败不得影响另一来源。

**技术栈：** Next.js App Router、React、TypeScript、Zustand、Dexie、现有 Jira REST API、现有 Meegle CLI API。

---

## 文件结构

- 创建：`lib/issue-source/contracts.ts` — 来源标识、规则组来源状态和统一票据摘要类型。
- 创建：`stores/ruleGroupWorkflowStore.ts` — 并行协调 Jira 与飞书筛选、处理和来源状态加载。
- 创建：`components/rule-group/RuleGroupSourceStatus.tsx` — 规则组行内的 Jira/飞书来源状态和数量展示。
- 创建：`scripts/test-unified-rule-group-workflow.ts` — 纯函数级来源配置、失败隔离和可处理性回归测试。
- 创建：`scripts/check-unified-rule-group-board.mjs` — 静态回归检查主页编排、来源标签和 `/meegle` 跳转。
- 修改：`components/KanbanBoard.tsx` — 使用统一编排层替换仅 Jira 的筛选、批量处理、规则组处理和自动周期路径。
- 修改：`components/rule-group/RuleGroupList.tsx` — 将每个规则组的双来源摘要传给行组件。
- 修改：`components/rule-group/RuleGroupRow.tsx` — 展示 JQL/MQL、双来源状态，并按任一来源存在可处理票启用处理。
- 修改：`app/meegle/page.tsx` — 替换为跳转主页的兼容路由，不再加载独立看板。
- 修改：`app/meegle/issues/[workItemId]/result/page.tsx` — 保留旧详情路由，并把返回入口改为主页统一看板。
- 修改：`package.json` — 注册统一看板回归脚本。
- 修改：`docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`、`session-handoff.md` — 记录统一入口和来源适配器边界。

## 任务 1：建立来源合同与可测试的规则组状态归纳

**文件：**
- 创建：`lib/issue-source/contracts.ts`
- 创建：`scripts/test-unified-rule-group-workflow.ts`

- [x] **步骤 1：编写失败的来源合同测试**

```ts
import assert from "node:assert/strict";
import {
  getConfiguredSources,
  getRuleGroupProcessEligibility,
} from "@/lib/issue-source/contracts";

assert.deepEqual(getConfiguredSources({ jql: "project = VH", meegleMql: "status = Open" }), ["jira", "meegle"]);
assert.deepEqual(getConfiguredSources({ jql: "", meegleMql: "status = Open" }), ["meegle"]);
assert.equal(
  getRuleGroupProcessEligibility({ jira: { configured: true, status: "failed", issueCount: 0 }, meegle: { configured: true, status: "completed", issueCount: 2 } }),
  true,
);
```

- [x] **步骤 2：运行测试确认失败**

运行：`node --import tsx scripts/test-unified-rule-group-workflow.ts`

预期：FAIL，报错无法解析 `@/lib/issue-source/contracts`。

- [x] **步骤 3：实现最小来源合同**

```ts
import type { RuleGroup } from "@/lib/db/schema";

export type IssueSource = "jira" | "meegle";
export type SourceRunStatus = "idle" | "running" | "completed" | "failed" | "expired" | "disabled";

export interface RuleGroupSourceState {
  configured: boolean;
  status: SourceRunStatus;
  issueCount: number;
  error?: string;
  updatedAt?: Date;
}

export interface RuleGroupSourceSummary {
  jira: RuleGroupSourceState;
  meegle: RuleGroupSourceState;
}

export function getConfiguredSources(group: Pick<RuleGroup, "jql" | "meegleMql">): IssueSource[] {
  return ([
    group.jql?.trim() ? "jira" : undefined,
    group.meegleMql?.trim() ? "meegle" : undefined,
  ] as const).filter((source): source is IssueSource => Boolean(source));
}

export function getRuleGroupProcessEligibility(summary: RuleGroupSourceSummary): boolean {
  return [summary.jira, summary.meegle].some((source) => source.status === "completed" && source.issueCount > 0);
}

export function getProcessSources(summary: RuleGroupSourceSummary): IssueSource[] {
  return (["jira", "meegle"] as const).filter((source) => {
    const state = summary[source];
    return state.status === "completed" && state.issueCount > 0;
  });
}

export function mergeRuleGroupSourceState(
  current: RuleGroupSourceSummary,
  source: IssueSource,
  next: Partial<RuleGroupSourceState>,
): RuleGroupSourceSummary {
  return { ...current, [source]: { ...current[source], ...next } };
}
```

`getConfiguredSources` 只把非空白 JQL/MQL 视为已配置；`getRuleGroupProcessEligibility` 只要任一来源已完成且数量大于 0 即返回 `true`，不得把另一来源失败解释成不可处理。

- [x] **步骤 4：运行测试验证通过**

运行：`node --import tsx scripts/test-unified-rule-group-workflow.ts`

预期：PASS。

- [x] **步骤 5：提交来源合同**

```bash
git add lib/issue-source/contracts.ts scripts/test-unified-rule-group-workflow.ts
git commit -m "feat(统一看板): 添加票据来源状态合同"
```

## 任务 2：把飞书 MQL 筛选抽入统一规则组编排层

**文件：**
- 创建：`stores/ruleGroupWorkflowStore.ts`
- 修改：`stores/filterTaskStore.ts`
- 修改：`stores/meegleAssignmentStore.ts`
- 修改：`scripts/test-unified-rule-group-workflow.ts`

- [x] **步骤 1：扩展测试为双来源失败隔离**

```ts
const afterJiraFailure = mergeRuleGroupSourceState(
  initialSummary,
  "jira",
  { status: "failed", issueCount: 0, error: "Jira 503" },
);
assert.equal(afterJiraFailure.meegle.status, "completed");
assert.equal(afterJiraFailure.meegle.issueCount, 2);
```

- [x] **步骤 2：运行测试确认失败**

运行：`node --import tsx scripts/test-unified-rule-group-workflow.ts`

预期：FAIL，报错 `mergeRuleGroupSourceState is not a function`。

- [x] **步骤 3：实现编排层和各来源返回值**

为 `filterTaskStore.runFilter` 增加成功/失败结果返回值，不删除既有 IndexedDB 写入；为 `meegleAssignmentStore` 增加 `runMqlFilter(group, projectKey)`，把当前 `/meegle` 页的 `getMqlRuleGroups`、`getManualAssignments`、`fetch("/api/meegle/filter")` 和 `applyAutoFilterResult` 逻辑迁入 store。返回统一 `RuleGroupSourceState`，而不是让页面解析 API 审计数据。

`ruleGroupWorkflowStore.runFilter(group)` 按 `getConfiguredSources(group)` 建立来源状态，并使用 `Promise.allSettled` 并发执行：

```ts
const [jira, meegle] = await Promise.allSettled([
  hasJira ? useFilterTaskStore.getState().runFilter(group) : disabledSource(),
  hasMeegle ? useMeegleAssignmentStore.getState().runMqlFilter(group) : disabledSource(),
]);
set((state) => ({
  sourceSummaries: {
    ...state.sourceSummaries,
    [group.id]: combineSettledSourceRuns(jira, meegle),
  },
}));
```

飞书筛选项目键由 `GET /api/meegle/mywork?action=todo` 获取第一个有效 `project_key`；没有项目键时仅将飞书来源标为失败。不得调用、修改或清空 Jira 快照。MQL 筛选继续调用现有 `/api/meegle/filter`，保留 MQL 失败审计和人工分配优先级。

- [x] **步骤 4：运行来源合同测试和既有飞书筛选回归**

运行：

```bash
node --import tsx scripts/test-unified-rule-group-workflow.ts
npm run test:meegle-mql-filtering
npm run test:meegle-filter-assignment
```

预期：全部 PASS。

- [x] **步骤 5：提交筛选编排**

```bash
git add stores/filterTaskStore.ts stores/meegleAssignmentStore.ts stores/ruleGroupWorkflowStore.ts lib/issue-source/contracts.ts scripts/test-unified-rule-group-workflow.ts
git commit -m "feat(统一看板): 并行编排 JQL 与 MQL 筛选"
```

## 任务 3：把主页规则组卡片升级为双来源入口

**文件：**
- 创建：`components/rule-group/RuleGroupSourceStatus.tsx`
- 修改：`components/KanbanBoard.tsx`
- 修改：`components/rule-group/RuleGroupList.tsx`
- 修改：`components/rule-group/RuleGroupRow.tsx`
- 创建：`scripts/check-unified-rule-group-board.mjs`

- [x] **步骤 1：编写失败的主页静态回归检查**

```js
assert.match(read("components/KanbanBoard.tsx"), /useRuleGroupWorkflowStore/);
assert.match(read("components\/rule-group\/RuleGroupRow.tsx"), /RuleGroupSourceStatus/);
assert.match(read("components\/rule-group\/RuleGroupSourceStatus.tsx"), /Jira/);
assert.match(read("components\/rule-group\/RuleGroupSourceStatus.tsx"), /飞书项目/);
```

- [x] **步骤 2：运行检查确认失败**

运行：`node scripts/check-unified-rule-group-board.mjs`

预期：FAIL，报错主页尚未引用 `useRuleGroupWorkflowStore`。

- [x] **步骤 3：实现来源状态组件与主页接线**

`RuleGroupSourceStatus` 接收 `RuleGroupSourceSummary`，为 Jira 与飞书项目各渲染一个紧凑状态块：未配置显示「未配置」，运行中显示「筛选中」，完成显示「N 票」，失败显示「失败」并提供 `title` 错误信息。状态块必须带来源文字，不能只用颜色传达来源。

`KanbanBoard` 改为从 `useRuleGroupWorkflowStore` 获取 `sourceSummaries`、`runFilter` 和 `processRuleGroup`；以下现有入口全部改调统一方法：单规则组筛选、顶部一键筛选、单规则组处理、顶部一键处理和自动周期。保留 Jira 单票输入框原逻辑，它只处理显式 Jira Key。

`RuleGroupList` 新增 `sourceSummaries?: Record<string, RuleGroupSourceSummary>`，并传递给 `RuleGroupRow`。`RuleGroupRow` 使用摘要决定「一键处理」是否可用，并在原 JQL 标签旁展示 MQL 已配置状态；不删除现有 JQL 说明或管理员操作。

- [x] **步骤 4：运行主页回归检查**

运行：

```bash
node scripts/check-unified-rule-group-board.mjs
npm run test:frontend
npm run test:rule-groups
```

预期：全部 PASS。

- [x] **步骤 5：提交主页统一入口**

```bash
git add components/KanbanBoard.tsx components/rule-group/RuleGroupList.tsx components/rule-group/RuleGroupRow.tsx components/rule-group/RuleGroupSourceStatus.tsx scripts/check-unified-rule-group-board.mjs
git commit -m "feat(规则组): 在主页展示双来源筛选状态"
```

## 任务 4：统一按规则组处理 Jira 与飞书项目票据

**文件：**
- 修改：`stores/ruleGroupWorkflowStore.ts`
- 修改：`stores/meegleProcessStore.ts`
- 修改：`components/KanbanBoard.tsx`
- 修改：`scripts/test-unified-rule-group-workflow.ts`

- [x] **步骤 1：编写失败的处理资格与来源隔离测试**

```ts
assert.deepEqual(
  getProcessSources({ jira: { configured: true, status: "completed", issueCount: 3 }, meegle: { configured: true, status: "completed", issueCount: 1 } }),
  ["jira", "meegle"],
);
assert.deepEqual(
  getProcessSources({ jira: { configured: true, status: "failed", issueCount: 0 }, meegle: { configured: true, status: "completed", issueCount: 1 } }),
  ["meegle"],
);
```

- [x] **步骤 2：运行测试确认失败**

运行：`node --import tsx scripts/test-unified-rule-group-workflow.ts`

预期：FAIL，报错 `getProcessSources is not a function`。

- [x] **步骤 3：实现来源分派处理**

在来源合同中实现 `getProcessSources`。`ruleGroupWorkflowStore.processRuleGroup(group)` 分别读取：

- Jira：最新成功 `FilterTask` 的 `filteredIssueSnapshots`，复用 `useProcessTaskStore.getState().runAll(group, snapshots)`；
- 飞书项目：`db.meegleAssignments` 中该规则组、`status === "pending" || status === "failed"` 的分配，逐项复用 `useMeegleProcessStore.getState().processAssignment(assignment, group)`。

两个来源都存在可处理票时，来源级调用以 `Promise.allSettled` 并行启动；飞书单项处理保持其 store 已有的运行集合和结果历史规则，Jira 继续保持其任务/结果订阅规则。编排层记录每个来源的处理错误，但不得将成功来源重新标记为失败。

- [x] **步骤 4：运行处理与生命周期回归**

运行：

```bash
node --import tsx scripts/test-unified-rule-group-workflow.ts
npm run test:process-store-subscriptions
npm run test:meegle-lifecycle
npm run test:meegle-results
```

预期：全部 PASS。

- [x] **步骤 5：提交处理编排**

```bash
git add stores/ruleGroupWorkflowStore.ts stores/meegleProcessStore.ts components/KanbanBoard.tsx lib/issue-source/contracts.ts scripts/test-unified-rule-group-workflow.ts
git commit -m "feat(统一看板): 按来源处理规则组票据"
```

## 任务 5：统一结果入口并迁移 `/meegle` 首页

**文件：**
- 修改：`components/rule-group/RuleGroupRow.tsx`
- 修改：`app/meegle/page.tsx`
- 修改：`app/meegle/issues/[workItemId]/result/page.tsx`
- 修改：`components/meegle/MeegleResultDetail.tsx`
- 修改：`scripts/check-unified-rule-group-board.mjs`

- [x] **步骤 1：扩展静态检查为路由兼容要求**

```js
assert.match(read("app/meegle/page.tsx"), /redirect\("\/"\)/);
assert.match(read("app/meegle/issues/[workItemId]/result/page.tsx"), /MeegleResultDetail/);
assert.match(read("components/meegle/MeegleResultDetail.tsx"), /href="\/"/);
```

- [x] **步骤 2：运行检查确认失败**

运行：`node scripts/check-unified-rule-group-board.mjs`

预期：FAIL，报错 `/meegle` 仍渲染独立工作台。

- [x] **步骤 3：实现统一入口与旧结果详情兼容**

把 `app/meegle/page.tsx` 替换为服务端 `redirect("/")`，不得再请求待办、加载规则组或创建独立 DnD 看板。主页的规则组行添加飞书来源结果入口：按 `MeegleAssignment` 的 `latestResultId`、`status` 和 `assignmentId` 显示「查看飞书结果」，链接仍使用 `/meegle/issues/{workItemId}/result?assignmentId={assignmentId}`，确保历史书签不失效。

`MeegleResultDetail` 的返回链接改为主页 `/`，并在标题区显示「飞书项目」来源标签；现有 AI 复核、人工通过/驳回、校验、回填评论、CAN 图和可选状态流转操作不重写、不降级。

- [x] **步骤 4：运行路由和飞书结果回归**

运行：

```bash
node scripts/check-unified-rule-group-board.mjs
npm run test:meegle-results
npm run test:meegle-lifecycle
```

预期：全部 PASS。

- [x] **步骤 5：提交入口迁移**

```bash
git add app/meegle/page.tsx app/meegle/issues/[workItemId]/result/page.tsx components/rule-group/RuleGroupRow.tsx components/meegle/MeegleResultDetail.tsx scripts/check-unified-rule-group-board.mjs
git commit -m "feat(飞书项目): 跳转主页统一规则组看板"
```

## 任务 6：同步产品文档、交接状态并执行完整验证

**文件：**
- 修改：`package.json`
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [x] **步骤 1：编写失败的脚本注册检查**

在 `scripts/check-unified-rule-group-board.mjs` 追加：

```js
const pkg = JSON.parse(read("package.json"));
assert.equal(pkg.scripts["test:unified-rule-group-board"], "node scripts/check-unified-rule-group-board.mjs");
```

- [x] **步骤 2：运行检查确认失败**

运行：`node scripts/check-unified-rule-group-board.mjs`

预期：FAIL，报错缺少 `test:unified-rule-group-board` 脚本。

- [x] **步骤 3：注册验证脚本并同步文档**

在 `package.json` 注册 `"test:unified-rule-group-board": "node scripts/check-unified-rule-group-board.mjs"`。文档使用中文说明：主页是 Jira 与飞书项目的唯一规则组入口、JQL/MQL 并发与失败隔离、来源适配器、飞书回填幂等评论后状态流转、`/meegle` 到 `/` 的迁移以及旧飞书结果 URL 保留。`session-handoff.md` 只记录本计划实际完成的步骤、命令及结果，不把尚未实现的工作标为完成。

- [x] **步骤 4：执行全量验证**

运行：

```bash
source ~/.bashrc && npm run test:unified-rule-group-board
source ~/.bashrc && node --import tsx scripts/test-unified-rule-group-workflow.ts
source ~/.bashrc && npm run test:meegle-mql-filtering
source ~/.bashrc && npm run test:meegle-filter-assignment
source ~/.bashrc && npm run test:meegle-lifecycle
source ~/.bashrc && npm run test:meegle-results
source ~/.bashrc && npm run test:process-store-subscriptions
source ~/.bashrc && npm run lint
source ~/.bashrc && npx tsc --noEmit
source ~/.bashrc && npm run build
```

预期：全部 PASS；如任何命令失败，仅修复本计划引入的问题，保留当前工作区中无关的预存修改。

- [x] **步骤 5：提交文档与验证配置**

```bash
git add package.json scripts/check-unified-rule-group-board.mjs docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
git commit -m "docs(统一看板): 记录 Jira 与飞书项目工作流"
```
