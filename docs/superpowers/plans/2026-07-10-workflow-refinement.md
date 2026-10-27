# Jira 解票工作流细化 — 在线多轮自愈与回滚保护实现计划

**目标**：在 Step 5 结论产出后，通过多轮迭代批判-修正与接地率（EGR）回滚机制，减少未接地结论，提升缺陷分析准确率。

**技术栈**：Next.js API Route、TypeScript、Qwen API。

---

## 修改文件

- `app/api/issues/process/route.ts`：实现 `runEvidenceSelfCritique` 的多轮循环自愈与回滚保护。
- `docs/PRODUCT.md`：记录工作流细化的产品能力。
- `docs/ARCHITECTURE.md`：记录多轮迭代与回滚机制的位置。
- `docs/WORKFLOW.md`：更新 Step 5 证据自批判的流程说明。
- `docs/SEQUENCE_DIAGRAMS.md`：记录多轮迭代自愈时序。
- `session-handoff.md`：记录此轮细化的完成状态。

---

## 任务列表

### 任务 1：重构 `runEvidenceSelfCritique` 逻辑
**文件**：`app/api/issues/process/route.ts`

- [ ] **步骤 1**：在 `runEvidenceSelfCritique` 中，将单次 API 调用改为最多 3 轮的 `while` 循环。
- [ ] **步骤 2**：每轮循环中，保存当前的 `reply`、接地率 `ratio` 和未接地断言。
- [ ] **步骤 3**：循环结束后，遍历历史记录，找出 `ratio` 最高的索引 `bestIndex`，如果最高接地率相同，则优先选择最早的轮次以避免过度修改。
- [ ] **步骤 4**：将详细的历史轨迹保存进 `evidence-grounding.json`，并回滚到最佳版本的结论。

### 任务 2：本地运行回归与准确率评测
- [ ] **步骤 1**：运行现有回归检查确保代码静态正确：
  ```bash
  npm run test:accuracy-phase3
  ```
- [ ] **步骤 2**：运行离线准确率评测：
  ```bash
  npm run eval:accuracy
  ```
  校验生成的 `docs/golden-baseline/eval-report.md`，确认接地率（EGR）没有发生退化。

### 任务 3：更新同步文档
- [ ] **步骤 1**：更新 `docs/PRODUCT.md`，说明在线多轮自修复机制。
- [ ] **步骤 2**：更新 `docs/ARCHITECTURE.md`，记录多轮循环和回滚防线的设计。
- [ ] **步骤 3**：更新 `docs/WORKFLOW.md`，在一致性分析/自批判章节描述迭代校验与回滚过滤。
- [ ] **步骤 4**：更新 `docs/SEQUENCE_DIAGRAMS.md` 中的自批判时序。
- [ ] **步骤 5**：更新 `session-handoff.md`，将本轮修改作为 v3.47 版本完成项记录。
