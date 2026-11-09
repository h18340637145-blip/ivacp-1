# 业务流程文档（Next.js 版）

## IVACP 规则组配置流程（2026-10-27，已接通）

1. 登录后首页从 `IvacpDB.ruleGroups` 按 `sortOrder` 读取卡片；读取失败显示错误，可点击重试。
2. 管理员点击「新建规则组」或「新建 Bosch Jira 规则组」，填写名称、查询、路径、车型和提示词，保存后写入 IndexedDB 并刷新卡片。普通分析员点击「查看配置」查看禁用编辑的表单。
3. 编辑沿用原规则组 ID；表单校验空名称和重复车型，保存失败时保留表单并显示错误。
4. 管理员拖动卡片把手；也可聚焦把手，按空格拿起、方向键移动、空格放下，Escape 取消。数据库提交成功后更新顺序，刷新仍保留。关键词或来源筛选期间禁用排序。
5. 「导出规则组」下载兼容旧版的 JSON 文件。「导入」先选择并校验文件、预览名称，再确认合并或覆盖；合并保留已有排序，覆盖明确提示替换全部规则组配置。
6. 删除前确认，只删除规则组配置，已有分析结果和历史保留。导入解析失败不会删除或部分写入现有配置。

## IVACP 已接通的分析流程

当前代码的逐阶段流程、附件分支、配置版本边界及修改入口见 [Pipeline 工作流程与修改索引](PIPELINE_GUIDE.md)（2026-10-29 核对）。

1. 首页或规则组点击筛选，并发执行配置的来源。飞书单组请求携带同项目的优先级比较组；只有成功组列表确认目标组成功后，才事务写入快照、分配和审计。失败来源不展示旧成功快照，另一来源仍可处理。
2. 进入规则组分析页，点击单票「分析」或「分析待处理工单」。每次处理创建独立快照与 task，飞书预取上下文后由浏览器直接调用共享处理接口。重复点击及其他标签页中的活动 task 不会创建重复运行。
3. 详情显示结论、Token、阶段状态、信号图、上下文、历史和可用过程产物。重新分析先归档旧结果，失败后保留旧结论并明确显示失败原因。
4. 飞书页面刷新不取消服务端运行；浏览器定期按原 run 查询恢复。无完整产物且未超过 2 小时保持运行，超过期限才标记失败；显式停止使用独立停止接口。
5. AI 复核显示建议；飞书须人工通过，或人工驳回并填写正确结论，才可回填。校验结果可单独查看与人工改判。
6. 回填弹窗核对正文、附图和可选状态流转。评论成功立即持久化；流转失败只重试流转。并发标签页共享回填领取状态，不能重复发表评论。中断重试须确认原票没有相同评论。
7. 经办人指派只修改经办人。Jira 使用原快照站点；飞书读取当前详情及人员目录，取得目标绑定授权，并由服务端再次检查当前经办人后更新。

自动周期、数据管理、标注已接通；API 文档已接通；终端已接通；剩余功能对照见 `docs/REFACTOR_STATUS.md`。最近实际验证结果见 `session-handoff.md`。

## 本年度统计查看

在平时保留处理记录的浏览器及同一项目地址打开首页，点击「本年度统计」，可选择年份与起止月份后点「查询」（如 7–9 月），查看该范围的处理票数和分析次数；「重新统计」重新读取当前数据。Jira 显示含 AI 判断的复核通过率，飞书显示可确认人工复核的准确率，未复核或无法确认记录不进入比率分母。统计使用每张票今年最后一次成功分析的状态，不修改结果、样本或复核记录。

## Bosch Jira 规则组

管理员点击首页「新建 Bosch Jira 规则组」，填写名称、Bosch JQL 及路径/车型/Prompt（或导入含 `jiraProvider: "bosch"` 的规则组文件）。「一键筛选 / 处理」与普通 Jira 规则组流程相同，仅服务地址与凭据切换为 `BOSCH_JIRA_*`。

## 主页统一规则组筛选与处理

规则组「一键筛选」并发执行已配置的 Jira JQL 和飞书项目 MQL；任一来源失败只显示该来源错误，另一来源成功快照仍可处理。「一键处理」按来源分派到既有 Jira 或飞书项目处理生命周期，AI 分析、人工复核和回填权限保持不变。

> **项目**：博世汽车软件 · Jira 缺陷票 AI 辅助分析系统（Next.js 全栈实现）  
> **技术栈**：Next.js + React + TypeScript + shadcn/ui + IndexedDB + dnd kit + Qwen API  
> **适用范围**：分析员、项目管理员、自动化运维人员  
> **更新日期**：2025-07

## Docupedia 月度统计查看

- 单篇文本文章上传成功（新建或确认已存在）后，正文字符数严格大于 500 时记录一行；同月重复标题不再累计。字符数使用合并后的正文 `text.length`（UTF-16 代码单元，包含空白和文件分节标题，不包含 HTML 包装），不是文件字节数。
- 月份按服务器本地时间划分，历史月文件保留，新月份自动写入新文件。只统计启用后成功确认的文章，不扫描旧日志补算；统计写入失败只在服务终端告警。
- 最新一行的 `monthlyTotal` 是本月累计数，每行保留文章明细。尚无合格文章时不会创建文件。查看当前月份：

```bash
tail -n 1 "log/docupedia-upload-stats/$(date +%Y-%m).jsonl"
```

- `npx vitest run test/docupedia-stats.test.ts test/docupedia-client.test.ts test/operations-cli.test.ts` 验证阈值、去重、并发、本地月份、重启续计、失败保护和清理保留；归档网络请求全部模拟，不发布真实文章。

## 飞书项目 MQL 筛票流程

飞书筛选依赖运行 Next.js 的同一系统用户下的 Meegle CLI 登录态，与本应用登录及 Jira Basic Auth 相互独立。CLI 返回 `AUTH_REQUIRED` 时，筛选失败审计保留明确的重新授权提示；在同一环境执行 `meegle auth login --device-code --host project.feishu.cn`，完成授权后重新筛选。不要在服务端请求内自动发起交互登录，也不能将认证失败当成成功的空结果。`/api/meegle/filter` 的 HTTP 200 仅表示已返回审计，仍需检查 `audits` 和成功规则组列表。

1. 用户在 `/meegle` 触发一键筛选，或在规则组触发筛选票。
2. 浏览器优先从完整 `RuleGroup.meegleMql` 的 `FROM` 数据源解析项目 key，再由服务端执行 MQL 查询；当前用户“我的待办”为空也不能阻断完整 MQL。只有兼容旧条件式 MQL 时才回退从“我的待办”推断项目 key。
3. 同一工作项命中多个规则组时，按 `sortOrder`、再按规则组 `id` 决定唯一归属；成功 MQL 查询会解除该组未再次命中的所有分配（包括已完成、已回填和人工分配），仅保留其结果与历史；MQL 是规则组展示和处理范围的唯一依据。
4. 飞书 MQL 返回 `data: {}`、`list: null` 时视为成功的 0 条结果，继续对账并解除不再命中的分配；单个规则组的 MQL 响应确实失败时，写入本地飞书筛选审计并保留该组既有归属，但当前筛选票列表保持为空，不得回退展示更早的成功快照；失败不触发、不写入也不修改 Jira 筛票、任务或数据。

---

## 目录

