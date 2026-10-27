# 飞书项目 Jira 同构筛票实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将飞书项目首页调整为 Jira 规则组同构界面，并将全量 `mywork todo` 的 Qwen 分类、确定性规则组匹配、手工分配保护和可追溯筛选日志完整落地。

**架构：** 服务端 `/api/meegle/auto-assign` 负责全量待办翻页、工作项描述补齐、固定 `Qwen3-32B-FP16` 分类和确定性匹配；浏览器只将结果写入飞书专用 Dexie assignment/audit 表。`/meegle` 使用 Jira 规则组行的视觉与按钮语义，但用飞书筛选状态、已归属数量和审计记录取代 JQL 快照。

**技术栈：** Next.js App Router、React、TypeScript、Zustand、Dexie、Meegle CLI、Qwen API、Node 静态回归检查。

---

## 计划文件结构

- 修改：`lib/db/schema.ts`：定义 assignment 来源、筛选运行与审计记录，并把 Dexie 升级到新版本。
- 修改：`stores/meegleAssignmentStore.ts`：区分人工和自动分配，保护人工分配，并持久化接口返回的审计事件。
- 创建：`lib/server/meegle-filtering.ts`：纯函数化车型/项目/平台归一化、规则组匹配和可测试的决策理由。
- 修改：`app/api/meegle/auto-assign/route.ts`：全量翻页、描述补齐、固定模型分类、按范围返回候选及审计事件。
- 删除：`app/api/meegle/classify/route.ts`：移除重复且不具备全量筛选语义的分类入口。
- 修改：`app/meegle/page.tsx`：接入新的筛选响应、手工分配语义和 Jira 同构规则组总览。
- 修改：`components/meegle/MeegleRuleGroupLane.tsx`：替换为 Jira 规则组行风格的飞书适配展示，保留当前规则组筛选及处理入口。
- 修改：`components/meegle/MeegleUnassignedPool.tsx`：展示未匹配/已取消分配工单与最近审计原因。
- 创建：`components/meegle/MeegleFilterAuditLog.tsx`：按全量运行或规则组筛选展示可追溯日志。
- 创建：`scripts/test-meegle-filter-assignment.ts`：覆盖匹配和手工保护的行为测试。
- 创建：`scripts/check-meegle-filter-assignment.mjs`：静态验证 API、Dexie、页面和文档的连接关系。
- 修改：`package.json`：注册 `test:meegle-filter-assignment`。
- 修改：`docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`、`session-handoff.md`：同步飞书筛票来源、行为、持久化边界和版本记录。

### 任务 1：先锁定分类、匹配和保护契约

**文件：**
- 创建：`lib/server/meegle-filtering.ts`
- 创建：`scripts/test-meegle-filter-assignment.ts`

- [ ] **步骤 1：编写失败的纯逻辑测试**

```ts
import assert from "node:assert/strict";
import { decideMeegleAssignment, normalizeMeegleClassification } from "@/lib/server/meegle-filtering";

const groups = [
  { id: "chery-t1j-8255", name: "chery T1J_FL3-8255", model_to_files: { T1J_FL3: {} } },
  { id: "geely-d01-8155", name: "geely D01-8155", model_to_files: { D01: {} } },
];

assert.deepEqual(
  normalizeMeegleClassification({ carModel: "T1J-FL3", project: "奇瑞", platform: "8255" }),
  { carModel: "t1jfl3", project: "chery", platform: "8255" },
);
assert.equal(
  decideMeegleAssignment({ carModel: "T1J-FL3", project: "奇瑞", platform: "8255" }, groups).ruleGroupId,
  "chery-t1j-8255",
);
assert.equal(
  decideMeegleAssignment({ carModel: "", project: "chery", platform: "" }, groups).decision,
  "unassigned",
);
assert.equal(
  decideMeegleAssignment({ carModel: "", project: "geely", platform: "8155" }, groups).ruleGroupId,
  "geely-d01-8155",
);
```

- [ ] **步骤 2：运行测试并确认其因模块不存在而失败**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-filter-assignment.ts`

预期：失败，包含 `Cannot find module` 或 `meegle-filtering` 未导出。

- [ ] **步骤 3：实现最小的确定性匹配模块**

```ts
export type MeegleClassification = { carModel: string; project: string; platform: string };
export type MeegleAssignmentDecision = {
  decision: "assigned" | "unassigned";
  ruleGroupId?: string;
  ruleGroupName?: string;
  score: number;
  reason: string;
};

