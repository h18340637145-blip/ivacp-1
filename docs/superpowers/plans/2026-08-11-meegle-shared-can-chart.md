# 飞书项目共享 CAN 时序图实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复空白 CAN PNG，并让 Jira 与飞书详情完整复用同一套 Chart.js 交互时序图。

**架构：** 将 Jira 详情内的 CAN 图表逻辑抽到共享客户端组件，两类详情页只传递数据和回填路径。静态 Node 绘图与共享组件使用相同的离散刻度适用条件，避免无效 DBC choices 裁掉真实数据。

**技术栈：** Next.js、React、TypeScript、Chart.js、chartjs-plugin-zoom、Playwright、Node.js。

---

## 文件结构

- 创建 `components/analysis/CanSignalChart.tsx`：共享交互图、同步缩放、截图回填和静态图降级。
- 修改 `components/analysis/IssueDetail.tsx`：删除内嵌图表实现并调用共享组件。
- 修改 `components/meegle/MeegleResultDetail.tsx`：使用共享组件渲染持久化 `traceData`。
- 修改 `scripts/plot_can_signals.js`：仅在 choices 覆盖数据范围时锁定 Y 轴。
- 修改 `scripts/check-node-plotting.mjs`：验证错位 choices 不会生成空白图。
- 创建 `scripts/check-shared-can-chart.mjs`：守护 Jira/Meegle 的组件复用和功能配置。
- 修改 `package.json`：增加共享图表回归命令。
- 修改 `docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/SEQUENCE_DIAGRAMS.md`、`session-handoff.md`：同步实现和验证状态。

### 任务 1：建立失败的回归检查

- [x] **步骤 1：扩展静态绘图测试**

在测试 DBC 中为数值信号添加不覆盖真实数据的 choices，并断言输出图片包含信号颜色像素，而不只是检查文件非空。

- [x] **步骤 2：添加共享组件守护**

创建 `scripts/check-shared-can-chart.mjs`，断言 Jira 和 Meegle 均引用 `CanSignalChart`，且共享组件包含缩放、重置和截图保存逻辑。

- [x] **步骤 3：运行测试验证失败**

运行：`npm run test:node-plot` 与 `node scripts/check-shared-can-chart.mjs`

预期：旧静态图缺少数据颜色；共享组件文件或引用不存在。

### 任务 2：修复静态 PNG Y 轴范围

- [x] **步骤 1：添加范围判定**

在 `scripts/plot_can_signals.js` 中实现 `shouldUseDiscreteTickAxis(tickConfig, values)`；只有 ticks/labels 合法、至少两个有限刻度且 `dataMin >= tickMin && dataMax <= tickMax` 时应用 `min/max` 和枚举标签。

- [x] **步骤 2：运行静态绘图测试**

运行：`npm run test:node-plot`

预期：PASS，错位 choices 下仍能看到散点颜色。

### 任务 3：抽取并接入共享 Chart.js 组件

- [x] **步骤 1：创建共享组件**

把 Jira 的时间解析、离散刻度判断、多图同步、缩放/平移、重置、截图合成和静态降级移动到 `CanSignalChart.tsx`，公开 `traceData`、`ticks`、`chartImagePath`、`signalSummary`、`artifactKey` 属性。

- [x] **步骤 2：替换 Jira 内嵌实现**

`IssueDetail.tsx` 保留 `buildChartBackfillPath`，改为传入 Jira issue key、结果数据和图片路径。

- [x] **步骤 3：接入飞书详情**

`MeegleResultDetail.tsx` 传入 work item ID、持久化 `traceData/ticks`、`chartImage` 和信号摘要，完整开启共享交互与截图功能。

- [x] **步骤 4：运行共享组件检查和类型检查**

运行：`node scripts/check-shared-can-chart.mjs` 与 `npx tsc --noEmit`

预期：PASS。

### 任务 4：回归验证与文档同步

- [x] **步骤 1：运行相关回归**

运行：`npm run test:shared-axis-chart`、`npm run test:browser-chart-backfill`、`npm run test:meegle-results`。

预期：全部 PASS。

- [x] **步骤 2：运行 lint 和生产构建**

运行：`npm run lint -- components/analysis/CanSignalChart.tsx components/analysis/IssueDetail.tsx components/meegle/MeegleResultDetail.tsx`、`npm run build`。

预期：0 error，构建退出码 0。

- [x] **步骤 3：同步文档**

记录共享组件、静态刻度范围保护、Meegle 交互图链路、测试命令和本轮状态。
