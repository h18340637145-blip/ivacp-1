# 飞书 MQL 唯一展示归属修复 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 成功 MQL 查询后，将所有不再命中的分配（包括已完成、已回填和历史人工分配）从规则组解除归属。

**架构：** 保持现有 `autoAssignmentIdsToUnassign()` 对账入口，成功 MQL 是唯一的规则组展示依据，不再按 `assignmentSource` 或任务完成状态豁免。Dexie 原子事务仍只更新过期 assignment 的 `ruleGroupId`；结果与历史保留。

**技术栈：** TypeScript、Dexie、Node `tsx` 回归脚本。

---

### 任务 1：锁定 MQL 未命中分配的回归

**文件：**
- 修改：`scripts/test-meegle-assignment-reconciliation.ts:40-58`

- [x] **步骤 1：编写失败的测试**

将 `completed` 和 `manual` 分配纳入 `staleIds` 的预期值，同时保留失败查询组不在预期中的断言。

- [x] **步骤 2：运行测试验证失败**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-filter-assignment`

预期：失败，差异显示 `manual` 未被清理。

### 任务 2：修复 MQL 唯一展示归属对账

**文件：**
- 修改：`lib/meegle/filter-assignment-reconciliation.ts:31-38`
- 修改：`docs/PRODUCT.md:170`
- 修改：`docs/ARCHITECTURE.md:28`
- 修改：`docs/WORKFLOW.md:15-17`
- 修改：`docs/SEQUENCE_DIAGRAMS.md:27-34`
- 修改：`session-handoff.md`

- [x] **步骤 1：实施最小代码修改**

删除按来源和完成状态排除分配的条件：

```ts
if (assignment.assignmentSource !== "auto") return false;
```

使所有成功查询范围内未命中的分配都继续进入规则组 ID 对账：

```ts
if (!successfulGroups.has(assignment.ruleGroupId)) return false;
```

- [x] **步骤 2：同步行为文档**

明确“成功查询会解除所有未再次命中的分配，但只解除规则组归属；结果与历史保留，失败查询组不清理”。

- [x] **步骤 3：运行针对性测试验证通过**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:meegle-filter-assignment`

预期：退出码为 0，输出包含 `Meegle assignment reconciliation tests passed.`。

### 任务 3：完成验证

**文件：**
- 验证：`lib/meegle/filter-assignment-reconciliation.ts`
- 验证：`scripts/test-meegle-assignment-reconciliation.ts`

- [x] **步骤 1：运行类型检查**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit`

预期：退出码为 0。

- [x] **步骤 2：检查变更范围**

运行：`git diff --check && git diff -- lib/meegle/filter-assignment-reconciliation.ts scripts/test-meegle-assignment-reconciliation.ts docs/PRODUCT.md docs/ARCHITECTURE.md docs/WORKFLOW.md docs/SEQUENCE_DIAGRAMS.md session-handoff.md`

预期：无空白错误；仅包含此修复及其文档。

### 任务 4：保留已命中的人工分配与失败比较边界

**文件：**
- 修改：`lib/meegle/filter-assignment-reconciliation.ts`
- 修改：`lib/server/meegle-mql-filtering.ts`
- 修改：`app/api/meegle/filter/route.ts`
- 修改：`scripts/test-meegle-assignment-reconciliation.ts`
- 修改：`scripts/test-meegle-mql-filtering.ts`

- [x] 将 `skipped_manual_assignment` 视为仍命中 MQL，避免对账误清理。
- [x] 当单规则组筛选所需的高优先级比较 MQL 失败时，禁止目标组进入过期分配清理范围。
- [x] 为两条边界补充回归，并通过类型检查与差异检查。