const normalizeToken = (value: string) => value.trim().toLowerCase().replace(/[-_\s]/g, "");
const projectAliases: Record<string, string> = { "奇瑞": "chery", chery: "chery", "吉利": "geely", geely: "geely", "捷途": "jitu", jitu: "jitu" };

export function normalizeMeegleClassification(value: MeegleClassification) {
  return {
    carModel: normalizeToken(value.carModel),
    project: projectAliases[value.project.trim().toLowerCase()] ?? normalizeToken(value.project),
    platform: normalizeToken(value.platform),
  };
}
```

实现 `decideMeegleAssignment()`：车型 `model_to_files` 归一化精确命中计 100 分，规则组名车型命中计 80 分，项目与平台同时命中计 40 分；仅项目、仅平台或分数小于 40 均返回 `unassigned` 和明确 `reason`。平分时返回未分配以避免不确定分配。

- [ ] **步骤 4：运行测试并确认通过**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-filter-assignment.ts`

预期：退出码 0，输出 `Meegle filter assignment tests passed.`。

- [ ] **步骤 5：提交纯匹配契约**

```bash
git add lib/server/meegle-filtering.ts scripts/test-meegle-filter-assignment.ts
git commit -m "feat: 增加飞书筛票规则组匹配"
```

### 任务 2：为分配来源和审计记录建立 IndexedDB 边界

**文件：**
- 修改：`lib/db/schema.ts`
- 修改：`stores/meegleAssignmentStore.ts`
- 修改：`scripts/test-meegle-filter-assignment.ts`

- [ ] **步骤 1：扩展失败测试，描述人工保护和审计写入**

```ts
assert.equal(manualAssignment.assignmentSource, "manual");
assert.equal(
  shouldApplyAutoAssignment({ assignmentSource: "manual", ruleGroupId: "manual-group" }, "auto-group"),
  false,
);
assert.equal(
  shouldApplyAutoAssignment({ assignmentSource: "auto", ruleGroupId: "old-group" }, "new-group"),
  true,
);
assert.equal(audit.decision, "skipped_manual_assignment");
assert.equal(audit.reason, "保留人工分配");
```

- [ ] **步骤 2：运行测试并确认缺少来源/审计 API**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-filter-assignment.ts`

预期：失败，指出 `shouldApplyAutoAssignment` 或审计类型未定义。

- [ ] **步骤 3：实现 Dexie v8 迁移及 store 操作**

在 `MeegleAssignment` 添加 `assignmentSource: "manual" | "auto"` 与可选 `lastFilterRunId`。新增：

```ts
export interface MeegleFilterAudit {
  id: string;
  runId: string;
  trigger: "all" | "rule_group";
  targetRuleGroupId?: string;
  projectKey: string;
  workItemTypeKey: string;
  workItemId: number;
  workItemName: string;
  model: string;
  carModel: string;
  project: string;
  platform: string;
  decision: "assigned" | "unassigned" | "skipped_manual_assignment" | "failed";
  matchedRuleGroupId?: string;
  matchedRuleGroupName?: string;
  score?: number;
  reason: string;
  createdAt: Date;
}
```

为 `AnalyzerDB` 声明 `meegleFilterAudits`，新增 `version(8).stores({ meegleAssignments: "id, workItemId, workItemTypeKey, ruleGroupId, assignmentSource, lastFilterRunId, status, assignedAt", meegleFilterAudits: "id, runId, trigger, targetRuleGroupId, workItemId, matchedRuleGroupId, decision, createdAt" })`，并在 `upgrade` 中把既有 assignment 迁移为 `assignmentSource: "manual"`，保证旧用户选择不会被覆盖。

将 store 拆成 `assignManually(...)`、`unassign(...)` 和 `applyAutoFilterResult(result)`：前两者写 `manual` 审计事件；最后一个方法在单个 Dexie transaction 中跳过 `assignmentSource === "manual"`，更新或创建 `auto` assignment，并批量写入接口返回的审计记录。导出纯函数 `shouldApplyAutoAssignment()` 供测试。

- [ ] **步骤 4：运行测试和类型检查**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-filter-assignment.ts && npx tsc --noEmit`

预期：行为测试通过；TypeScript 无错误。

- [ ] **步骤 5：提交持久化变更**

```bash
git add lib/db/schema.ts stores/meegleAssignmentStore.ts scripts/test-meegle-filter-assignment.ts
git commit -m "feat: 持久化飞书筛票审计日志"
```

### 任务 3：完成全量待办、描述和固定模型的服务端筛选编排

**文件：**
- 修改：`app/api/meegle/auto-assign/route.ts`
- 删除：`app/api/meegle/classify/route.ts`
- 修改：`scripts/test-meegle-filter-assignment.ts`

