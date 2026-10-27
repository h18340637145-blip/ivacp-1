# 飞书项目 MQL 规则组筛选实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 用每个规则组配置的飞书 MQL 查询替换 `/meegle` 的待办全量 AI 分流，并以 `sortOrder` 实现工作项唯一归属。

**架构：** `RuleGroup` 增加独立 `meegleMql` 字段。新的服务端筛选器按稳定优先级逐组调用 `meegle workitem query`，规范化命中工作项，在服务端裁决重复命中并输出既有 assignment/audit 协议。页面改接新端点，仍由 Dexie 的 `MeegleAssignmentStore` 保存分配和审计；Jira JQL 筛选路径不变。

**技术栈：** Next.js App Router、TypeScript、Dexie、Zustand、Meegle CLI、Node 静态回归脚本。

---

## 文件结构

- 修改：`lib/db/schema.ts` — 向 `RuleGroup` 加入可选的 `meegleMql` 配置。
- 修改：`components/rule-group/RuleGroupDialog.tsx` — 管理员编辑规则组时输入并保存飞书 MQL。
- 创建：`lib/server/meegle-mql-filtering.ts` — MQL 查询结果规范化、排序、唯一归属和审计生成的纯函数。
- 创建：`app/api/meegle/filter/route.ts` — 调用 Meegle CLI MQL 查询的只读 API。
- 修改：`app/meegle/page.tsx` — 一键筛选和行内筛选改调用 `/api/meegle/filter`。
- 修改：`scripts/check-meegle-filter-assignment.mjs` — 更新既有静态检查，不再要求待办翻页和 Qwen 分类。
- 创建：`scripts/test-meegle-mql-filtering.ts` — 运行纯函数的优先级、手工保护、错误隔离回归测试。
- 修改：`package.json` — 注册 `test:meegle-mql-filtering`。
- 修改：`docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md` — 描述 MQL 主筛选、优先级裁决和时序。
- 修改：`session-handoff.md` — 记录交付内容、验证结果与明确的非目标。

### 任务 1：定义飞书 MQL 配置与失败测试

**文件：**
- 修改：`lib/db/schema.ts:19-34`
- 修改：`components/rule-group/RuleGroupDialog.tsx:24-45, 130-155, 380-435`
- 测试：`scripts/check-meegle-filter-assignment.mjs`

- [x] **步骤 1：扩展静态测试，断言 `RuleGroup` 和编辑表单拥有独立的 `meegleMql` 字段**

```js
expect(schema.includes("meegleMql?: string;")).toBe(true);
expect(dialog.includes('label="飞书 MQL"')).toBe(true);
expect(dialog.includes("meegleMql: form.meegleMql.trim() || undefined")).toBe(true);
```

- [x] **步骤 2：运行静态测试，确认它因字段尚不存在而失败**

运行：`source ~/.bashrc && node scripts/check-meegle-filter-assignment.mjs`

预期：FAIL，输出缺少 `meegleMql` schema/form assertion。

- [x] **步骤 3：给 `RuleGroup` 和表单状态增加可选 `meegleMql`，并添加中文多行输入控件**

```ts
export interface RuleGroup {
  // existing fields
  meegleMql?: string;
}

type RuleGroupForm = {
  // existing fields
  meegleMql: string;
};
```

表单保存时仅将非空字符串写入 `meegleMql`；编辑旧规则组时用空字符串回填，不改变其 JQL。

- [x] **步骤 4：重跑静态测试验证通过**

运行：`source ~/.bashrc && node scripts/check-meegle-filter-assignment.mjs`

预期：PASS，MQL 配置与 Jira JQL 独立存在。

### 任务 2：实现 MQL 查询结果归一化与唯一归属纯函数

**文件：**
- 创建：`lib/server/meegle-mql-filtering.ts`
- 创建：`scripts/test-meegle-mql-filtering.ts`

- [x] **步骤 1：为稳定优先级、人工保护、跨组冲突和单组失败编写失败测试**

```ts
assert.deepEqual(
  resolveMqlAssignments(groups, hitsByGroup, manualKeys).assignments.map((item) => item.ruleGroupId),
  ["high-priority"],
);
assert.equal(result.audits.find((item) => item.workItemId === 8)?.decision, "skipped_manual_assignment");
assert.match(result.audits.find((item) => item.ruleGroupId === "failed-group")?.reason ?? "", /MQL 查询失败/);
```

- [x] **步骤 2：运行测试，确认缺少模块或导出而失败**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-mql-filtering.ts`

预期：FAIL，报错无法解析 `@/lib/server/meegle-mql-filtering` 或 `resolveMqlAssignments` 未导出。

- [x] **步骤 3：实现最小的纯函数 API**

```ts
export function resolveMqlAssignments(input: {
  groups: MqlRuleGroup[];
  queryResults: MqlQueryResult[];
  manualAssignmentKeys: Set<string>;
  runId: string;
  createdAt: string;
}): MqlFilterResolution {
  // groups.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  // first non-manual identity wins; later matches yield conflict audit
}
```

每个查询失败以该规则组的一条 `failed` audit 表达；查询成功的重复命中以 `unassigned` audit 和“优先级冲突”原因表达。函数不调用网络，也不读写 Dexie。

- [x] **步骤 4：重跑纯函数测试验证通过**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-mql-filtering.ts`

