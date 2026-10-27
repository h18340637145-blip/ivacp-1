# 看板与结果详情可读性优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 提升首页统一规则组看板、Jira 结果详情和 Meegle 结果详情的文字大小、颜色对比与操作层级，同时完全保持既有业务行为。

**架构：** 先在全局 CSS 定义可复用的暗色主题阅读令牌和可访问的交互基线，再分别将首页行式看板、Jira 内联样式详情和 Meegle CSS Module 接入该层级。使用一个静态样式契约脚本防止关键文字尺寸、焦点样式和响应式规则回退；既有 Store、路由和 API 调用不变。

**技术栈：** Next.js App Router、React、TypeScript、CSS Modules、Tailwind 全局导入、Lucide、Node.js 静态回归脚本。

---

## 文件结构

- 修改：`app/globals.css` — 提升全局暗色主题文本/边框令牌，添加共享的焦点、移动端和减少动画规则。
- 修改：`components/rule-group/RuleGroupList.tsx` — 提高表头可读性并使列头在窄屏正确收缩。
- 修改：`components/rule-group/RuleGroupRow.tsx` — 提高规则组名称、标签、来源状态和按钮的文字与点击面积，不改动事件处理。
- 修改：`components/analysis/IssueDetail.tsx` — 将 Jira 详情的页面标题、元信息、正文、输入与操作尺寸接入统一尺度。
- 修改：`components/meegle/MeegleResultDetail.module.css` — 将 Meegle 详情的标题、状态、正文、标签、控件和小屏布局接入统一尺度。
- 创建：`scripts/check-readability-ui.mjs` — 静态断言目标页面继续使用语义令牌、可见焦点和移动端布局规则。
- 修改：`package.json` — 暴露 `test:readability-ui`。
- 修改：`session-handoff.md` — 记录已完成的可读性优化、影响范围与验证命令。

### 任务 1：建立可读性回归契约

**文件：**
- 创建：`scripts/check-readability-ui.mjs`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的静态回归测试**

创建如下脚本，先检查尚不存在的共享阅读令牌与目标组件约束：

```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const globals = read("app/globals.css");
const list = read("components/rule-group/RuleGroupList.tsx");
const row = read("components/rule-group/RuleGroupRow.tsx");
const jira = read("components/analysis/IssueDetail.tsx");
const meegle = read("components/meegle/MeegleResultDetail.module.css");

const checks = [
  ["global readability tokens", globals.includes("--font-size-body") && globals.includes("--font-size-meta")],
  ["visible keyboard focus", globals.includes(":focus-visible")],
  ["reduced motion support", globals.includes("prefers-reduced-motion")],
  ["rule group header is at least 12px", list.includes('fontSize: "12px"')],
  ["rule group title is at least 15px", row.includes('fontSize: "15px"')],
  ["rule group actions have 44px targets", row.includes('minWidth: "44px"') && row.includes('minHeight: "44px"')],
  ["Jira detail uses readable body scale", jira.includes('fontSize: "var(--font-size-body)"')],
  ["Meegle detail uses shared readable scale", meegle.includes("var(--font-size-body)")],
  ["Meegle detail preserves narrow-screen layout", meegle.includes("@media (max-width: 640px)")],
];

const failed = checks.filter(([, pass]) => !pass);
if (failed.length) {
  failed.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}
console.log(`Readability UI checks passed (${checks.length}).`);
```

- [ ] **步骤 2：运行测试验证失败**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH node scripts/check-readability-ui.mjs`

预期：退出码 `1`，并报告缺少 `--font-size-body`、`--font-size-meta` 与规则组 `44px` 点击面积等契约。

- [ ] **步骤 3：注册测试命令**

在 `package.json` 的 `scripts` 对象增加：

```json
"test:readability-ui": "node scripts/check-readability-ui.mjs"
```

- [ ] **步骤 4：暂不让测试通过**

保持本任务的测试为红灯；在任务 2–5 完成实现后统一执行 `npm run test:readability-ui`。不要为通过静态断言而引入无调用的死样式。

- [ ] **步骤 5：提交测试骨架**

```bash
git add scripts/check-readability-ui.mjs package.json
git commit -m "test(界面): 添加可读性样式回归契约"
```

### 任务 2：定义共享文字与交互令牌

**文件：**
- 修改：`app/globals.css:5-34`

- [ ] **步骤 1：补充会失败的令牌断言**

确认任务 1 的 `global readability tokens`、`visible keyboard focus` 和 `reduced motion support` 三项仍为失败状态；这证明接下来的 CSS 不是测试已有行为。

- [ ] **步骤 2：添加最小全局实现**

在 `:root` 的颜色令牌之后增加：

```css
  --font-size-title: clamp(1.375rem, 2vw, 1.625rem);
  --font-size-section: 1.125rem;
  --font-size-body: 1rem;
  --font-size-meta: 0.875rem;
  --font-size-label: 0.75rem;
  --line-height-body: 1.65;
