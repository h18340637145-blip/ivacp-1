# 飞书项目处理结果生命周期实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 Meegle 建立独立、可持久化、可刷新恢复的处理结果详情链路，并支持日志、复核、校验、评论图片回填和状态流转。

**架构：** 浏览器使用 Meegle 专用 Dexie 表与 Zustand store 管理 snapshot/task/result/history/validation；服务端 Meegle adapter 继续复用 `/api/issues/process` 计算能力，但通过 context、artifact、comment 和 workflow API 隔离外部系统差异。Jira 表、store 与详情页行为保持不变，共享学习样本是唯一跨源持久化资产。

**技术栈：** Next.js App Router、React 19、TypeScript、Zustand、Dexie、Meegle CLI、Chart.js、Node 回归脚本。

---

## 文件职责

- `lib/db/schema.ts`：新增 Meegle 专用实体与 Dexie v7 表。
- `lib/meegle/contracts.ts`：Meegle context、分析响应和回填类型。
- `lib/meegle/lifecycle.ts`：可测试的回填门槛、历史转换和幂等标记纯函数。
- `lib/server/meegle-cli.ts`：以 `execFile` 参数数组安全调用 Meegle CLI。
- `lib/server/analysis-artifacts.ts`：创建、编码、校验运行级 artifactRef，限制日志路径。
- `app/api/meegle/context/route.ts`：获取并规范化工作项详情、评论和插件附件。
- `app/api/meegle/analyze/route.ts`：接受已保存 context，完整透传共享分析响应。
- `app/api/issues/process/route.ts`：仅对 Meegle run 使用不可变产物子目录并返回 artifactRef/elapsedMs。
- `app/api/issues/review/route.ts`：可选按合法 artifactRef 读取指定运行日志。
- `app/api/meegle/artifacts/route.ts`：列出和读取白名单文本产物。
- `app/api/meegle/comment/route.ts`：图片上传、result marker 查重、Markdown 评论回填。
- `app/api/meegle/workflow/route.ts`：按请求 project/type 查询和执行状态流转。
- `stores/meegleAssignmentStore.ts`：保存 type 与最新 task/result 引用。
- `stores/meegleProcessStore.ts`：独立处理、复核、校验、历史、回填和流转编排。
- `components/meegle/MeegleResultDetail.tsx`：独立结果详情 UI。
- `components/meegle/MeegleRuleGroupLane.tsx`：改用 process store 并提供结果导航。
- `app/meegle/issues/[workItemId]/result/page.tsx`：禁用 SSR 的结果路由。
- `scripts/check-meegle-result-lifecycle.mjs`：全链路静态契约回归。
- `scripts/test-meegle-lifecycle.ts`：纯函数行为测试。
- `package.json`：注册目标测试命令。

### 任务 1：独立数据模型与生命周期契约

**文件：**
- 创建：`scripts/check-meegle-result-lifecycle.mjs`
- 创建：`lib/meegle/contracts.ts`
- 创建：`lib/meegle/lifecycle.ts`
- 修改：`lib/db/schema.ts`
- 修改：`stores/meegleAssignmentStore.ts`
- 修改：`app/meegle/page.tsx`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的静态契约测试**

测试必须断言 schema 包含 `MeegleIssueSnapshot`、`MeegleProcessTask`、`MeegleProcessResult`、`MeegleAnalysisHistory`、`MeegleValidationRun`、`MeegleValidationCheck` 及相应 table；assignment 包含 `workItemTypeKey/latestTaskId/latestResultId`；页面分配时传递 type key。

- [ ] **步骤 2：运行测试验证失败**

运行：`source ~/.bashrc && node scripts/check-meegle-result-lifecycle.mjs`

预期：FAIL，首先报告 `schema defines MeegleIssueSnapshot` 未满足。

- [ ] **步骤 3：实现最小 schema 与契约**

新增 Dexie v7 表。`MeegleProcessResult` 必须分别保存 AI 复核建议、人工复核状态、评论状态和 transition 状态；`MeegleAssignment.result` 保留为可选旧字段但不再写入。

- [ ] **步骤 4：实现旧 assignment 兼容迁移**

在 v7 upgrade 中为存在旧 `result` 的 completed assignment 创建最小 snapshot/task/result，并写回 latest IDs；迁移 ID 必须由 assignment ID 可重复推导，保证幂等。

- [ ] **步骤 5：运行目标测试和类型检查**

运行：`source ~/.bashrc && npm run test:meegle-results && npx tsc --noEmit`

预期：目标测试通过，TypeScript 退出码 0。

### 任务 2：完整上下文采集

**文件：**
- 创建：`lib/server/meegle-cli.ts`
- 创建：`app/api/meegle/context/route.ts`
- 修改：`app/api/meegle/workitem/route.ts`
- 修改：`scripts/check-meegle-result-lifecycle.mjs`