- [ ] **步骤 1：先写失败的接口契约检查**

在测试脚本加入文件内容断言：

```ts
const route = read("app/api/meegle/auto-assign/route.ts");
assert.match(route, /getMeegleWorkItem|workitem.*get/);
assert.match(route, /description/);
assert.match(route, /model:\s*"Qwen3-32B-FP16"/);
assert.match(route, /decideMeegleAssignment/);
assert.match(route, /skipped_manual_assignment/);
assert.equal(exists("app/api/meegle/classify/route.ts"), false);
```

- [ ] **步骤 2：运行测试并确认当前初版接口不满足契约**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-filter-assignment.ts`

预期：失败，指出当前接口没有描述补齐、没有固定模型参数、没有统一 matcher，且重复分类路由仍存在。

- [ ] **步骤 3：重写 `POST /api/meegle/auto-assign` 的编排边界**

保留请求字段 `ruleGroups` 和可选 `filterRuleGroupId`，增加必须由前端传入的 `manualAssignments` 三元身份列表。连续调用 `runMeegleJson(["mywork", "todo", "--action", "todo", "--page-num", String(pageNum)])`，直到空页或少于服务端返回的 `page_size`；不得保留固定 `MAX_PAGES` 静默截断。

对待办用现有 `getMeegleWorkItem(projectKey, String(workItemId))` 补齐 `description`（该 CLI helper 的默认工作项字段已包含描述）；单项读取失败时生成 `failed` 审计事件并继续。构造模型输入时显式包含：

```ts
`ID:${id} | 标题:${name} | 类型:${type} | 缺陷描述:${description.slice(0, 2000)}`
```

批次调用必须固定：

```ts
await chat(CLASSIFY_SYSTEM_PROMPT, userContent, {
  model: "Qwen3-32B-FP16",
  temperature: 0.1,
});
```

将解析成功的分类结果传给 `decideMeegleAssignment()`。人工分配项不调用模型，直接输出 `skipped_manual_assignment`；筛选范围为单规则组时，仅保留匹配该 `filterRuleGroupId` 的 `assigned` 事件，同时仍返回该规则组范围内的未匹配/失败日志。响应为 `{ runId, total, classified, assignments, audits }`，每个 `assignments` 条目必须带完整三元身份和 matcher 结果。

- [ ] **步骤 4：运行服务端契约测试和类型检查**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-filter-assignment.ts && npx tsc --noEmit`

预期：通过；无需实际调用 Meegle 或 Qwen。

- [ ] **步骤 5：提交服务端筛选编排**

```bash
git add app/api/meegle/auto-assign/route.ts app/api/meegle/classify/route.ts lib/server/meegle-filtering.ts scripts/test-meegle-filter-assignment.ts
git commit -m "feat: 全量筛选飞书待办并自动分组"
```

### 任务 4：实现 Jira 同构飞书首页与可追溯日志视图

**文件：**
- 修改：`app/meegle/page.tsx`
- 修改：`components/meegle/MeegleRuleGroupLane.tsx`
- 修改：`components/meegle/MeegleUnassignedPool.tsx`
- 创建：`components/meegle/MeegleFilterAuditLog.tsx`
- 修改：`scripts/test-meegle-filter-assignment.ts`

- [ ] **步骤 1：写失败的页面连接检查**

```ts
assert.match(read("app/meegle/page.tsx"), /applyAutoFilterResult/);
assert.match(read("app/meegle/page.tsx"), /manualAssignments/);
assert.match(read("components\/meegle\/MeegleRuleGroupLane.tsx"), /筛选票/);
assert.match(read("components\/meegle\/MeegleFilterAuditLog.tsx"), /skipped_manual_assignment/);
assert.match(read("components\/meegle\/MeegleUnassignedPool.tsx"), /未匹配原因/);
```