```

将 `--c-text-2`、`--c-text-3` 和 `--c-border-focus` 调整至能在 `--c-bg` / `--c-surface` 上清晰区分的色阶；保留 `--c-amber`、`--c-green`、`--c-red`、`--c-blue` 与 `--c-purple` 的业务语义。

在全局交互规则中增加：

```css
:where(a, button, input, select, textarea):focus-visible {
  outline: 2px solid var(--c-amber);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **步骤 3：运行全局契约测试**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:readability-ui`

预期：仍失败，但不再出现全局令牌、键盘焦点或减少动画三项。

- [ ] **步骤 4：提交全局令牌**

```bash
git add app/globals.css
git commit -m "style(主题): 提升暗色界面文字与焦点对比"
```

### 任务 3：优化首页统一规则组看板

**文件：**
- 修改：`components/rule-group/RuleGroupList.tsx:68-93`
- 修改：`components/rule-group/RuleGroupRow.tsx:42-70,124-191,258-386`

- [ ] **步骤 1：确认首页契约保持红灯**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:readability-ui`

预期：报告 `rule group header is at least 12px`、`rule group title is at least 15px` 与 `rule group actions have 44px targets`。

- [ ] **步骤 2：调整表头、行标题和元信息**

在 `RuleGroupList` 中将列头 `fontSize` 从 `10px` 提升为 `12px`。在 `RuleGroupRow` 中将名称设为 `15px`，将标签、JQL/MQL 摘要、自动周期元信息调整到 `var(--font-size-label)` 或 `var(--font-size-meta)`；保持现有来源文字（Jira、飞书项目、票数/状态）不变。

将现有 `Tag` 字体替换为：

```tsx
fontSize: "var(--font-size-label)",
lineHeight: 1.35,
```

保留 `getNameAccent`、`getDimColor`、来源颜色和所有 `onClick` 回调，不修改 `sourceSummary` 与处理资格判断。

- [ ] **步骤 3：扩大图标操作的有效点击区**

将 `ActionBtn` 的固定尺寸改为以下形式，使视觉图标仍保持紧凑但可点击区域符合标准：

```tsx
minWidth: "44px",
minHeight: "44px",
width: "44px",
height: "44px",
```

为 `SmallBtn`、`FilterButton` 与筛票结果链接增加 `minHeight: "36px"`，不改变标签文字、禁用条件或导航链接。

- [ ] **步骤 4：运行首页契约测试验证通过**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:readability-ui`

预期：首页三项通过；Jira 与 Meegle 条目仍失败。

- [ ] **步骤 5：提交首页优化**

```bash
git add components/rule-group/RuleGroupList.tsx components/rule-group/RuleGroupRow.tsx
git commit -m "style(看板): 提升规则组信息层级与操作可达性"
```

### 任务 4：优化 Jira 结果详情

**文件：**
- 修改：`components/analysis/IssueDetail.tsx:278-390,413-971`

- [ ] **步骤 1：确认 Jira 契约为红灯**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:readability-ui`

预期：只保留 `Jira detail uses readable body scale` 与 Meegle 详情相关失败项。

- [ ] **步骤 2：将高频文字替换为共享尺度**

按以下映射修改现有内联样式，不改变 JSX 结构、条件渲染或处理函数：

```tsx
// 页面标题
fontSize: "var(--font-size-title)",

// 票据元信息、字段标签、状态说明
fontSize: "var(--font-size-meta)",

// 结论、人工正确结论、评论预览和正文卡片
fontSize: "var(--font-size-body)",
lineHeight: "var(--line-height-body)",

// JQL、路径、时间戳等等宽技术文本
fontSize: "var(--font-size-meta)",
fontFamily: "var(--f-mono)",
```

对「AI 分析」「指派经办人」「通过」「驳回」「确认回填」等按钮使用 `minHeight: "44px"`，并保留已有 disabled、opacity、颜色和回调条件。将移动端内容容器从固定 `padding: "24px"` 改为 `padding: "clamp(16px, 3vw, 24px)"`，字段网格在窄屏增加 `minmax(0, 1fr)` 的单列降级规则（通过现有可用的 class 或局部 `style` 实现）。

- [ ] **步骤 3：运行 Jira 契约测试验证通过**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:readability-ui`

预期：Jira 条目通过，只保留 Meegle 详情条目。

- [ ] **步骤 4：提交 Jira 详情优化**

```bash
git add components/analysis/IssueDetail.tsx
git commit -m "style(Jira详情): 提升结果阅读与操作层级"
```

### 任务 5：优化 Meegle 结果详情

**文件：**
- 修改：`components/meegle/MeegleResultDetail.module.css:1-109`

- [ ] **步骤 1：确认 Meegle 契约为红灯**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:readability-ui`

预期：仅 `Meegle detail uses shared readable scale` 失败。

- [ ] **步骤 2：接入共享尺度并改善状态层级**

按下列最小 CSS 替换现有过小字号：

```css
.title { font-size: var(--font-size-title); line-height: 1.3; }
.subtitle, .statusLine { color: var(--c-text-2); font-size: var(--font-size-meta); }
.sectionTitle { color: var(--c-text-2); font-size: var(--font-size-label); }
.description, .resultText { color: var(--c-text); font-size: var(--font-size-body); line-height: var(--line-height-body); }
.label, .hint, .error { font-size: var(--font-size-meta); }
.pill, .stageName, .stageValue, .fileButton { font-size: var(--font-size-label); }
.button, .backLink, .tab, .select { min-height: 44px; font-size: var(--font-size-meta); }
.textarea { font-size: var(--font-size-body); line-height: var(--line-height-body); }
```

将 `.pill`、`.hint`、`.statusLine` 的颜色从 `--c-text-3` 提升为 `--c-text-2`；保留 `.success`、`.danger`、`.primary` 的状态文字与颜色。将 `@media (max-width: 640px)` 中按钮组改为 `width: 100%` 且允许换行，确保主操作不会被横向挤压。

- [ ] **步骤 3：运行完整静态契约**

运行：`PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:readability-ui`

预期：`Readability UI checks passed (9).`

- [ ] **步骤 4：提交 Meegle 详情优化**

```bash
git add components/meegle/MeegleResultDetail.module.css
git commit -m "style(飞书详情): 提升结果状态与正文可读性"
```

### 任务 6：文档、全量验证与交接

**文件：**
- 修改：`session-handoff.md`
- 修改：`docs/PRODUCT.md`（仅当实现时产品设计原则发生实质变化）
- 修改：`docs/ARCHITECTURE.md`（仅当实现时架构边界发生实质变化）
- 修改：`docs/WORKFLOW.md`（仅当实现时用户流程发生实质变化）
- 修改：`docs/SEQUENCE_DIAGRAMS.md`（仅当实现时交互时序发生实质变化）

- [ ] **步骤 1：更新交接记录**

在 `session-handoff.md` 的最新记录中添加一条已完成项，明确：

```markdown
- [x] 首页规则组、Jira 详情与 Meegle 结果详情统一采用可读性字号和语义颜色；未修改筛票、处理、复核、回填、IndexedDB 或 API 行为。验证：`npm run test:readability-ui`、`npm run lint`、`npx tsc --noEmit`。
```

若实现未改变产品能力、架构和时序，只更新 `session-handoff.md`，不要为了样式改动虚增其余产品文档的版本记录。

- [ ] **步骤 2：运行验证**

依次运行：

```bash
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run test:readability-ui
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npm run lint
PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH npx tsc --noEmit
git diff --check
```

预期：样式契约通过；Lint 与 TypeScript 不新增错误；`git diff --check` 无空白错误。若 Qwen 等未涉及文件导致已有失败，记录确切文件和错误，不把它归因于本次界面改动。

- [ ] **步骤 3：执行浏览器回归**

使用 `next dev --webpack` 启动本地服务，并在 375 px、768 px、1024 px、1440 px 验证 `/`、一条 Jira 结果详情和一条 Meegle 结果详情：

```text
首页：规则名称、来源状态、主操作可见，无横向滚动。
详情：标题、结论、技术文本和复核/回填按钮可读，Tab 可键盘切换。
行为：筛票、分析、复核、回填的已有按钮条件与调用不变；刷新后继续通过 IndexedDB 读取数据。
```

- [ ] **步骤 4：提交交接记录**

```bash
git add session-handoff.md
git commit -m "docs(交接): 记录界面可读性优化完成"
```

## 计划自检

- 规格覆盖度：任务 2 覆盖共享颜色、字号、焦点和减少动画；任务 3 覆盖首页；任务 4 和 5 覆盖 Jira/Meegle 详情；任务 6 覆盖移动端、行为不变和交接。
- 占位符扫描：计划不包含未决实现；每个实现步骤给出目标路径、精确命令或代码片段。
- 类型一致性：所有变更仅使用既有 CSS 变量、React 内联样式和 CSS Module 类；不引入新运行时类型、Store 或 API。