1. [流程总览](#1-流程总览)
2. [手动筛票流程](#2-手动筛票流程)
3. [手动单票处理流程](#3-手动单票处理流程)
4. [AI 复核流程](#4-ai-复核流程)
5. [人工复核流程](#5-人工复核流程)
6. [Jira 回填流程](#6-jira-回填流程)
7. [AI 校验流程](#7-ai-校验流程)
8. [人工改判流程](#8-人工改判流程)
9. [自动周期运行流程](#9-自动周期运行流程)
10. [一键筛选 / 一键处理流程](#10-一键筛选--一键处理流程)
11. [Jira 状态流转流程](#11-jira-状态流转流程)
12. [拖拽排序流程](#12-拖拽排序流程)
13. [业务决策点说明](#13-业务决策点说明)
14. [自动化与手动操作边界](#14-自动化与手动操作边界)

---

## 1. 流程总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 博世 Jira 缺陷票 AI 分析系统 · 全局流程（Next.js 版）          │
│                                                                             │
│  ┌─────────┐   筛票    ┌──────────────┐  处理   ┌─────────────────────┐    │
│  │  Jira   │ ───────> │FilteredIssue │ ──────> │ IssueProcessResult  │    │
│  │（奇瑞/  │          │  Snapshot    │         │  (Qwen AI 分析结论)  │    │
│  │  吉利…）│          └──────────────┘         └──────────┬──────────┘    │
│  └─────────┘                                              │               │
│                                                    ┌──────▼──────┐        │
│                                             AI 复核 │ AI Review   │        │
│                                                    └──────┬──────┘        │
│                                                           │               │
│                                                    ┌──────▼──────┐        │
│                                           人工复核  │Manual Review│        │
│                                                    └──────┬──────┘        │
│                                                           │               │
│                                            ┌─────────────▼──────────────┐ │
│                                  AI 校验   │  IssueValidationRun        │ │
│                                            │  (PASS/FAIL/WARNING/UNKNOWN)│ │
│                                            └─────────────┬──────────────┘ │
│                                                          │               │
│                                                   ┌──────▼──────┐       │
│                                         Jira 回填  │  Jira 评论  │       │
│                                                   └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 核心业务对象（TypeScript 类型）

| 对象 | 说明 | 存储位置 |
|------|------|----------|
| `RuleGroup` | 规则组，每个对应一个汽车项目，包含 JQL 配置 | IndexedDB `ruleGroups` 表 |
| `FilterTask` | 筛票任务，记录一次 JQL 查询执行的生命周期 | IndexedDB `filterTasks` 表 |
| `FilteredIssueSnapshot` | 筛票快照，每张 Jira 票对应一条记录 | IndexedDB `filteredIssueSnapshots` 表 |
| `IssueProcessTask` | 单票处理任务，驱动 AI 分析流程 | IndexedDB `issueProcessTasks` 表 |
| `IssueProcessResult` | 处理结果，存储 AI 分析结论和复核状态 | IndexedDB `issueProcessResults` 表 |
| `IssueValidationRun` | 校验运行记录，存储 AI 校验 + 人工改判结果 | IndexedDB `issueValidationRuns` 表 |
| `IssueReviewSample` | 历史错例，用于 Few-shot AI 复核 | IndexedDB `issueReviewSamples` 表 |
| `LearningMemory` | AI 学习记忆，持久化错误案例 | IndexedDB `learningMemories` 表 |
| `AutoCycleState` | 自动周期运行状态 | IndexedDB `autoCycleStates` 表 |

### UI 组件与业务对象映射

> **设计说明**：本项目不强制使用 Card 组件。规则组采用行式布局（`RuleGroupRow`），左侧彩条区分角色，信息密度更高。

| 业务对象 | 实现组件 | 交互方式 |
|----------|---------|---------|
| RuleGroup | **RuleGroupRow**（自定义行，左彩条） | dnd kit 拖拽排序 |
| FilterTask / ProcessTask | 行内嵌列表（待实现） | ScrollArea 滚动展示 |
| 新建/编辑规则组 | **RuleGroupDialog**（Radix Dialog Primitive）| 暗色弹框表单 |
| 任务详情 | **Dialog**（待实现） | 弹框查看 |
| 操作按钮 | 内联 `<button>` + CSS 变量样式 | 筛票/处理/复核/回填 |
| 标签/状态 | 内联 `<span>` | 车型、角色、Jira 项目标识 |

---

## 2. 手动筛票流程

### 2.1 触发条件

- 用户在首页 RuleGroupCard（Card 组件）上点击 **"筛票"** Button（单规则组），或
- 用户点击首页的 **"一键筛选"** Button（所有规则组）。

### 2.2 前置条件

- 规则组已正确配置 JQL 查询语句（通过 Dialog 表单编辑保存）。
- Jira 服务可用，且当前账号有权限执行 JQL。
- 距上次同规则组筛票任务启动超过 **10 分钟**（防重复提交）。

### 2.3 流程步骤

```
用户点击"筛票"Button
      │
      ▼
[React] POST /api/rule-groups/{roleIndex}/filter-tasks
      │     使用 React Query useMutation
      ▼
[API Route] 检查同规则组是否存在 10 分钟内的运行中任务
      │
      ├─ 存在 ──► 返回 409 Conflict（前端 Toast 提示，流程终止）
      │
      └─ 不存在
            │
            ▼
      [API Route] IndexedDB 创建 FilterTask（状态：PENDING）
            │
            ▼
      [Store] 写入本地任务状态，前端显示筛票中
            │
            ▼
      [异步 Promise] jiraClient.searchIssues(jql) → 执行 JQL 查询
            │
            ▼
      [异步 Promise] 为每张返回的 Jira 票创建 FilteredIssueSnapshot
            │
            ▼
      [异步 Promise] FilterTask 状态 → SUCCESS
            │
            ▼
      [Store] 更新任务状态和快照数量
            │
            ▼
      [React] RuleGroupCard 重渲染，显示筛票结果数量
```

### 2.4 后置条件

- `FilterTask.status = 'SUCCESS'`，`filteredCount` 记录命中票数。
- 每张命中的 Jira 票均有对应的 `FilteredIssueSnapshot` 记录存入 IndexedDB。

### 2.5 异常处理

| 异常场景 | 处理方式 | UI 反馈 |
|----------|----------|---------|
| 同规则组 10 分钟内已有运行中任务 | 返回 409 | Toast 提示用户等待 |
| Jira 连接失败 / 认证失败 | FilterTask.status = FAILED | Card 显示错误状态 |
| JQL 语法错误 | FilterTask.status = FAILED | Toast 显示 JQL 错误详情 |
| JQL 查询超时 | FilterTask.status = EXPIRED | 规则组行恢复可重新筛票 |

### 2.6 启动恢复

- 首页启动时会先检查 IndexedDB 中历史 `running` / `pending` 筛票任务。
- 若任务创建时间已超过 `FILTER_TASK_TIMEOUT_MS`（当前为 10 分钟），系统会自动将其标记为 `expired`，并写入“筛票任务超时，已在启动恢复时自动过期”错误信息。
- 当前会话中的 Jira 筛票请求超过同一阈值时，也会写入 `expired`，而不是永久停留在 `running`。
- `expired` 任务不再被前端视为正在筛票，规则组行会恢复可点击的“筛票”按钮，避免页面关闭、刷新或请求中断后永久显示“筛票中...”。

---

## 3. 手动单票处理流程

### 3.0 飞书项目工作台入口

1. `/meegle` 调用 `/api/meegle/mywork`，后端执行 `meegle mywork todo` 获取当前用户待办。
2. 自动筛票从完整 `RuleGroup.meegleMql` 解析项目 key，并以 MQL 查询结果作为唯一展示与处理范围；多规则组命中按 `sortOrder`、再按规则组 `id` 决定唯一归属。成功查询会解除所有未再次命中的分配（包括人工拖拽、已完成和已回填），但保留结果与历史；所需 MQL 响应失败写入 `meegleFilterAudits` 并保留原有归属，同时隐藏旧成功快照，避免将历史票显示为当前命中。
3. 未分配工作项显示在左侧卡池；分析员将卡片拖入现有规则组，分配状态写入 IndexedDB `meegleAssignments`。
4. 规则组队列手动处理待办卡片。`meegleProcessStore` 先调用 `/api/meegle/context`，将工作项详情、评论、评论附件和插件附件保存为不可变 `MeegleIssueSnapshot`：评论附件从 Markdown、`file_url`、`file_urls` 提取。共享处理 run 会预取评论附件以补齐真实文件名、类型和大小，再以评论创建时间与插件附件的上传时间统一筛选；选中的评论附件复用预取文件。两类来源均无 CAN trace 或日志压缩包时直接返回固定补件结论，不调用仅评论 AI 分析；随后创建并完成 `MeegleProcessTask`。
5. `meegleProcessStore` 将已保存快照、规则组 prompts、JSON/Proto/DBC 路径、车型映射和 task ID 直接提交给 `/api/issues/process`。共享流水线复用 Jira 的下载、解压、信号解析、Qwen 推理与后处理算法，但 Meegle 每次运行写入独立 run 目录。主链路不再经过 `/api/meegle/analyze` 的服务端 HTTP 回环，避免长耗时分析在完成前因响应头等待超时而跳过 IndexedDB 结果事务；该路由仅暂时保留旧调用兼容。
6. 共享处理成功后按 `ENABLE_DOCUPEDIA` 对当前 Meegle run 的日志执行归档；浏览器完整保存 `replyText`、阶段、模型、耗时、CAN 图、信号摘要、trace、ticks 和 `artifactRef` 到 Meegle 专用结果表，并发送带“飞书项目处理通知”来源的成功通知。若浏览器在此事务前中断，首页和结果详情仅针对持久化的 `processing` task，以其不可变 runId 校验 `pipeline-metrics.json=status:success` 与完整最终结论；校验通过后重建签名产物引用、结果和回填凭据，并改为 completed。恢复接口对无完整产物返回 HTTP 200 `recoverable: false`：任务创建未满 2 小时时客户端保持处理中，超过 2 小时则在同一 IndexedDB 事务中将 task 和 assignment 标记为 failed 并允许重试。失败时保存 failed task/assignment 后发送失败通知；通知和归档失败均不改变处理结果。
7. 完成卡进入 `/meegle/issues/{workItemId}/result`。详情页左侧展示工单内容，右侧展示处理过程，并提供分析结果、运行日志、历史记录和原始数据四个视图。结果页读取当前工作项详情凭据，复用 `MeegleAssigneeControl` 从项目完整人员目录按姓名、邮箱或用户 ID 模糊搜索并修改经办人；写入仍经过目标绑定授权和二次读取冲突校验。
8. 结果页的「重新分析」需要用户确认，调用当前 assignment 所属规则组的 `processAssignment`。store 先将旧 result 写入 `meegleAnalysisHistories`，再创建新的 snapshot/task/run；成功后新 result 成为 `latestResultId`，失败则保留旧 result 并显示失败信息。重新分析不会自动评论或流转飞书项目。
9. AI 复核只写入建议字段；人工通过，或人工驳回且填写正确结论后，才允许进入飞书回填。人工通过写入受证据门槛约束的正样本；人工驳回写入纠错样本与学习记忆。
10. 用户编辑评论、选择是否附带 CAN 图、按需选择 transition，并勾选授权后提交。评论 API 每次先按 result marker 查询已有评论；多行 Markdown 正文通过 Meegle CLI 的 JSON `--params` 通道提交，避免命令行 flag 解析丢失正文；评论成功立即持久化，再单独执行状态流转。流转失败时只重试流转，不重复评论。

非 `issue` 工作项不进入该链路。插件列表不可用时仅记录告警并继续评论分析；真实飞书评论和状态流转只能由用户在详情页显式确认触发。

### 3.1 触发条件

用户在规则组详情页（ScrollArea 内）找到目标 Jira 票，点击 **"处理"** Button。

### 3.2 前置条件

- 该票存在对应的 `FilteredIssueSnapshot`。
- 当前无活跃的处理任务（`PENDING` 或 `RUNNING` 状态）。
- 该票即使已经分析过，也允许再次分析；旧结果只作为历史记录，不作为新结果的复核状态。

### 3.3 流程步骤

```
用户点击"处理"Button
      │
      ▼
[React] POST /api/filter-tasks/{filterTaskId}/issues/{issueKey}/process-tasks
      │     useMutation + onSuccess 回调
      ▼
      [API Route] 检查是否存在活跃处理任务（PENDING/RUNNING）
      │
      ├─ 存在 ──► 返回 409，Toast 提示（流程终止）
      │
      └─ 不存在
            │
            ▼
      [React] 将同票旧 IssueProcessResult 归档为 IssueAnalysisHistory
            │
            ▼
      [API Route] IndexedDB 创建 IssueProcessTask（状态：PENDING）
            │
            ▼
      ┌─────────────────────────────────────────────────────────────┐
      │       异步执行 issueAnalysisService.runIssueProcessTask      │
      │                                                             │
      │  ① PREPARING       加载规则组配置、初始化分析上下文         │
      │  ② DOWNLOADING     fetch Jira REST API 下载附件（ZIP/PNG）  │
      │  ③ UNPACKING       递归解压日志包/嵌套压缩包，提取 CAN 与 Android/QNX 日志 │
      │  ④ PARSING         解析 CAN trace + DBC，输出信号持续区间摘要 │
      │                    并生成 signals.json / signals_id.json / extract.md │
      │  ⑤ MODEL_INFERENCE fetch Qwen API 多轮推理                  │
      │       ├─ EXTRACT_SIGNALS_SYSTEM    提取关键信号              │
      │       ├─ LOG_SUMMARY_SYSTEM        日志摘要生成              │
      │       ├─ COMPARE_CANTRACE          CAN 日志比对              │
      │       ├─ REQUIREMENT_EXTRACT_SYSTEM 需求文本提取             │
      │       └─ CONSISTENCY_SYSTEM        一致性分析                │
      │  ⑥ GENERATING_REPLY 生成 replyText（自然语言分析结论，若包含信号/报文不存在则追加从最大 cycle 文件夹 Buildinfo.txt 提取的博世 MAIN_VERSION） │
      │  ⑦ SAVING_RESULT    保存 IssueProcessResult + 生成波形图    │
      │                    写入 pipeline-metrics.json 作为耗时/准确率基线 │
      │                    服务端成功响应完成后，Next.js `after` 异步归档当前 run 的 logRoot；浏览器独立持久化 IndexedDB │
      └─────────────────────────────────────────────────────────────┘
            │
            ▼
      [Store] 写入最终 SUCCESS / FAILED 状态
      [React] Zustand 状态更新 → TaskItem 重渲染，详情页以纯散点图展示 CAN 信号时序，不绘制折线连接
```

### 3.4 AI 推理子流程说明（MODEL_INFERENCE 阶段）

| 步骤 | Qwen System Prompt | 作用 |
|------|-------------------|------|
| 1 | `EXTRACT_SIGNALS_SYSTEM` | 从 CANtrace 解析出与缺陷相关的信号列表 |
| 2 | `LOG_SUMMARY_SYSTEM` | 对日志数据生成人类可读的摘要 |
| 3 | `COMPARE_CANTRACE` | 将 Jira 票描述的现象与 CAN 实测数据逐项比对 |
| 4 | `REQUIREMENT_EXTRACT_SYSTEM` | 从 Jira 票提取需求 / 期望行为描述 |
| 5 | `CONSISTENCY_SYSTEM` | 基于 CAN trace 提取后结果，综合上层日志判断缺陷是否可复现、是否与描述一致 |

**Step 2 信号识别补救**：

- `step2_signals.md` 解析出的 token 先按既有精确规则匹配 `prop`、`getSignals`、`setSignals`。
- 精确未命中的 token 会进入模糊 / 别名补救；仍未命中时，系统只用一次受限模型自检，并要求模型只能从真实候选 `prop` 列表中选择或返回 `null`。
- 系统会从 Step 2 输出、Jira 标题 / 描述 / 评论和 few-shot 样本构建信号候选池，只保留形态像信号的 token（包含 `AVHSts` 这类 PascalCase）并按权重截断到最多 40 个；当前车型配置只用于同名候选标注和后续匹配目标，不会把配置全集单独扩入候选池。
- `signals.json` 会保存 `matches`（精确命中）、`recovered`（fuzzy / self_check 补救）、`candidateSources`（候选来源）、`recovered[].recoveryReason`（补救原因）和 `unmatched`（最终未命中）；`pipeline-metrics.json.counts` 同步记录补救和未命中数量。
- CANtrace 回放和 CAN 图表只消费 Step 2 提取并成功匹配到的信号，每个匹配只选择一个代表信号；候选池、标题、描述、评论、OCR、few-shot 或配置来源中的其他信号仅落盘到 `signals.json` 供审计，不得进入回放，也不得绘图。完整 `signals.json` / `signals_id.json` 仍保留全部匹配用于审计、证据包和日志摘录，不把所有匹配都画到图里。前端 Chart.js 交互图与“锁定当前视口为回填图”截图仅使用处理结果中的提取后 `traceData`，不得从候选池、`signals.json` 或 `signals_id.json` 重建 / 补充图表系列。

**Step 5 一致性分析 Token 预算**：

- Step 5 前会生成结构化 Evidence Packet，文件位于 `log/{ruleGroup}/{carModel}/{issueKey}/evidence-packet.json`，包含匹配 prop、Property ID、信号区间、日志命中、缺失证据和风险标记。
- Step 5 优先读取 `<结构化证据包>`，再读取 CAN trace 摘要和日志文本。若证据包存在 `missingEvidence` 或 `riskFlags`，模型必须降低置信度并说明缺失证据；该机制不改变人工复核控制 Jira 回填的边界。
- Step 5 以 `can_trace_extracted_result.txt` 中的 CAN trace 提取后结果作为主证据，原始 CAN trace 仅作为短片段参考。
- 进入 Qwen 前会按模型上下文预留输出空间，并对合并后的 Step 5 prompt 做总 Token 预算控制。
- 若输入超预算，系统优先裁剪原始 CAN trace 片段，其次裁剪可恢复查看的长摘要；完整 CAN 明细仍保存在 `log/{ruleGroup}/{carModel}/{issueKey}/can_trace_extracted_result.txt` 和 `can_signal_summary.txt`，不丢失本地审计证据。
- 裁剪决策会写入 `pipeline.log` 的 `AI_STEP5` 阶段，便于定位输入规模问题。

**Step 5 证据自批判**：

- Step 5 生成最终结论并清理 think 内容后，系统会以 `evidence_packet`、`can_signal_summary`、`can_trace_extracted_result`、`signals_id`、`extract` 五类具名可信证据源计算证据接地率 EGR；在线自检与离线评测使用相同来源名称和判定 helper。
- Grounding 索引会归一化时间、键值断言、标识符和 Property ID；缺失来源进入 `missingEvidenceSources` 审计，离线读取或解析错误进入 `evidenceReadErrors` / `evidenceSourceErrors`。无有效证据且无法判定的票标记为 `unknown_missing_evidence`，从平均 EGR 中排除。
- 若存在未接地断言，系统会进行最多 3 轮迭代的低温自批判自愈循环，要求模型删除或弱化证据语料中找不到依据的断言；每一轮均会计算接地率。系统引入接地率回滚保护（Rollback Guard）机制，最终选取接地率最高的结论版本输出，避免重写过程中引入新幻觉。调用失败或无可改善版本时保留原结论。
- 修订结果仅用于提升结论质量，仍不改变人工复核 PASS 才能 Jira 回填的业务边界；修订前后 EGR 及多轮历史会写入 `evidence-grounding.json` 和 `pipeline-metrics.json`。

### 3.5 后置条件

- `IssueProcessTask.status = 'SUCCESS'`。
- `IssueProcessResult` 创建完毕，含 `replyText`、`rawSignals`、CAN 信号波形图。
- 若处理结果包含 `traceData`，详情页优先渲染交互式 CAN 信号图：多个信号共享绝对时间横坐标，各信号使用独立纵坐标，缩放 / 平移时保持同一时间窗。
- 新 `IssueProcessResult.reviewStatus = 'PENDING'`，`hasCommentedToJira = false`；不会继承历史复核或历史回填状态。
- 若该票此前已有分析结果，旧结果已归档为 `IssueAnalysisHistory`，详情页可追溯历史分析和历史复核结果。
- 数据持久化到 IndexedDB。
- 服务端完成成功响应后，浏览器收到响应并独立写入 IndexedDB；`ENABLE_DOCUPEDIA=1` 时，服务端 Next.js `after` 也在响应完成后异步归档当前 run 的 `logRoot`，二者互不等待或作为门槛。`ENABLE_DOCUPEDIA=0` 时跳过自动上传。归档只读取当前票的 `log/{ruleGroupId}/{carModel}/{issueKey}/`，在配置的 Docupedia 父页面下创建 `meegle_<随机数>` 根页面。同一目录内 `stepN_` 开头且数字相同的日志文件会先拼接成一个带同一随机前缀的 `meegle_<随机数>_stepN` 子文章上传，例如 `step1_requirements_raw.md`、`step1_requirements.md` 和 `step1_thinking.md` 合并到 `meegle_<随机数>_step1`；`input_comments.txt` 不上传。系统不会扫描历史 `log/`、补传旧日志或在进程重启后恢复未完成上传。`socket hang up`、超时、连接重置、429 和 5xx 等瞬时错误会在页面 find-or-create 层重试；单个日志文章最终失败会计入 `failed` 并继续上传后续文章，最终失败只写入 `pipeline.log`，不影响结果、复核或回填。
- 服务端文件系统（附件 + 分析日志）：

```
jira-issues/{ruleGroupId}/{carModel}/{issueKey}/
    trace.asc 或 trace.blf / logs.zip / extracted/   ← 附件永久保留
    extracted/ 下会继续展开 Bosch-*.zip、aplog.*.gz、.tar.gz、.zst 等嵌套归档

log/{ruleGroupId}/{carModel}/{issueKey}/
    pipeline.log          ← 完整执行日志（每行含时间戳、阶段、消息）
    input_comments.txt    ← 发送给 AI 的评论原文
    step1_requirements.md ← Step 1 需求提取结果
    step2_signals.md      ← Step 2 信号提取结果
    signals.json          ← Step 2 token 在 config_车型.json 中命中的配置项（含 prop/getSignals/setSignals 命中方式、候选来源和补救原因）
    signals_id.json       ← 命中 prop 通过 proto Property_ID 映射出的十进制 / 十六进制 id
    evidence-packet.json  ← Step 5、结构化校验和离线评测共用的结构化证据包
    can_trace_extracted_result.txt ← CAN trace 解码后的信号值持续区间摘要（ASC/BLF 同格式输出）
    can_signal_summary.txt ← CAN 信号摘要（同提取结果，供前端展示）
    extract.md            ← 解压日志中位于评论时间窗内且包含目标 prop id 的日志摘录
    step3_upper_summary.md← Step 3 上层日志摘要
    step4_android_qnx.md  ← Step 4 Android/QNX 分析
    pipeline-metrics.json ← 阶段耗时、Prompt 长度、证据完整性和最终状态
    final_reply.md        ← 最终 AI 结论
    stages.json           ← 流水线阶段快照（含耗时 ms）
```

#### Phase 3 证据精召回与评测集覆盖

Step 5 前，系统会基于 `evidence-packet.json` 对处理前召回的 few-shot 案例进行证据后再次召回：客户端随请求携带不超过 100 条的样本快照（`fewShotPool`/`fewShotPoolMeta`，超限按分数截断并记录覆盖比例），服务端在该有界快照与初次入选案例的并集中排除自身票和跨场景样本后，分别执行标识符精确、中文词法和向量语义三路独立检索并按倒数排名融合（RRF）重排，向量一路使用当前证据指纹文本新发起一次服务端 embedding 调用，调用失败时自动降级为仅标识符 + 词法两路并记录原因，不影响处理流程。重排结果连同策略版本、候选数、各路由命中数、排除统计、降级原因和最终入选案例的命中路径与分数一起写入审计（`few-shot-retrieval.json`），并随分析结果写入 IndexedDB，在详情页「证据后再次召回」面板展示供排查。Evidence Packet 按真实时间窗 overlap 计算评论与 trace 是否重叠（而非仅检查字段是否存在）。离线评测额外输出 `eval-set-coverage.{json,md}`，报告人工真值数量和覆盖比例，实现二段式 RAG 评测集覆盖闭环。证据校准及审计只辅助解释和人工复核，保持 advisory / non-blocking，不改变 Jira 回填边界。

#### 台架 / 实车场景

处理前按标题判定场景（「台架」→台架问题，「实车」→实车问题）。few-shot 与历史错误模式只从同场景历史样本召回；Step 5 注入 `<问题场景>` 结论口径（台架：请测试确认是否模拟信号上报；实车：vehicle 通路正常，请按需求确认原因并转对应模块分析）；最终结论开头加 `【台架问题】` / `【实车问题】` 后再保存与回填。未标注场景的票流程不变。

### 3.5.1 黄金样本基线

黄金样本基线用于同时衡量分析票准确率和处理速度。每次处理完成或失败时，服务端都会写入 `pipeline-metrics.json`，记录 `durationMs`、各阶段耗时、`evidenceCompleteness`、`evidenceScore` 和最终状态。

运行 `npm run baseline:golden` 会递归扫描 `log/**/pipeline-metrics.json`，输出：

- `docs/golden-baseline/golden-baseline.json`：机器可读报告，供后续回归脚本比较；
- `docs/golden-baseline/golden-baseline.md`：人工审阅报告，展示样本数、平均耗时、P50/P90、证据完整性和样本列表。

该脚本不重新分析 Jira 票，不调用 Qwen，只基于已有处理日志生成基线。

### 3.5.2 离线准确率评测

`npm run eval:accuracy` 会回放 `log/` 下已有票据产物，读取与在线 U3 相同的五类具名证据源，复用 `computeGrounding()` 计算平均证据接地率 EGR，并生成 `docs/golden-baseline/eval-report.json` 与 `eval-report.md`。缺失、读取失败和解析错误会随票进入来源审计；`unknown_missing_evidence` 票单独计数，不纳入 EGR 均值。当 `docs/golden-baseline/eval-set.json` 中维护了人工稀疏真值时，报告会额外输出信号召回率与结论关键判断命中率。Phase 2 报告会额外输出 `errorCategories`、`riskFlags`、`topMissingEvidence` 和 `categoryCounts`，用于定位信号缺失、时间窗不匹配、日志证据缺失、未接地结论、RAG 不匹配和低置信度证据等错误类型。EGR 只表示结论断言的证据接地率，不等同于端到端解票准确率；模型、Prompt、信号映射或证据自批判逻辑改动后，应重跑该命令对比 delta。

### 3.5.3 Step 2 配置归一化规则

- `step2_signals.md` 中的 token 不直接用于 proto 映射，必须先在当前车型 `config_车型.json` 中查找。
- 命中顺序为：`prop` 精确匹配、`getSignals` 精确匹配、`setSignals` 精确匹配。
- 命中后统一收敛到配置项的 `prop`，后续十进制 / 十六进制 id 只从该 `prop` 去 `.proto` 的 `Property_ID` 枚举映射。
- 未在配置中出现且无法通过受限补救确认的 token 只进入 `signals.json.unmatched`，避免把 AI 幻觉信号带入后续日志筛选链路。

### 3.5.4 日志筛选时间窗规则

- Step 4 的 Android/QNX 日志提取优先使用上层评论中的时间信息，而不是 CAN trace 录制时间。
- Step 4 仅在 Android/QNX 按信号 Property ID 与时间窗真实命中时调用；Property ID 在车型 `.proto` 缺失时回退 `type.h`。
- 无 CAN trace 时 Step 5 采用混合兜底：Step3/Step4 为「空」等占位输出且无日志命中 → 固定「缺 CAN trace 补件」结论；有有效证据 → 摘要提示词生成结论并标注置信度低、附补件提示。
- 若评论中存在 `YYYY-MM-DD HH:MM:SS` 形式的完整时间戳，则取评论里的最早 / 最晚时间作为筛选时间窗。
- 若评论中只有“问题发生时间 09:58”或“时间点13:52:22附近”这类时间点，则结合 trace 日期补全年月日，并默认向后扩展 5 分钟作为时间窗。
- 只有在评论中完全提取不到时间时，才回退到 CAN trace 录制开始 / 结束时间。

### 3.6 异常处理

| 异常场景 | 处理方式 | UI 反馈 |
|----------|----------|---------|
| 已有活跃处理任务 | 返回 409 | Toast 提示用户等待 |
| 附件下载失败 | status = FAILED，阶段停留在 DOWNLOADING | Card 显示错误 + 重试 Button |
| ZIP/嵌套归档解压错误 | 状态停留在 UNPACKING | Toast 显示详细异常 |
| CAN 解析失败 | 状态停留在 PARSING | 可能为不支持的协议格式 |
| Qwen API 超时/限流 | 状态停留在 MODEL_INFERENCE | Toast 提示，支持重试 |
| 波形图生成失败 | 结果仍保存，图片字段为 null | 不阻断流程，图片区域显示占位 |

---

## 4. AI 复核流程

### 4.1 触发条件

用户可在单票详情页的处理结果区域点击 **"AI 复核"** Button。

### 4.2 前置条件

- `IssueProcessResult` 已存在（处理任务已成功完成）。
- `.env` 已配置 `VALIDATE_QWEN_MODEL` 和 `VALIDATE_API_KEY`。

### 4.3 流程步骤

```
用户点击"AI 复核"Button
      │
      ▼
[React] POST /api/issues/review
      │     发送 replyText、Issue 摘要、ruleGroupId、ruleGroupName、
      │     Jira 描述/评论/原始快照、CAN 信号摘要和 Few-shot 样本
      ▼
[Store] 从 IndexedDB 查询同规则组 IssueReviewSample，并通过 Embedding RAG 召回最相似的 3 条
      │     召回文本优先使用标题 + 规则组 + 车型 + prop/signal/Property ID evidence fingerprint
      │     台架/实车票只用同场景（标题含「台架」/「实车」）样本；未标注场景不限
      │     Embedding 失败时回退标题 Token 重叠度
      │
      ▼
[API Route] 读取服务端分析日志：
       log/<规则组>/<车型>/<IssueKey>/step1_requirements.md
       + step2_signals.md / signals.json / signals_id.json
       + step3_upper_summary.md / step4_android_qnx*.md
       + extract.md / final_reply.md / pipeline.log
      │
      ▼
[API Route] 构建完整分析上下文 Prompt：
       System Prompt（验证角色定义）
       + 历史错例（≤3 条 Few-shot 样本）
       + Jira 描述、评论、原始快照
       + CAN 信号摘要
       + 服务端分析日志
       + 当前 AI 结论（replyText）
      │
      ▼
[API Route] 使用 VALIDATE_QWEN_MODEL + VALIDATE_API_KEY 调用验证模型
       返回 JSON：
       {
         "verdict": "PASS" | "FAIL",
         "reason": "..."
       }
      │
      ▼
[Store] 根据返回值保存复核结果到 IndexedDB
      │
[Store] AI 复核只保存建议状态，不创建人工复核样本
      │
      ▼
[Store] 更新最新 reviewStatus
[React] Card 状态徽标更新（绿色 PASS / 红色 FAIL）
```

### 4.4 后置条件

- `IssueProcessResult.reviewStatus` 更新为 `PASS` 或 `FAIL`。
- AI 复核不创建 `IssueReviewSample`；样本只由后续人工通过或人工驳回生成。

### 4.5 异常处理

| 异常场景 | 处理方式 | UI 反馈 |
|----------|----------|---------|
| Qwen 返回非法 JSON | Zod 校验失败，reviewStatus 保持 PENDING | Toast 提示重试 |
| Qwen API 不可用 | 返回 503 | Toast 提示服务不可用 |
| 历史错例不足 3 条 | 正常运行，Few-shot 样本数量动态调整 | 无影响 |

---

## 5. 人工复核流程

### 5.1 触发条件

用户在处理结果 Card 中点击 **"人工通过"** 或 **"人工改判"** Button。

"人工改判"会弹出 Dialog 表单，包含两个可编辑文本框：

- 失败理由（必填）
- 正确结论（必填）

### 5.2 流程 A：人工复核通过（PASS）

```
用户在 Dialog 中选择 Select: "通过"，点击 Button "提交"
      │
      ▼
[React] 调用来源 Store 的 approveResult
      ▼
[Store] 在同一 IndexedDB 事务中更新当前结果为 approved
      │
      ▼
[Store] 按当前结果 reviewEvidence 构造 sampleKind=approved
        保存 approvedConclusion，清空纠错字段与旧 Embedding
        同一 ruleGroupId + issueKey 的旧样本被覆盖，重复记录被删除
      │
      ▼
[Store] 清理该票旧纠错 LearningMemory 并更新页面状态
[React] Dialog 关闭，Card 状态更新为"已通过"
```

### 5.3 流程 B：人工改判不通过（FAIL）

```
用户在 Dialog 中填写：
  Textarea: errorReason（失败理由）
  Textarea: correctResult（正确结论）
点击 Button "提交"
      │
      ▼
[React] 调用来源 Store 的 rejectResult(errorReason, correctResult)
      ▼
[Store] 在同一 IndexedDB 事务中更新 ProcessResult：
       reviewStatus = 'FAIL'
       manualErrorReason = errorReason
       manualCorrectResult = correctResult
       reviewedAt = new Date()
      │
      ▼
[Store] 更新或创建 sampleKind=correction：
        wrongConclusion + correctConclusion + errorReason
        + 当前 run 的车型/prop/signal token/Property ID
        清除旧 Embedding，并删除同票重复样本
      │
      ▼
[后续 AI 分析] Embedding/标题召回后按车型和结构化证据混合排序；
             当前 Evidence Packet 再次重排并过滤无证据关联的正样本
             Step 5 分别注入历史纠错案例与历史正确案例
      │
      ▼
[Store] 更新复核状态
[React] Dialog 关闭，Card 状态更新为"已拒绝 + 已修正"
```

### 5.4 Dialog 表单组件结构

```typescript
// ManualReviewDialog.tsx
<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline">人工复核</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>人工复核</DialogTitle>
    </DialogHeader>
    <div className="space-y-4">
      <Select onValueChange={setReviewStatus}>
        <SelectTrigger><SelectValue placeholder="选择复核结果" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="PASS">通过</SelectItem>
          <SelectItem value="FAIL">不通过</SelectItem>
        </SelectContent>
      </Select>
      {reviewStatus === 'FAIL' && (
        <>
          <Textarea placeholder="错误原因" value={errorReason} onChange={...} />
          <Textarea placeholder="正确结论" value={correctResult} onChange={...} />
        </>
      )}
    </div>
    <DialogFooter>
      <Button variant="ghost" onClick={onClose}>取消</Button>
      <Button onClick={handleSubmit}>提交</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### 5.5 后置条件

| 情形 | 后置状态 |
|------|----------|
| PASS | `reviewStatus = 'PASS'`，同票样本覆盖为 `approved`，旧纠错记忆清除 |
| FAIL | `reviewStatus = 'FAIL'`，同票样本覆盖为 `correction`，`LearningMemory` 更新 |

### 5.6 异常处理

| 异常场景 | 处理方式 | UI 反馈 |
|----------|----------|---------|
| correctResult 为空而状态为 FAIL | Zod 校验拦截 | Dialog 内 Input 标红 + 错误提示 |
| IndexedDB 写入失败 | 记录错误日志 | Toast 提示"保存失败，请重试" |

---

## 6. Jira 回填流程

### 6.1 触发条件

用户在处理结果 Card 中点击 **"回填 Jira"** Button。

### 6.2 前置检查（决策门）

```
[API Route] 检查 hasCommentedToJira === true？
      ├─ 是 ──► 返回 200（幂等，Button 已置灰，直接结束）
      └─ 否
            │
            ▼
      [API Route] 检查 reviewStatus === 'PENDING'？
            ├─ 是 ──► 返回 409（尚未复核，拒绝回填）
            └─ 否
                  │
                  ▼
            [API Route] 检查 reviewStatus === 'FAIL' 且 manualCorrectResult 为空？
                  ├─ 是 ──► 返回 409（FAIL 必须提供人工正确结论）
                  └─ 否 ──► 继续执行回填
```

### 6.3 流程步骤

```
[React] 打开回填预览：
       已通过状态默认从 replyText 提取结论正文，已拒绝状态默认使用人工填写的正确结论
       用户可编辑 Jira 评论正文
      │
      ▼
[Zustand] commentToJira()
      │     POST /api/jira/comment
      ▼
[API Route] 接收 issueKey 和编辑后的评论正文
      │
      ▼
[API Route] 若用户已在详情页锁定当前视口，/api/issues/save-screenshot 已将浏览器合成图覆盖到 chartImagePath 对应的 log/.../can_signals.png
      │
      ▼
[API Route] fetch jiraClient.addComment(issueKey, content)
       如存在 chartImagePath → 上传对应 log/.../can_signals.png 作为波形图附件
      │
      ▼
[API Route] IndexedDB 标记 hasCommentedToJira = true, commentedAt = new Date()
      │
      ▼
[Store] 更新回填状态
[React] Button 切换为 disabled + "已回填"文案
```

### 6.4 后置条件

- `IssueProcessResult.hasCommentedToJira = true`。
- Jira 票中存在对应的分析评论（含波形图附件，如有）。若用户先锁定浏览器视口，则附件为锁定后的前端合成图，而不是处理阶段最初生成的静态图。

### 6.5 异常处理

| 异常场景 | 处理方式 | UI 反馈 |
|----------|----------|---------|
| Jira API 写入失败 | 返回 502，hasCommentedToJira 保持 false | Toast "回填失败"，Button 可重试 |
| 评论内容为空 | 前端拦截，API 仍保留参数校验 | 前端提示"回填内容不能为空" |
| 附件上传失败 | 评论正文仍写入，图片失败单独记录 | Toast 警告"图片上传失败" |

---

## 7. AI 校验流程

### 7.1 触发条件

用户在处理结果 Card 中点击 **"开始校验"** Button；处理结果保存后也会自动运行 advisory 结构化证据校验。

### 7.2 前置条件

- `IssueProcessResult` 已存在，且含 `replyText` 和可选 `signalSummary`。

### 7.3 流程步骤

```
用户点击"开始校验"Button
      │
      ▼
[React] POST /api/process-results/{id}/validation-runs
      │     useMutation → onSuccess: router.push(...)
      ▼
[API Route] IndexedDB 创建 IssueValidationRun（status: 'PENDING'）
      │
      ▼
[React] Router.push(`/validation-runs/${validationRunId}`)（跳转详情页）
      │
      ▼
[异步 Promise] 执行校验逻辑：
       ① 从 IssueProcessResult.replyText 抽取信号值、时间窗、复现判断等结构化断言
       ② 与 signalSummary / CAN trace 摘要 / 上层日志证据逐项比对
       ③ 保留旧时间戳一致性校验作为兜底
       ④ 计算 systemVerdict：PASS / WARNING / FAIL / UNKNOWN
       ⑤ 保存 IssueValidationRun + IssueValidationCheck 到 IndexedDB
       ⑥ 每条 IssueValidationCheck 可包含 evidenceSource 和 confidence
      │
      ▼
[React Query] refetchInterval: 2000ms 轮询
      │     GET /api/validation-runs/{validationRunId}
      ▼
[React] status === 'DONE' → 停止轮询 → 渲染结果
       使用 Card 展示 systemVerdict
       使用 ScrollArea 展示比对明细表、证据来源和置信度
       FAIL / WARNING 只提示人工复核注意，不禁用 Jira 回填入口
```

### 7.4 裁决规则

| systemVerdict | 含义 | UI 表现 |
|---------------|------|---------|
| `PASS` | AI 结论中引用的所有关键时间戳与 CANtrace 数据吻合 | 绿色 Badge |
| `WARNING` | 存在轻微偏差（如时钟漂移），整体结论仍可信 | 黄色 Badge |
| `FAIL` | 关键时间戳严重不匹配，AI 结论存疑 | 红色 Badge |
| `UNKNOWN` | 无法从 replyText 提取足够时间戳进行比对 | 灰色 Badge |

### 7.5 异常处理

| 异常场景 | 处理方式 | UI 反馈 |
|----------|----------|---------|
| rawSignals 为空 | systemVerdict = UNKNOWN | Card 显示"无可校验数据" |
| replyText 无时间戳 | systemVerdict = UNKNOWN | 提示"AI 结论中未包含时间信息" |
| 校验过程中抛出异常 | IssueValidationRun.status = FAILED | Toast 错误提示 |

---

## 8. 人工改判流程

### 8.1 触发条件

用户在校验详情页对 AI 校验结果有异议，点击 **"改判"** Button 弹出 **Dialog 表单**。

### 8.2 流程步骤

```
用户点击"改判"Button → Dialog 弹出
用户在 Dialog 中填写：
  Select: manualVerdict = PASS | FAIL | WARNING | UNKNOWN
  Textarea: manualReason = "改判原因"
  Textarea: manualNote = "补充说明"（可选）
点击 Button "确认改判"
      │
      ▼
[React] PATCH /api/validation-runs/{id}/override
      │     useMutation
      ▼
[API Route] Zod 校验请求体
[API Route] 更新 IndexedDB IssueValidationRun：
       manualVerdict    = 用户输入
       manualReason     = 用户输入
       manualNote       = 用户输入
       manualOperator   = 当前用户名
       manualSavedAt    = new Date()
      │
      ▼
[React] Dialog 关闭
[React] 详情页同时显示 systemVerdict 与 manualVerdict 对比 Card
```

### 8.3 Dialog 表单组件结构

```typescript
// OverrideVerdictDialog.tsx
<Dialog>
  <DialogTrigger asChild>
    <Button variant="destructive">改判</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>人工改判</DialogTitle>
    </DialogHeader>
    <div className="space-y-4">
      <Select onValueChange={setManualVerdict}>
        <SelectTrigger><SelectValue placeholder="选择改判结果" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="PASS">PASS</SelectItem>
          <SelectItem value="FAIL">FAIL</SelectItem>
          <SelectItem value="WARNING">WARNING</SelectItem>
          <SelectItem value="UNKNOWN">UNKNOWN</SelectItem>
        </SelectContent>
      </Select>
      <Textarea placeholder="改判原因（必填）" value={manualReason} onChange={...} />
      <Textarea placeholder="补充说明（选填）" value={manualNote} onChange={...} />
    </div>
    <DialogFooter>
      <Button variant="ghost" onClick={onClose}>取消</Button>
      <Button variant="destructive" onClick={handleSubmit}>确认改判</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### 8.4 后置条件

- `IssueValidationRun` 中同时保留 `systemVerdict`（AI 原判）和 `manualVerdict`（人工改判），便于追溯。

### 8.5 异常处理

| 异常场景 | 处理方式 | UI 反馈 |
|----------|----------|---------|
| manualVerdict 为空 | Zod 校验拦截 | Select 标红提示 |
| manualReason 为空 | Zod 校验拦截 | Textarea 标红提示 |
| 并发改判冲突 | Last-Write-Wins（单用户场景） | — |

---

## 9. 自动周期运行流程

### 9.1 触发条件

用户在首页规则组行点击 **"自动 ON/OFF"** 控件，并设置该规则组的周期间隔（分钟）。

### 9.2 启动步骤

```
用户开启某个规则组 AutoCycle
      │
      ▼
[Zustand] useAutoCycleStore.toggleAutoCycle(ruleGroupId, true)
      │
      ▼
[IndexedDB] 写入 AutoCycleState：
       isActive = true
       nextRunAt = new Date()
       intervalMinutes = N（最小 5 分钟）
      │
      ▼
[React] KanbanBoard 本地 setInterval 调度器恢复运行
[React] 规则组行显示"自动ON"和间隔
```

### 9.3 本地定时执行（每 30 秒检查一次 runDueAutoCycles）

```
KanbanBoard setInterval 触发 runDueAutoCycles()
      │
      ▼
[步骤 A] 遍历已启用 AutoCycle 的规则组
         跳过 nextRunAt 未到达或当前已有本地运行锁的规则组
      │
      ▼
[步骤 B] runUnifiedFilter(group)
         并发筛选 Jira 与飞书项目，保存各自本轮状态、快照或分配，并返回来源汇总
      │
      ▼
[步骤 C] 仅依据当次来源汇总决定处理范围
         Jira 使用当次最新成功快照；当次飞书筛选成功时，处理该规则组当前全部 pending / failed 分配（含人工分配）
         Jira 成功、飞书失败时仅处理 Jira，不派发飞书处理，也不读取飞书历史成功结果
      │
      ▼
[步骤 D] processRuleGroup(group, sourceSummary)
         按来源处理 Jira 快照和飞书项目分配
      │
      ▼
[步骤 E] markAutoCycleRun(ruleGroupId)
         更新 lastRunAt 和 nextRunAt = Date.now() + N * 60000
```

### 9.4 停止流程

```
用户点击"自动ON"切换为关闭
      │
      ▼
[Zustand] useAutoCycleStore.toggleAutoCycle(ruleGroupId, false)
      │
      ▼
[IndexedDB] 更新 AutoCycleState.isActive = false
[React] 规则组行显示"自动OFF"
```

### 9.5 飞书通知规则

- 每张 Jira 或飞书项目工单处理完成后立即发送 1 条飞书通知。
- Jira `runOne()` 与 Meegle `processAssignment()` 的成功分支发送成功通知；失败分支发送失败通知。
- 通知内容包含来源、工单主题、描述、处理结果或失败原因，以及处理时间。
- 若存在结果图片，当前版本在 webhook-only 模式下附带图片访问链接，不直接上传本地图片。

### 9.6 异常处理

| 异常场景 | 处理方式 | UI 反馈 |
|----------|----------|---------|
| 页面关闭后重新打开 | IndexedDB 中 isActive 保持 true，首页加载后恢复本地调度器 | 自动恢复 |
| 飞书 Webhook 不可用 | 记录 console warning，不影响当前票处理完成/失败落库 | 无直接 UI 反馈 |
| 批量创建筛票任务部分失败 | 失败的规则组记录错误，其余正常 | 页面展示错误详情 |

---

## 10. 一键筛选 / 一键处理流程

### 10.1 一键筛选

**触发**：用户点击首页 **"一键筛选"** Button。

```
[React] Promise.allSettled 为所有规则组并发调用筛票 API
      │     使用 p-limit 控制并发数
      ▼
[API Routes] 对每个规则组执行筛票流程（参见第 2 节）
       已有运行中任务的规则组 → 跳过（返回 409，前端静默忽略）
       其余规则组            → 正常创建 FilterTask
      │
      ▼
[React] 汇总展示各规则组筛票任务状态
       使用 Toast 显示"N 个规则组已启动筛票，M 个跳过"
```

### 10.2 一键处理

**触发**：用户点击首页 **"一键处理"** Button。

```
[React] 检查该规则组最新 FilterTask
      │
      ├─ 没有完成过筛票 ──► Button disabled
      │
      ├─ 最新筛票结果为 0 票 ──► Button disabled
      │
      └─ 最新筛票结果 > 0
      │
      ▼
[React] 读取该规则组最新一次成功筛票生成的快照
       逐张调用 runOne() / runAll()
       为每张尚无活跃处理任务的票创建 IssueProcessTask
      │
      ▼
[React] 通过 pLimit(CONCURRENCY_LIMIT) 有界并发处理（默认 5，可用 NEXT_PUBLIC_CONCURRENCY_LIMIT 调整），避免同时压垮分析链路
[UI]   详情页 / 分析页逐票更新处理状态
```

---

## 11. Jira 状态流转流程

### 11.1 触发条件

用户在处理结果 Card 或规则组详情页点击"状态流转"Button，弹出 Dialog。

### 11.2 流程步骤

```
用户点击"状态流转"Button
      │
      ▼
[React] GET 可用状态流转与相关人员候选
      │     GET /api/rule-groups/{id}/processed-issues/{issueKey}/transition
      ▼
[API Route] fetch Jira transitions
      │     GET /rest/api/2/issue/{issueKey}/transitions
[API Route] fetch Jira issue detail/watchers
      │     GET /rest/api/2/issue/{issueKey}?fields=*all
      │     GET /rest/api/2/issue/{issueKey}/watchers
      ▼
[React] Dialog 展示 transition 列表和相关人员候选
      │
      ▼
用户在 Dialog 中：
  Select 选择目标状态（transitionId）
  Select 选择指派人（targetUser，可选，默认不变更经办人）
点击 Button "执行流转"
      │
      ▼
[React] POST /api/rule-groups/{id}/processed-issues/{issueKey}/transition
      │     Body: { transitionId, targetUser }
      ▼
[API Route] fetch jiraClient.transitionIssue(issueKey, transitionId)
[API Route] 若 targetUser 非空，fetch jiraClient.assignIssue(issueKey, targetUser)
      │
      ▼
[React] Dialog 关闭，Toast "状态流转成功"
[React] 使用 Jira transition 的目标状态刷新当前票据状态显示
```

### 11.3 注意事项

- `transitionId` 必须与目标 Jira 项目的工作流定义一致，否则 Jira API 返回 400。
- 前端不硬编码 transition；每次打开弹窗时读取当前票据的可用状态流转。
- 前端不手写 Jira 用户名；指派人从当前 Jira 票的经办人、报告人、创建人、评论作者、关注人和用户型字段中去重生成。
- `targetUser` 为空时不调用 Jira 指派接口。
- 状态流转与系统内部状态（`reviewStatus` 等）相互独立，不联动。

---

## 12. 拖拽排序流程

### 12.1 触发条件

用户在首页长按 RuleGroupCard 进行拖拽排序。

### 12.2 流程步骤

```
用户拖拽 RuleGroupCard（dnd kit PointerSensor）
      │
      ▼
[dnd kit] closestCenter 碰撞检测 → 计算目标位置
      │
      ▼
[onDragEnd] 触发回调
      │
      ▼
[React] arrayMove(groups, oldIndex, newIndex)
[Zustand] 乐观更新 Store → RuleGroupList 重渲染
      │
      ▼
[IndexedDB] 批量更新 RuleGroup.sortOrder
      │
      ▼
[API Route] PUT /api/rule-groups/reorder { ids: [...] }
      │
      ├─ 成功 ──► 流程结束
      │
      └─ 失败 ──► Zustand 回滚排序 → Toast "排序保存失败"
```

### 12.3 关键点

- **乐观更新**：拖拽结束后立即更新 UI，不等待 API 响应。
- **双重持久化**：IndexedDB + API Route 同步。
- **无障碍**：dnd kit KeyboardSensor 支持键盘操作。

---

## 13. 业务决策点说明

| 决策点 | 位置 | 判断依据 | 结果 |
|--------|------|----------|------|
| 是否允许重复筛票 | 筛票流程 | 同规则组 10 分钟内是否有运行中任务 | 是→409，否→创建任务 |
| 是否允许重复处理 | 单票处理 | 是否存在 PENDING/RUNNING 的处理任务 | 是→409，否→创建任务 |
| 回填内容选择 | Jira 回填 | `reviewStatus` 是否为 FAIL | FAIL→`manualCorrectResult`，否→`replyText` |
| 是否允许回填 | Jira 回填 | `reviewStatus` 是否为 PENDING，或 FAIL 且无人工结论 | 不满足→409 |
| 幂等回填保护 | Jira 回填 | `hasCommentedToJira` | true→直接返回 200，Button disabled |
| AI 复核 Few-shot 来源 | AI 复核 | 同规则组 IndexedDB `IssueReviewSample`，优先 Embedding 语义检索，失败回退标题 Token 重叠度 | 动态注入 prompt |
| 人工复核 PASS 后清理 | 人工复核 | `reviewStatus = 'PASS'` | 删除错例 + 学习记忆 |
| 校验裁决 | AI 校验 | 时间戳匹配率 | PASS / WARNING / FAIL / UNKNOWN |
| 排序持久化 | 拖拽排序 | API 响应状态 | 成功→保持，失败→回滚 |

---

## 14. 远程终端连接流程

用户进入 `/terminal`，选择白名单服务器，确认风险等级和命令限制模式后建立 WebSocket。Gateway 用服务端配置的 SSH key 连接目标服务器。关闭标签或页面时 Gateway 断开对应 SSH。

本地开发应使用 `npm run dev:with-terminal` 同时启动 Next.js 和 Terminal Gateway。Gateway 会加载 `.env` 中的 `REMOTE_SHELL_TARGETS_JSON`；远程浏览器默认连接当前页面 hostname 的 `39222` 端口，如需代理或改端口，可设置 `NEXT_PUBLIC_REMOTE_SHELL_GATEWAY_URL`。

若终端显示 `SSH 认证失败` 或 `All configured authentication methods failed`，说明 Gateway 已到达 SSH 服务，但目标服务器拒绝了当前认证材料。需要在 `REMOTE_SHELL_TARGETS_JSON` 中更换为目标服务器已授权的 `privateKeyPath`，或配置 `password`、`privateKeyPassphrase`、`agentSocket`。这些字段只在服务端使用，不会通过 `/api/terminal/targets` 返回浏览器。

远程终端页面会额外读取 `/api/terminal/projects?target=<目标id>`，按 named_first 返回当前目标生效的项目配置（`docs/project_<目标名>.json` 优先，缺失回退 `docs/project.json`）。用户先选择服务器，再选择项目和分支；选中分支后，右侧显示该分支配置的各个 repo 的 git status。用户在终端中提交任意命令后，Gateway 会在短延迟后按当前项目上下文刷新每个 repo 的 `git status --short --branch`；点击“刷新”会立即刷新。服务端缺少配置时返回空列表并标记 `configMissing`，页面禁用切换分支与同步并提示导入。

选择项目时，前端向当前远程 shell 发送 `cd mainPath`，例如选择 `chery-8255` 会进入 `~/workspace`。选择分支时，前端按分支配置对每个 repo 发送 `git checkout branchName`，用于把 `vs`、`api-public`、`automotive-custom` 等仓库切到对应分支；若 checkout 失败，则执行 `git stash push -u` 保存本地改动后重新 checkout。点击“配信号”时，前端向当前远程 shell 发送 `cd mainPath/scriptPath`，便于后续直接运行脚本目录下的信号配置命令。

右侧 repo 状态分栏可拖拽调整宽度。状态内容保持 `git status --short --branch` 的原始行结构，并按分支行、未跟踪、新增、修改、删除、冲突等状态显示不同颜色，便于快速扫描。
针对 Repo 状态分栏中的文件，没有使用 `git add` 提交过的文件（未暂存或未跟踪文件）以及已经使用 `git add` 提交过的文件（已暂存文件）在行首都会展示复选框供勾选。
- **git add 操作流程**：用户勾选文件，点击 repo 区域底部的 `git add` 按钮。前端生成包含所选文件列表的 `gitAdd` WebSocket 消息。Gateway 拦截并执行 `cd repo && git add files` 的 SSH 命令，完成后自动清理勾选并刷新该 repo 的状态。
- **checkout 操作流程**：用户勾选文件，点击 `checkout` 按钮，弹出浏览器确认窗口提示风险。确认后前端生成 `gitCheckout` WebSocket 消息。Gateway 拦截并执行 `cd repo && git checkout -- files` 撤销对应文件修改，完成后自动清理勾选并刷新该 repo 的状态。
- **git reset 操作流程**：用户勾选已暂存文件，点击 repo 区域底部的 `git reset` 按钮。前端生成包含所选文件列表的 `gitReset` WebSocket 消息。Gateway 拦截并执行 `cd repo && git reset HEAD files` 的 SSH 命令撤销暂存，完成后自动清理勾选并刷新该 repo 的状态。

连接成功并选择项目/分支后，前端会通过 `signalConfigFiles` WebSocket 消息请求 Gateway 扫描每个 repo 的 `repoPath/tools/json/config_*.json`。右侧“配置文件”区域按 `config_*.json` 中的 `*` 展示复选框，并显示该 repo 对应的 `branchName`。配置复选框状态以 `repoPath + branchName` 隔离；`repoPath` 或 `branchName` 任意一个变化时，前端都会清空当前旧配置列表并重新请求 Gateway 扫描。复选框默认全部勾选表示保留。用户取消勾选不需要保留的配置文件后点击“配置”，前端发送 `checkoutSignalConfigFiles` 消息；Gateway 会校验路径必须匹配 `tools/json/config_*.json`，然后在对应 repo 下执行 `git checkout -- files`，完成后刷新 git 状态和配置文件列表。


项目操作按钮：

- 上传 xls：选择本地 `.xls/.xlsx` 后上传到远端 `mainPath/scriptPath/`。
- 上传 dbc：选择本地 `.dbc` 后上传到远端当前分支主 repo 的 `mainPath/repoPath/tools/sdb/`。
- 上传 mcu.h：选择本地 `.h` 后上传到远端当前分支主 repo 的 `mainPath/repoPath/tools/inc/`。
- 一键 checkout：对当前项目分支配置下所有 repo 顺序执行 `git checkout .`。
- 一键 pull：对当前项目分支配置下所有 repo 顺序执行 `git pull`。
- 配信号：远程 shell 切换到 `mainPath/scriptPath`。
- 配置：对未勾选的 `repoPath/tools/json/config_*.json` 执行受限 `git checkout --`。
- 打包：在远端 `mainPath/scriptPath` 下打包 `types.hal`、`VHAL_SIGNAL_CHECKLIST_s.xls`、`com.bosch.cm.platform.vehicle.proto`、`CHERY_8255_VHAL_SIGNAL_V*.xls` 为 zip，并通过浏览器下载到本地。
- 检验checklist：仅在远端 `mainPath/scriptPath` 下直接将 `VHAL_SIGNAL_CHECKLIST_s.xls` 文件通过 base64 形式传输，并通过浏览器下载到本地。

---

## 15. 自动化与手动操作边界

```
┌──────────────────────────────────────────────────────────────────┐
│                       操作边界示意图                              │
│                                                                  │
│  【人工触发 + 自动执行】           【纯手动操作】                  │
│  ┌─────────────────────┐          ┌─────────────────────┐        │
│  │ • 筛票（Button 触发，│          │ • 人工复核（Dialog   │        │
│  │   Promise 异步执行）  │          │   表单 PASS/FAIL）   │        │
│  │ • 单票处理（Button   │          │ • 人工改判（Dialog   │        │
│  │   触发，Qwen 自动）   │          │   覆盖 verdict）     │        │
│  │ • AI 复核（Button    │          │ • Jira 回填（确认    │        │
│  │   触发，Qwen 自动）   │          │   后 Button 触发）   │        │
│  │ • AI 校验（Button    │          │ • Jira 状态流转      │        │
│  │   触发，自动比对）    │          │   （Dialog 表单）     │        │
│  │ • 拖拽排序（dnd kit  │          └─────────────────────┘        │
│  │   交互，自动持久化）  │                                         │
│  └─────────────────────┘                                         │
│                                                                  │
│  【全自动（无需人工介入）】                                        │
│  ┌─────────────────────────────────────────────────────┐         │
│  │ • 自动周期运行（setInterval 筛票+处理+飞书通知）      │         │
│  │ • 一键筛选/处理后的异步任务执行                       │         │
│  │ • IssueReviewSample 自动归档（AI 复核 FAIL 时）       │         │
│  │ • LearningMemory 自动写入（人工复核 FAIL 时）          │         │
│  └─────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────┘
```

### 自动化操作清单

| 操作 | 触发方式 | 是否需要人工确认 | 技术实现 |
|------|----------|-----------------|---------|
| JQL 查询 + 建快照 | Button "筛票" / setInterval | 否 | API Route + Promise |
| Qwen 多轮推理分析 | Button "处理" / setInterval | 否 | API Route + Qwen API |
| AI 复核 + Few-shot 归档 | Button "AI 复核" | 否 | API Route + Qwen API |
| 飞书通知发送 | 处理任务完成后自动触发 | 否 | fetch Webhook |
| 学习记忆写入 | 人工复核标记 FAIL 后触发 | 否 | IndexedDB 写入 |
| Jira 评论写入 | Button "回填 Jira" | 是 | API Route + Jira REST |
| Jira 状态流转 | Dialog 表单确认 | 是 | API Route + Jira REST |
| 人工改判覆盖 | Dialog 表单确认 | 是 | API Route + IndexedDB |
| 拖拽排序持久化 | dnd kit onDragEnd | 否 | IndexedDB + API Route |
| 规则组后端管理 | `/api/rule-groups` / `/api/rule-groups/:id` / `/api/rule-groups/reorder` | 是 | 管理员权限 + `data/rule-groups.json` |
| API 文档查看 | 浏览器访问 `/api/docs` 或拉取 `/api/openapi` | 否 | Swagger UI + OpenAPI JSON |
| Geely2 专项结果查看 | 浏览器访问 `/geely2` 或 `/geely2/results/:id` | 否 | Client Component + IndexedDB |
| 用户登录 | `/login` 表单提交用户名/密码 | 是 | `/api/auth/login` + `docs/login.json` + httpOnly Cookie |

---

## 16. 登录与鉴权流程

```
用户访问受保护页面
      │
      ▼
[proxy.ts] 读取 jira_analyzer_session Cookie
      │
      ├─ 无有效 Token ──► 页面重定向 `/login?next=...`
      │                    业务 API 返回 401
      │
      └─ 有效 Token
            │
            ▼
      [proxy.ts] 按角色校验路径 / API 操作权限
            │
            ├─ 角色不足 ──► 页面 403 / API 403
            │
            └─ 允许访问
```

登录页 `/login` 调用 `/api/auth/login`，服务端从 `docs/login.json` 匹配用户名和密码并签发 Session Token。Token 写入 `jira_analyzer_session` httpOnly Cookie，前端仅把 Token 摘要写入 `localStorage` 作为客户端状态提示。`/api/auth/*`、`/api/openapi` 和 `/api/docs` 保持公开。

## 17. 规则组管理权限与后端 API

```
管理员登录
   │
   ├─ POST /api/rule-groups ───────► 创建规则组
   ├─ PUT /api/rule-groups/:id ────► 更新规则组
   ├─ DELETE /api/rule-groups/:id ─► 删除规则组
   └─ PUT /api/rule-groups/reorder ─► 更新排序
          │
          ▼
   lib/server/rule-groups.ts
          │
          ▼
   data/rule-groups.json
```

普通分析员可通过 `GET /api/rule-groups` 查看服务端规则组列表，但规则组创建、更新、删除、排序等写操作仅系统管理员可执行。首页本地工作态继续由 IndexedDB 管理；前端会根据 `/api/auth/session` 返回角色禁用非管理员的规则组新建、导入、编辑、删除、拖拽排序和 AutoCycle 配置入口。

*文档结束 | 技术栈：Next.js + React + TypeScript + shadcn/ui + IndexedDB + dnd kit + Qwen API*

## 18. Jira / 飞书项目共享 CAN 图表流程（v3.43）

1. `/api/issues/process` 解码 CAN trace，返回 `traceData`、`ticks`、`chartImage` 和 `signalSummary`。
2. Jira 结果写入 `issueProcessResults`，飞书结果写入 `meegleProcessResults`，两者都持久化完整图表数据。
3. 两类详情页把结果传给 `CanSignalChart`，有 `traceData` 时显示交互式 Chart.js 散点图，无数据时显示静态 PNG。
4. 用户缩放任一信号时，其余信号同步 X 轴；点击“重置缩放”恢复完整时间窗。
5. 点击“锁定当前视口为回填图”后，共享组件合并所有 Canvas，并通过 `/api/issues/save-screenshot` 覆盖对应 `can_signals.png`。

### 自动周期与数据管理验收边界

1. 管理员在规则组卡片开启自动周期并设置间隔。保留登录和打开的浏览器；最短 5 分钟。观察本轮执行、下次时间和错误提示。关闭时仅已启动任务继续完成。
2. 数据管理先导出本地 JSON；导入文件后查看转换预览，再选择补齐缺失 ID 或替换同 ID。未包含的记录不删除。
3. 同源旧库迁移先预览后确认，不修改源库；不同源使用旧系统 JSON。服务端镜像恢复先完整读取再原子写库。
4. MySQL 旧库仅管理员可预检与执行，预检不写库。执行失败时保留报告，可重复合并续迁；不将部分批次成功描述为全库原子成功。
5. 自动测试使用隔离 IndexedDB 和 mock 网络，不在验收中迁移真实旧库或覆盖当前账号镜像。

### 数据标注工作台使用流程

1. 打开「数据标注」，按来源、标注状态、原复核状态、场景及票号/标题筛选当前账号镜像。列表为空时可调整筛选，或从数据管理同步分析结果；服务端未配置时显示错误及重试。
2. 选择条目，核对原分析结论、信号摘要和复核信息；需要时主动应用预填建议，建议本身不会保存。
3. 复核员选择判定、错误类型、用途、正确结论与难度。部分正确/错误必选错误类型；负例及错误样本真值必填正确结论；「其他」必填备注；排除与其他用途互斥。
4. 保存后显示版本、标注人和更新时间。失败保留编辑，修正后重试。撤销需要确认，失败不移除已有标注。
5. 未保存时切换或普通站内链接离开需要确认；明确放弃会清除暂存。浏览器历史返回后重新选择原条目可恢复同标签页草稿，服务器基线变化时不恢复。
6. 导出 JSONL 获取当前账号全部有效标注；列表筛选不限定导出范围。无需在界面手动拼接或复制 JSON，导出失败不会下载错误响应。

### API 文档联调

侧栏「API 文档」打开 `/api/docs`，静态资源与规格均同源提供。先通过当前平台登录，再按接口所需角色联调。文档页面不会自动调用分析、迁移、标注或外部写接口；JSON规格可从 `/api/openapi` 获取。登录Cookie与Jira/飞书/模型的服务端凭据是不同边界，不在Swagger中填写服务端密钥。

### 远程终端工作台验收流程

1. 任意已登录用户进入「远程终端」，选择脱敏白名单目标并确认连接。Gateway 按平台 Cookie 校验登录态（非管理员同样可连接与同步）；未登录访问页面重定向，API 返回 401。每个终端标签可导入/导出 `project.json`：管理员导入覆盖 `docs/project.json`，其它用户写入 `docs/project_<目标名>.json`（覆盖前备份到 `docs/bak/`）；服务端缺少配置时切换分支与同步禁用，提示先导入。
2. 每标签独立选择项目与分支。项目切换只进入目录；分支切换确认后对配置仓库执行带stash回退的checkout。配信号进入脚本目录，一键pull与checkout作用于当前分支配置；全量checkout需确认。
3. Repo面板多选文件后执行add/reset，撤销工作区文件需确认，未跟踪文件会删除。配置扫描默认全选保留；取消勾选再点「配置」只恢复未选文件，按仓库路径和分支绑定。
4. 三类上传分别进入脚本目录、主repo的tools/sdb与tools/inc；上传文件读取完成后再次检查标签连接与项目上下文。打包zip与清单下载只接受当前请求的返回内容。
5. 配置、认证或操作失败显示中文原因，可重新加载、重试或重新连接。切换标签不重复连接；关闭标签只关闭该会话。20 秒连接超时关闭连接；只读扫描/状态查询 30 秒超时保留终端并取消排队操作，可手动刷新重试；有副作用的操作 30 秒超时关闭连接，重试前核对实际远端状态。
6. 本轮浏览器用模拟HTTP/WebSocket验证以上流程，不连接真实SSH；Gateway测试使用假channel，Git pathspec回归只使用临时独立Git仓库，不操作用户仓库。业务分析服务不用于测试构建或重启。

### 指定 Jira 票号直接分析

1. 首页选择默认或Bosch Jira并输入票号，点击「分析指定工单」或按Enter。系统去首尾空白并转大写，拒绝非法票号，不将用户输入直接拼成任意JQL。
2. 只查询所选站点并核对返回票号；不存在、无权限、标题缺车型或无匹配组时显示中文原因，不创建任务。
3. 将标题括号车型匹配该站点全部规则组，逐组执行统一分析。分析配置在等待期间改变则显示「未启动」，重新提交时重新查询与匹配；来源失败不会自动尝试另一个站点。
4. 查看逐组实际任务状态及详情；再次提交会重跑并保留历史。不会替换规则组最近一次批量筛票数据。
5. 刷新首页后从「最近单票分析」打开已保存任务，详情链接包含站点；无需先重新分析。保存/刷新与默认/Bosch同名票隔离均使用隔离浏览器验证。

单票分析后的AI复核沿用该结果服务端确认的运行身份。缺失原运行产物时明确失败，不改用其他站点或旧运行证据；旧结果没有run身份时保留旧接口兼容。人工复核与回填仍是既有流程，本轮验收不调用真实Jira、模型或外部写回。

## 当前统计页验收（2026-10-28）

从导航打开 `/statistics`，查询年份和月份后查看本地结果；不同项目或类型的同号飞书工作项分别计票，刷新后重读 IndexedDB。切换「团队（服务器）」使用同一已查询范围读取成员镜像合计；失败时可重试，不能复制旧报告。成功后复制 Markdown 报告包含来源汇总和团队成员明细。上下文缺失的旧数据无法凭空恢复项目或类型，身份回退边界见产品文档。

## 当前团队模板库验收（2026-10-28）

1. 打开 `/templates`，选择本地规则组，填写模板名称、说明、标签，发布到团队库或下载 JSON 文件。模板中不携带规则组 ID、排序或票据数据。
2. 通过名称、作者或标签搜索，下载团队模板。管理员应用后创建带版本名的新规则组；刷新首页后卡片及配置保留。计数接口失败不重复建组。
3. 团队库暂不可用时仍可从文件应用；损坏的车型配置显示错误且不创建规则组，旧车型文件格式自动规范化。
4. 作者或管理员确认删除全部模板版本；失败留在确认框，可直接重试；已经应用的本地规则组保留。普通成员无法应用模板或删除他人模板。

浏览器使用隔离 IndexedDB 与 mock 团队 API；现有 MySQL 集成测试仅写唯一临时模板并清理，不能作为真实用户模板验收。

## 当前智能助手完整流程（2026-10-28）

1. 打开「智能助手」，在知识库上传文本文件或导入本地分析/历史/人工标注；重复导入覆盖同一文档，失败向量化使用关键词检索。
2. 在笔记中新建 Markdown、设置标签和置顶，编辑后可载入历史版本再保存；归档会移出对话检索，取消归档重建分片。若提示原笔记已修改/删除，保留草稿并先核对最新记录，不能覆盖他人已保存的修改。
3. 在记忆中手动添加、置顶、删除；自动抽取按新增/更新/忽略处理，过期低重要度记忆自动遗忘，置顶除外。
4. 提问时最多检索 4 段文档/笔记和 5 条记忆，完整回答保留引用。关闭重开仍可观察或停止当前运行；部分流或停止不保存成功助手回复。
5. 清空对话须确认，只删除当前账号消息；文档、笔记和记忆各自确认删除，不删除原分析数据。切换账号与刷新均从统一 IndexedDB 读取，不能显示其他账号资料。

本轮外部模型、向量及记忆接口全部 mock；服务测试用隔离 fake-indexeddb，未向真实模型发送私人知识。

## 当前运维命令流程（2026-10-28）

- 附件下载先用 npm run jira:attachments -- --help 查看参数；带 --dry-run 只查询附件列表，正式下载按筛选、重名、跳过或覆盖规则写指定目录。
- npm run cleanup:data -- --dry-run 查看过期文件数量；确认范围后去掉预览参数才删除，保留 Docupedia 月度统计。
- npm run baseline:golden、eval:coverage、eval:accuracy 读取当前工作目录的本地日志，生成 docs/golden-baseline 报告，不发起模型调用。评测集可缺省；缺证据的票不伪造准确率。
- npm run eval:export-truth -- --owner admin --dry-run 预览当前新库人工样本的导出统计；去掉预览参数才合并本地评测集，MySQL 保持只读，手写条目优先。
- python3 scripts/replay_cantrace.py --help 提供独立离线文件回放；--json-only 仅输出数据与摘要，其他参数保留原版信号/DBC/Proto/输出目录能力。

验证全部使用临时目录、本地 HTTPS 假 Jira、模拟镜像行与离线 CAN 样例，未清理真实日志、下载真实附件或导出用户样本。

## 模板并发发布处理（2026-10-28）

1. 服务端先校验模板文件和配置，再按数据库排序身份进入门禁。不同浏览器或进程提交同配置时，一次创建新版本，其余返回该版本。
2. 获得门禁后核对原作者，分配版本，写入并回读同一版本；管理员更新仍保留原作者。删除与迁移写入在同一门禁中执行。
3. 锁等待超时显示「该模板正在更新，请稍后重试」，状态码503，未创建模板；客户端保留填写内容。删除失败继续保留确认框。
4. 旧数据存在不同版本删除状态时，重新发布创建下一个版本，不能错误返回更旧配置。已删除版本保持删除，已应用规则组不受影响。

验证使用唯一vitest-concurrent-*临时模板和两个独立Node进程，在全部并发任务结束后清理测试记录；没有修改用户已有模板，也没有执行真实旧库迁移。

### 终端稳定性验收（2026-10-28）

1. 连接后自动扫描配置与 Git 状态；确认首屏提示符可见，查询失败仍可在终端输入命令。
2. 模拟配置扫描 30 秒无响应：显示中文超时提示、保留会话、清空排队操作；手动刷新成功后按钮恢复可用，旧响应不能覆盖新请求。
3. 本机隔离 ssh2 Server 验证真实 SSH 认证、PTY/exec 复用、exec 超时后继续查询与交互，不连接业务 SSH 或修改业务仓库。
4. 连续提交命令只触发合并刷新；关闭终端取消未开始的刷新并释放 SSH 操作通道。
5. 此次 Gateway 代码需随前端更新后生效；验证使用独立构建目录，不重启已有业务服务。

## 解压日志版本提取（2026-10-29）

1. 下载日志包后保留目录结构解压，并展开嵌套压缩包。
2. 收集证据时递归查找 Buildinfo，提取 MAIN_VERSION；解码同目录所有 Scc DLT，去重记录每个文件的 SCC 版本。
3. 写入本次运行 `log-versions.json`；将 SOC/SCC 及来源附加到 `extract.md` 和 `step4_android_qnx_input.md` 的 Android 筛选结果末尾，不受时间窗限制。
4. 模型沿用当前日志输入读取版本；版本缺失不阻断处理，也不构成信号日志证据。历史运行保持原样。

### VHAL 提取顺序（2026-10-29）

完成 SOC/SCC 提取后，读取当前规则组 Proto 根目录下的 `type.h`，解析 `VER_PRO_CFG` 并记录平台与版本。每次分析重新读取文件，从而保存该次分析采用的最新配置快照。将结果写入本次 `log-versions.json` 的 vhal 字段，并在 SOC/SCC 后追加到提取日志和模型输入；日志缺失时仍可保留配置版本。路径未配置或文件无效只记录状态与原因，继续分析。参考脚本默认目录不参与运行。

Android 日志筛选完成后，将同次提取、去重的 BoschVehicleHalHash 完整行保存到本次 `log-versions.json` 的 `boschVehicleHalHashLines` 数组；最多 20 行，缺失时为空。现有 Android 日志输入继续保留这些行。

## 远程终端同步流程（已实现，2026-10-29）

已登录用户登录并连接白名单SSH目标后点击同步，遍历当前目标生效的 project.json（named_first）全部项目、分支组及仓库；固定各本地 branchName 的最新 commit，通过 git log -10 逐条提取最近最多 10 条提交及完整 RTC1-数字标识，更新已有映射并保留历史，文件未变也执行。固定同一commit后递归收集tools/json、tools/sdb、tools/scripts下指定文件，直接以原文件名打平保存到configuration/<projectName>/<分支组名>/，不建立分类子目录。提交不变且完整则跳过，缺失补齐，变化替换托管快照并移除旧文件。无fetch/pull，无repoName目录层。同名异内容先备份再覆盖；type.h 按旧来源 commit、更新前 project.json 的 RTC 与旧文件 VER_PRO_CFG 归档为 bak/commitid_rtcids_vhal-version，保留多轮版本，相同内容不归档；其他文件备份允许同名覆盖。临时目录完整准备后按分支组发布文件与映射，失败保留旧快照。查看逐repo结果和最近一轮configuration/.sync-last.json；再次同步可重试或修复缺失文件。详细依赖及故障恢复见requirements/terminal-sync-review.md第11节。

### 查看当前同步分支的 VHAL 版本（2026-10-29）

2026-10-31 更新：每次同步将最终生效的 type.h 同时保存为 `<完整commitid>_<RTC列表>_<8位VHAL编码>`（无扩展名），并按用户确认保留同内容 `type.h` 兼容副本。身份来自实际来源仓库的当前固定提交；提交或 RTC 变化时即使内容相同也更新名称，旧命名文件保留到 bak。清单新增可选 headerFile 并校验两个文件，旧快照下次同步自动补齐；同名异内容拒绝发布。详情见 [同步需求 v0.5](requirements/terminal-sync-review.md#62-当前-typeh-按提交身份命名2026-10-31)。

管理员点击同步全部项目，分支组完整发布后保存最终 type.h 中的 VER_PRO_CFG，并更新项目/分支选择栏下一行的版本标签。82552236 表示8255平台、22.36版，标签显示完整82552236。切换分支读取各自版本，刷新从本地已发布快照恢复；缺失或格式无效显示未提取到。旧快照不需重新下载所有日志，再次同步可补记版本。

## 版本确认与 VHAL 信号检查（已实现，2026-10-30）

2026-10-31 更新：来源 commit 前缀命中后，以 RTC 完整匹配关联同项目、同一 branches 条目中唯一的 `vs` 仓库提交，再使用 VS commit 搜索版本归档。多 RTC 归并同一 VS commit 后继续；多个不同 VS commit 或多个 VS 仓库条目记歧义。部分 RTC 未匹配时留档提示；来源提交与 VS 提交分别保存在结构化结果与详情证据，旧结果兼容。规则与验收见 [RTC 关联 VS 提交需求](requirements/pipeline-vhal-vs-rtc-review.md)。

已确认覆盖所有共享流水线来源（普通 Jira、Bosch Jira、飞书及共享的单票/批量/周期入口）。证据整理后先由 AI 比对 SOC/SCC，版本不一致立即保存结论并停止后续分析；再按 Android hash 后最新编译日期选择完整短 hash（如 `6a5d61b`），追溯提交并同时搜索分支组根目录和 `bak/`。`82552235` 对应 `V2.2.35`。

车型以当前工单确认的 DBC 为准，保留 D01_OS_APA、D01_HW、T1L_FL1 等车型组成部分；Excel 查 Vehicle property ID、MCU UP、IVI DOWN（通常 I/S/T 列），Project（通常 E 列）按 `/` 分割后匹配完整车型。仅非空待查信号列表全部确认缺少配置且无大小写差异豁免时提前结束；部分缺少仍继续 Step4/5。详情、DBC 映射和验收场景见 [需求审核稿 v0.4](requirements/pipeline-version-vhal-review.md)。已接入共享编排、完整结果持久化、刷新恢复、历史及详情展示；特殊表语义等剩余边界按未知提示继续。SOC/SCC unknown、hash/版本/Excel 无法定位或读取均不阻断；同 commit 跨分支组、短 hash 冲突、最新日期并列不同 hash 时，将全部候选与冲突原因写入持久化日志作为提示，继续分析，不强选唯一版本。信号区分大小写（A 与 a 不同），不自动映射别名；仅大小写不匹配时留档提示并继续，即使只有一个待查信号也不因此停止。

## 飞书筛选挂起恢复（2026-10-30）

1. 每次飞书筛选创建独立运行，按需发现项目并查询MQL；单CLI命令超时30秒，整次飞书筛选截止90秒，Jira仍为10分钟。
2. 到期立即结束页面等待，将本次运行标记expired并显示原因，恢复重试。CLI超时终止包装器与原生后代，不启动交互登录。
3. 持续打开页面时每15秒检查过期记录，返回窗口时再次检查；刷新后无需修改IndexedDB即可恢复操作。来源状态读取也按当前时间派生过期态。
4. 迟到请求返回先检查取消信号，不再发起依赖查询或提交旧结果；原归属、快照、结果及历史保留，重试独立运行并沿用事务门禁。

## 日志自动匹配基础配置（已实现，2026-10-31）

[需求 v1.0](requirements/pipeline-auto-config-review.md) 已按最终确认实现：默认在下载解压后、Step2 前提取 SOC / SCC，并以 project.json 分支及可用 Android hash 消歧；车型完整匹配当前规则组 `aliases` 后，使用所属车型 JSON / 全部 DBC / Proto 清单。自动成功时冻结分支当前配置，配置文件、同步清单、DBC 解析任一失败均整套回退用户默认配置，不混合来源或强选候选。

新增规则组车型别名输入，贯通备份、模板和请求。回退也冻结可用用户文件并保持缺失原能力；运行目录、原始车型、runId 和恢复签名不变。JSON / Proto / DBC / 当前配置 VHAL 使用同一有效配置；明确日志身份冲突时，VHAL 检查记未知而不能用冲突上下文触发全部缺少提前结束。SOC/SCC 提取警告同样触发配置回退，原版本不一致停止规则保留。

本次运行的 `effective-config-resolution.json`、`effective-config-check.md` 与可选 configurationResolution 响应保存原始配置、全部候选、实际配置及文件摘要，内容冻结在 run/effective-config/。IndexedDB、重跑历史、飞书完整响应恢复及详情展示保存同一份决定；旧结果不补造字段，无数据库索引升级。问题历史 VHAL 与分支当前配置仍分别记录，历史整套配套未验证。

同步已增加 api-public 固定提交根文件 com.bosch.cm.platform.vehicle.proto，原名发布至对应 configuration 项目 / 分支组，沿用 blob 校验、补齐、普通 bak、删除及原子发布门禁。没有自动发起远程同步或真实工单分析；部署 / 真实目标验收见交接记录。

## VHAL 属性名称列匹配修复（2026-10-31）

共享信号检查增加按表头定位的 Vehicle property ID 名称列（通常 I 列），与 MCU UP / IVI DOWN 一起做大小写敏感的精确匹配，再检查命中行 Project 的完整车型。读取器保留只有属性名、没有上/下行 CAN 信号的行；旧表没有属性列仍兼容原两列。证据保存 column=Vehicle property ID，不做模糊或后缀猜测，不改变大小写差异 / unknown 继续以及全部确认缺少才停止的规则。7147061892 的四个属性在实际 VHAL 2.2.36 中均可匹配 T1J_FL3；未自动重跑或改写旧结果。


## 飞书工单上下文与图片查看（2026-10-31）

1. 打开飞书详情的「工单上下文」，先展示分析快照并读取当前票缓存；无缓存只读加载原票字段和评论。
2. 保留原正文排版、作者与时间，提取正文和描述中的图片并下载到本票持久化目录；只显示鉴权本地图片，可点开大图。
3. 刷新页面复用缓存。「刷新原票详情」重新读取原票，复用有效图片、补齐缺失图片；损坏缓存可重新下载。
4. 远端失败保留当前内容并提示；评论接口失败保留旧评论；单图下载失败用占位显示并可刷新重试。身份变更或组件卸载中止旧响应更新。
5. 此查看流程不启动分析、不发送评论、不改经办人，不覆盖旧 run；Jira 保留原纯文本上下文。

## 工单停止与知识库浏览（2026-11-02）

1. 工单详情点「停止」：运行中则取消服务端运行（飞书）并中止本地请求；无论是否运行中，都把该工单在当前规则组下残留的运行中 task 与处理中 assignment 置为失败。
2. 闪退后工单长期显示处理中：打开详情点「停止」→ 状态变为失败 → 点「重新分析」重新处理。
3. 智能助手知识库页签点击文档条目 → 弹窗按段查看全文 → 关闭返回列表；检索框筛选后同样可点击。