- [ ] **步骤 2：运行检查并确认目前泳道页未接入新的数据契约**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-filter-assignment.ts`

预期：失败，指出不存在 `MeegleFilterAuditLog` 且 page 没有调用新的 store API。

- [ ] **步骤 3：以 Jira 规则组行为视觉基线改造页面**

将 `MeegleRuleGroupLane` 的外层结构调整为与 `components/rule-group/RuleGroupRow.tsx` 相同的双行规则组展示：上行显示序号、名称、车型数、飞书已归属数；下行显示 `飞书待办` 来源、最近筛选状态/数量、`筛选票` 和 `一键处理`。保留当前规则组中的待处理工单列表及处理结果链接，不向 Jira `FilterTask` 或 `FilteredIssueSnapshot` 写入任何数据。

将页面顶栏的“一键筛选”调用新接口，传入全部 rule group 和 `assignmentSource === "manual"` 的完整身份；成功后一次调用 `applyAutoFilterResult()`，再刷新待办。当前规则组“筛选票”传 `filterRuleGroupId`，并只刷新该组的结果/日志。手动拖放调用 `assignManually()`，取消分配调用 `unassign()`，而不再调用旧 `assignToGroup()`。

`MeegleUnassignedPool` 使用所有没有 assignment 的当前待办，加上最新匹配失败 audit 的 `reason` 展示“未匹配原因”。`MeegleFilterAuditLog` 显示时间、工作项、识别出的车型/项目/平台、决策、目标规则组和理由；规则组行只传该组 `targetRuleGroupId` 或 `matchedRuleGroupId` 的记录。

- [ ] **步骤 4：运行页面契约检查、类型检查和 lint**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-filter-assignment.ts && npx tsc --noEmit && npm run lint`

预期：新检查和 TypeScript 通过；lint 不引入 error，既有 warning 单独记录。

- [ ] **步骤 5：提交前端同构与日志视图**

```bash
git add app/meegle/page.tsx components/meegle/MeegleRuleGroupLane.tsx components/meegle/MeegleUnassignedPool.tsx components/meegle/MeegleFilterAuditLog.tsx scripts/test-meegle-filter-assignment.ts
git commit -m "feat: 飞书首页对齐 Jira 并展示筛选日志"
```

### 任务 5：注册回归检查并同步项目文档

**文件：**
- 创建：`scripts/check-meegle-filter-assignment.mjs`
- 修改：`package.json`
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：编写失败的静态回归检查**

```js
const checks = [
  ["auto-assign paginates all todo items", route.includes("while") && !route.includes("MAX_PAGES")],
  ["classifier receives name type and description", ["标题:", "类型:", "缺陷描述:"].every((value) => route.includes(value))],
  ["classifier pins Qwen3-32B-FP16", route.includes('model: "Qwen3-32B-FP16"')],
  ["manual assignments are skipped", route.includes("skipped_manual_assignment") && store.includes("assignmentSource")],
  ["audit table is persisted", schema.includes("MeegleFilterAudit") && schema.includes("meegleFilterAudits")],
  ["Meegle filter test is registered", packageJson.scripts["test:meegle-filter-assignment"]],
];
```

- [ ] **步骤 2：运行检查并确认在注册前失败**

运行：`source ~/.bashrc && node scripts/check-meegle-filter-assignment.mjs`

预期：失败，指出 package script 或文档同步检查尚未完成。

- [ ] **步骤 3：注册检查并同步文档**

在 `package.json` 添加：

```json
"test:meegle-filter-assignment": "node --import tsx scripts/test-meegle-filter-assignment.ts && node scripts/check-meegle-filter-assignment.mjs"
```

在产品文档的飞书工作台场景中明确 Jira 同构展示、全量待办来源、字段抽取和未匹配留池；架构文档描述服务端编排、Dexie v8 的 assignment/audit 表及不写 Jira 表的边界；工作流和时序图描述全量/单组两条筛选路径、人工保护和审计事件；在 `session-handoff.md` 新增完成项、验证命令和后续关注项。

- [ ] **步骤 4：运行全部定向验证**

运行：`source ~/.bashrc && npm run test:meegle-filter-assignment && npm run test:meegle-results && npx tsc --noEmit && npm run lint`

预期：两个 Meegle 回归检查和 TypeScript 通过；lint 不新增 error。若必须运行浏览器验证，启动 `npm run dev` 后访问 `/meegle`，确认规则组行、全量筛选、单组筛选、未匹配列表和日志均可见。

- [ ] **步骤 5：提交验证和文档同步**

```bash
git add scripts/check-meegle-filter-assignment.mjs package.json docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md
git commit -m "docs: 同步飞书全量筛票流程"
```

## 最终验收

- [ ] 手工分配后重复执行一键筛选，规则组不变且日志显示 `skipped_manual_assignment`。
- [ ] 单规则组筛选只创建或更新该组的自动 assignment；其它规则组 assignment 不变化。
- [ ] 无车型且仅项目或仅平台的待办继续出现在待分配列表，并具有可读未匹配原因。
- [ ] 每次筛选运行可按规则组追溯工作项、模型抽取、规则组、分数和理由。
- [ ] `/meegle` 的规则组行视觉/操作层级与 Jira 首页一致，且不读写 Jira 筛票表。