预期：PASS，覆盖四种裁决行为。

### 任务 3：建立只读 MQL 筛选 API 并完成红绿测试

**文件：**
- 创建：`app/api/meegle/filter/route.ts`
- 修改：`lib/server/meegle-mql-filtering.ts`
- 修改：`scripts/check-meegle-filter-assignment.mjs`

- [x] **步骤 1：扩展静态测试，要求存在 MQL 路由、`workitem query` 调用和 MQL 规则组过滤**

```js
const mqlRoute = read("app/api/meegle/filter/route.ts");
assert(mqlRoute.includes('"workitem", "query"'), "MQL route invokes workitem query");
assert(mqlRoute.includes("group.meegleMql?.trim()"), "only configured groups are queried");
assert(mqlRoute.includes("resolveMqlAssignments"), "route delegates conflict resolution");
```

- [x] **步骤 2：运行静态测试，确认新路由缺失而失败**

运行：`source ~/.bashrc && node scripts/check-meegle-filter-assignment.mjs`

预期：FAIL，报错无法读取 `app/api/meegle/filter/route.ts`。

- [x] **步骤 3：实现 API 的请求验证、顺序查询和响应协议**

```ts
const results = await Promise.all(groups.map(async (group) => {
  try {
    return { group, data: await runMeegleJson(["workitem", "query", "--project-key", projectKey, "--mql", group.meegleMql!]) };
  } catch (error) {
    return { group, error: error instanceof Error ? error.message : "unknown" };
  }
}));
```

请求体包含 `projectKey`、`ruleGroups`、可选 `filterRuleGroupId` 和 `manualAssignments`。API 只接受带 `meegleMql` 的目标规则组，并将 Meegle 响应规范化后交给 `resolveMqlAssignments`。响应保持 `{ runId, assignments, audits }`，并额外返回 `queriedGroups` 与 `total`。

- [x] **步骤 4：重跑静态测试验证通过**

运行：`source ~/.bashrc && node scripts/check-meegle-filter-assignment.mjs`

预期：PASS，确认没有把 MQL 筛选退回到 `mywork todo` 或 Qwen 分类。

### 任务 4：将飞书看板接入 MQL API

**文件：**
- 修改：`app/meegle/page.tsx:90-190, 325-350`
- 修改：`components/meegle/MeegleRuleGroupLane.tsx:90-110`
- 测试：`scripts/check-meegle-filter-assignment.mjs`

- [x] **步骤 1：添加失败断言，要求页面调用 `/api/meegle/filter`，并提示未配置 MQL 的规则组**

```js
assert(page.includes('fetch("/api/meegle/filter"'), "Meegle page uses MQL filter route");
assert(lane.includes("未配置飞书 MQL"), "rule group lane explains unavailable filter");
```

- [x] **步骤 2：运行静态测试，确认旧页面仍调用 `/api/meegle/auto-assign` 而失败**

运行：`source ~/.bashrc && node scripts/check-meegle-filter-assignment.mjs`

预期：FAIL，输出未使用新 MQL 路由。

- [x] **步骤 3：替换页面筛选请求与禁用态**

```ts
const response = await fetch("/api/meegle/filter", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ projectKey, ruleGroups, filterRuleGroupId, manualAssignments }),
});
```

一键筛选使用所有配置了 `meegleMql` 的规则组；行内筛选只发送当前组。没有 `meegleMql` 的行禁用“筛选”并显示中文原因。继续调用 `applyAutoFilterResult`，确保人工分配保护和 Dexie 生命周期不变。

- [x] **步骤 4：重跑静态测试验证通过**

运行：`source ~/.bashrc && node scripts/check-meegle-filter-assignment.mjs`

预期：PASS，页面和行内动作均使用 MQL API。

### 任务 5：同步产品文档和完整验证

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [x] **步骤 1：更新文档，明确 MQL 主筛选、规则组优先级、人工覆盖和 Jira 隔离**

```md
飞书项目筛票按规则组配置的 `meegleMql` 调用 MQL 查询；同一工作项命中多个规则组时，按 `sortOrder` 最小的规则组唯一归属。`assignmentSource=manual` 不受自动筛选覆盖。Jira 的 `jql` 仅服务 Jira 筛票。
```

- [x] **步骤 2：运行 MQL 专项及既有飞书筛选测试**

运行：`source ~/.bashrc && npx tsx scripts/test-meegle-mql-filtering.ts && node scripts/check-meegle-filter-assignment.mjs && npm run test:meegle-results`

预期：全部 PASS。

- [x] **步骤 3：运行类型检查和 lint**

运行：`source ~/.bashrc && npx tsc --noEmit && npm run lint`

预期：exit code 0；仅允许仓库既有 lint warning，不新增 error。

- [x] **步骤 4：检查最终差异并更新会话交接**

运行：`git diff --check && git diff -- docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md`

预期：无空白错误；文档和交接准确记录 MQL 筛选已经替换旧 AI 主分流。
