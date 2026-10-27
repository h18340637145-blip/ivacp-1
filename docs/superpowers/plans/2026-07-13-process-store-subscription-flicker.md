# Process Store 订阅闪烁修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 收窄三个处理入口对 Zustand Process Store 的订阅，在不改变现有页面布局和处理行为的前提下消除批量任务引发的无关页面重渲染。

**架构：** 保留 `stores/processTaskStore.ts` 的状态结构和写入流程，仅在消费端使用单字段选择器订阅。新增静态回归脚本，阻止入口组件重新使用无选择器的 Store 订阅。

**技术栈：** Next.js 16、React 19、TypeScript、Zustand 5、Node.js 静态回归脚本

---

## 文件结构

- 创建：`scripts/check-process-store-subscriptions.mjs`，检查三个入口的订阅边界。
- 修改：`package.json`，注册 `test:process-store-subscriptions`。
- 修改：`components/KanbanBoard.tsx`，仅订阅两个处理操作。
- 修改：`components/analysis/AnalysisBoard.tsx`，分别订阅列表状态和操作。
- 修改：`components/analysis/IssueDetail.tsx`，分别订阅详情状态和操作。
- 修改：`session-handoff.md`，记录修复完成状态和验证证据。

### 任务 1：建立失败的订阅边界回归检查

**文件：**
- 创建：`scripts/check-process-store-subscriptions.mjs`
- 修改：`package.json`

- [ ] **步骤 1：创建能够识别无选择器订阅的检查脚本**

```javascript
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const targets = [
  "components/KanbanBoard.tsx",
  "components/analysis/AnalysisBoard.tsx",
  "components/analysis/IssueDetail.tsx",
];
const failures = [];

for (const file of targets) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/useProcessTaskStore\s*\(\s*\)/m.test(source)) {
    failures.push(`${file} 仍订阅整个 Process Store`);
  }
  if (!/useProcessTaskStore\s*\(\s*\(state\)\s*=>/m.test(source)) {
    failures.push(`${file} 缺少字段选择器订阅`);
  }
}

if (failures.length) {
  console.error("Process Store subscription checks failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Process Store subscription checks passed.");
```

- [ ] **步骤 2：在 `package.json` 注册命令**

```json
"test:process-store-subscriptions": "node scripts/check-process-store-subscriptions.mjs"
```

- [ ] **步骤 3：运行检查并确认旧实现失败**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:process-store-subscriptions
```

预期：FAIL，三个组件至少各报告一次“仍订阅整个 Process Store”。

- [ ] **步骤 4：提交失败回归检查**

```bash
git add package.json scripts/check-process-store-subscriptions.mjs
git commit -m "test: guard process store subscriptions"
```

### 任务 2：收窄三个入口的 Store 订阅

**文件：**
- 修改：`components/KanbanBoard.tsx:30-31`
- 修改：`components/analysis/AnalysisBoard.tsx:27-36`
- 修改：`components/analysis/IssueDetail.tsx:173-188`

- [ ] **步骤 1：修改 `KanbanBoard`，只订阅操作函数**

```typescript
const runAll = useProcessTaskStore((state) => state.runAll);
const runOne = useProcessTaskStore((state) => state.runOne);
```

- [ ] **步骤 2：修改 `AnalysisBoard`，逐字段订阅实际使用的数据**

```typescript
const tasksBySnapshot = useProcessTaskStore((state) => state.tasksBySnapshot);
const resultsBySnapshot = useProcessTaskStore((state) => state.resultsBySnapshot);
const processingIds = useProcessTaskStore((state) => state.runningIds);
const loadForFilterTask = useProcessTaskStore((state) => state.loadForFilterTask);
const runAll = useProcessTaskStore((state) => state.runAll);
const approveResult = useProcessTaskStore((state) => state.approveResult);
const rejectResult = useProcessTaskStore((state) => state.rejectResult);
```

- [ ] **步骤 3：修改 `IssueDetail`，逐字段订阅详情所需状态与操作**

```typescript
const runningIds = useProcessTaskStore((state) => state.runningIds);
const commentingIds = useProcessTaskStore((state) => state.commentingIds);
const reviewingIds = useProcessTaskStore((state) => state.reviewingIds);
const tasksBySnapshot = useProcessTaskStore((state) => state.tasksBySnapshot);
const resultsBySnapshot = useProcessTaskStore((state) => state.resultsBySnapshot);
const transitioningIds = useProcessTaskStore((state) => state.transitioningIds);
const transitionOptionsByIssue = useProcessTaskStore((state) => state.transitionOptionsByIssue);
const assigneeCandidatesByIssue = useProcessTaskStore((state) => state.assigneeCandidatesByIssue);
const runOne = useProcessTaskStore((state) => state.runOne);
const approveResult = useProcessTaskStore((state) => state.approveResult);
const rejectResult = useProcessTaskStore((state) => state.rejectResult);
const aiReview = useProcessTaskStore((state) => state.aiReview);
const commentToJira = useProcessTaskStore((state) => state.commentToJira);
const loadJiraTransitions = useProcessTaskStore((state) => state.loadJiraTransitions);
const transitionJiraIssue = useProcessTaskStore((state) => state.transitionJiraIssue);
```

- [ ] **步骤 4：运行订阅检查并确认通过**

运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:process-store-subscriptions
```

预期：PASS，输出 `Process Store subscription checks passed.`。

- [ ] **步骤 5：提交最小实现**

```bash
git add components/KanbanBoard.tsx components/analysis/AnalysisBoard.tsx components/analysis/IssueDetail.tsx
git commit -m "fix: narrow process store subscriptions"
```

### 任务 3：验证页面行为并同步交接记录

**文件：**
- 修改：`session-handoff.md`

- [ ] **步骤 1：运行相关静态回归**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:process-store-subscriptions
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:frontend
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:accuracy-phase1
```

预期：三个命令均 PASS。

- [ ] **步骤 2：运行生产构建**

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run build
```

预期：Next.js build 成功，无 TypeScript 编译错误。

- [ ] **步骤 3：在 `session-handoff.md` 将页面闪烁待办标记完成**

记录修改文件、订阅边界和上述验证命令结果；证据判定校准待办保持未完成。

- [ ] **步骤 4：提交验证记录**

```bash
git add session-handoff.md
git commit -m "docs: record process flicker fix"
```