- [ ] **步骤 1：扩展失败测试**

断言 context route 强制校验 `projectKey/workItemTypeKey/workItemId`、拒绝非 `issue`、调用 workitem/comment/plugin 三类来源，并返回统一 `rawData.source="meegle"`。

- [ ] **步骤 2：验证新增断言失败**

运行：`source ~/.bashrc && npm run test:meegle-results`

预期：FAIL，报告缺少 context route。

- [ ] **步骤 3：实现安全 CLI helper 和 context route**

使用 `execFile("meegle", args)`，不拼接 shell；HTML 描述转纯文本，评论规范化为 `{author, body, created}`，插件附件保留真实 `contentUrl`。

- [ ] **步骤 4：验证 context 契约**

运行：`source ~/.bashrc && npm run test:meegle-results && npm run test:meegle-plugin-attachments`

预期：两项通过。

### 任务 3：完整分析响应与运行级产物

**文件：**
- 创建：`lib/server/analysis-artifacts.ts`
- 修改：`app/api/issues/process/route.ts`
- 修改：`app/api/meegle/analyze/route.ts`
- 修改：`scripts/check-meegle-result-lifecycle.mjs`

- [ ] **步骤 1：扩展失败测试**

断言 process request 支持 `source/runId`；Meegle 日志目录包含安全 run ID；所有返回路径包含 `elapsedMs/artifactRef`；analyze 透传 `replyText/chartImage/signalSummary/traceData/ticks/stages/mode/model`。

- [ ] **步骤 2：运行并确认失败来自响应字段缺失**

运行：`source ~/.bashrc && npm run test:meegle-results`

- [ ] **步骤 3：实现 artifactRef 与 Meegle 运行目录**

artifactRef 使用 URL-safe base64 编码 `{groupDir, carModel, issueKey, runId}`；解码后每段重新 sanitize，并用 `path.relative(LOG_BASE, resolved)` 拒绝越界。Jira 没有 source/runId 时保持原目录。

- [ ] **步骤 4：统一所有 process 返回形状并透传**

在 reject、no attachments、full pipeline 三条路径计算 elapsedMs 和 artifactRef；Meegle analyze 不再把 `replyText` 重命名后丢弃其他字段。

- [ ] **步骤 5：运行回归**

运行：`source ~/.bashrc && npm run test:meegle-results && npm run test:accuracy-phase1 && npx tsc --noEmit`

预期：全部通过。

### 任务 4：Meegle process store 与持久化生命周期

**文件：**
- 创建：`stores/meegleProcessStore.ts`
- 创建：`scripts/test-meegle-lifecycle.ts`
- 修改：`lib/meegle/lifecycle.ts`
- 修改：`components/meegle/MeegleRuleGroupLane.tsx`
- 修改：`package.json`

- [ ] **步骤 1：编写纯函数失败测试**

覆盖：只有人工通过或人工改判且有正确结论才可回填；历史按 sourceResultId 幂等；旧 completed result 转最小记录；评论成功但 transition 失败保留部分成功。

- [ ] **步骤 2：运行验证正确失败**

运行：`source ~/.bashrc && node --import tsx scripts/test-meegle-lifecycle.ts`

预期：FAIL，缺少 lifecycle exports。

- [ ] **步骤 3：实现纯函数和 store**

`processAssignment()` 顺序固定为 context 成功 → Dexie transaction 归档旧结果并建 snapshot/task → analyze → transaction 保存 task/result/latest IDs → 自动校验。失败任务保存 error，不清除旧 latestResultId。

- [ ] **步骤 4：切换 lane 调用 store**

删除 lane 中直接 fetch 和 `markCompleted(resultString)`；处理中与失败状态由 store 驱动。

- [ ] **步骤 5：运行目标验证**

运行：`source ~/.bashrc && npm run test:meegle-lifecycle && npm run test:meegle-results && npx tsc --noEmit`

### 任务 5：AI 复核、人工复核与独立校验

**文件：**
- 创建：`lib/analysis/validation-core.ts`
- 修改：`stores/validationStore.ts`
- 修改：`stores/meegleProcessStore.ts`
- 修改：`app/api/issues/review/route.ts`
- 修改：`scripts/test-meegle-lifecycle.ts`
- 修改：`scripts/check-meegle-result-lifecycle.mjs`

- [ ] **步骤 1：新增失败测试**

断言 AI verdict 不改变人工 `reviewStatus`；人工改判写共享 learning sample；Meegle 校验写专用表；review 带 artifactRef 时只读指定 run。

- [ ] **步骤 2：运行验证失败**

运行：`source ~/.bashrc && npm run test:meegle-lifecycle && npm run test:meegle-results`

- [ ] **步骤 3：提取纯校验计算并适配两个 store**

`validation-core.ts` 返回 run/check 输入，不访问 Dexie；Jira store 保持现有表，Meegle store 写专用表。

- [ ] **步骤 4：实现复核动作**

AI 复核保存 `aiReviewVerdict/reason/time`；人工通过更新 reviewStatus；人工改判同时保存正确结论、原因、共享学习样本和 memory。

- [ ] **步骤 5：运行相关回归**

运行：`source ~/.bashrc && npm run test:meegle-lifecycle && npm run test:evidence-validation && npm run test:signal-rag && npx tsc --noEmit`

### 任务 6：产物浏览、评论图片回填与 workflow

**文件：**
- 创建：`app/api/meegle/artifacts/route.ts`
- 创建：`app/api/meegle/comment/route.ts`
- 创建：`lib/server/meegle-comment.ts`
- 修改：`app/api/meegle/workflow/route.ts`
- 修改：`stores/meegleProcessStore.ts`
- 修改：`scripts/test-meegle-lifecycle.ts`
- 修改：`scripts/check-meegle-result-lifecycle.mjs`

- [ ] **步骤 1：编写失败测试**

覆盖 artifact 白名单/越界拒绝/截断、每次 comment add 前 marker 查重、图片 resource type 14、project/type/workItem 参数传递、评论成功后 transition 失败不重复评论。

- [ ] **步骤 2：运行确认失败**

运行：`source ~/.bashrc && npm run test:meegle-lifecycle && npm run test:meegle-results`

- [ ] **步骤 3：实现 artifact 与 comment helper/API**

允许文本文件名由固定正则白名单决定，单文件上限 512 KiB；评论 marker 为 `<!-- analyzer-result:${resultId} -->`；上传返回 URL/token 后组装飞书图片 Markdown。

- [ ] **步骤 4：改造 workflow API 和 store 部分成功语义**

GET/POST 都要求 projectKey/workItemTypeKey/workItemId；评论状态写成功后才执行可选 transition，transition 失败只更新 transitionError。

- [ ] **步骤 5：运行目标与安全回归**

运行：`source ~/.bashrc && npm run test:meegle-lifecycle && npm run test:meegle-results && npm run test:perf:security && npx tsc --noEmit`

### 任务 7：独立结果详情 UI

**文件：**
- 创建：`components/meegle/MeegleResultDetail.tsx`
- 创建：`app/meegle/issues/[workItemId]/result/page.tsx`
- 修改：`components/meegle/MeegleRuleGroupLane.tsx`
- 修改：`components/meegle/MeegleIssueDetail.tsx`
- 修改：`scripts/check-meegle-result-lifecycle.mjs`

- [ ] **步骤 1：扩展失败静态 UI 测试**

断言完成卡存在结果链接；路由动态禁用 SSR；页面包含工单内容、处理过程、分析结果、流水线日志、历史版本、原始数据、AI 复核、人工通过、人工改判、一致性校验和“回填飞书项目”。

- [ ] **步骤 2：运行验证 UI 断言失败**

运行：`source ~/.bashrc && npm run test:meegle-results`

- [ ] **步骤 3：实现路由与 A 布局详情**

左栏显示 snapshot，右栏使用页签。图表只消费 result.traceData/chartImage；评论预览使用 textarea；transition 必须显式选择。

- [ ] **步骤 4：接入结果导航与重试**

完成卡点击导航；失败卡保留重试；现有即时详情分析入口统一调用 process store。

- [ ] **步骤 5：运行前端验证**

运行：`source ~/.bashrc && npm run test:meegle-results && npm run test:frontend && npm run test:shared-axis-chart && npx tsc --noEmit`

### 任务 8：文档与最终验收

**文件：**
- 修改：`docs/PRODUCT.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/WORKFLOW.md`
- 修改：`docs/SEQUENCE_DIAGRAMS.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：同步产品与架构文档**

记录独立 Meegle 表、非流式阶段、运行级 artifact、人工复核门槛、评论幂等和部分成功语义。

- [ ] **步骤 2：运行完整目标验证**

运行：`source ~/.bashrc && npm run test:meegle-results && npm run test:meegle-lifecycle && npm run test:meegle-plugin-attachments && npm run test:evidence-validation && npm run test:signal-rag && npm run test:frontend && npx tsc --noEmit && npm run build`

预期：所有命令退出码 0；构建完成所有路由编译。

- [ ] **步骤 3：浏览器验收**

启动：`source ~/.bashrc && npm run dev`

使用 Playwright 在桌面与移动视口验证 `/meegle` 完成卡导航和结果页无重叠；检查工单内容、阶段、结论、图表、复核、校验、历史、回填预览和状态流转控件可见。

- [ ] **步骤 4：更新 handoff**

写明改动文件、验证命令、已知环境限制和真实飞书回填是否执行；未经用户明确授权，不向真实工作项写评论或执行流转。