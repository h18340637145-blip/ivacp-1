# ARCHITECTURE.md
# 系统架构文档（Next.js 版）

## IVACP 新仓库实现边界（2026-10-27）

新仓库使用以下分层，旧版 `lib/`、`stores/`、`components/` 路径示例仅用于迁移对照：

| 层 | 职责 |
| --- | --- |
| `src/domain` | 统一实体、纯业务规则与迁移转换，不依赖 React 或服务端 |
| `src/shared` | UI、客户端工具、`IvacpDB` 与镜像同步 |
| `src/features` | 按业务组织的客户端组件、store、接口服务 |
| `src/server` | Node 服务、外部系统适配、MySQL 和流水线阶段 |
| `src/app` | 页面组装与 API 路由 |

`src/domain/entities.ts` 是统一数据结构来源。Jira / 飞书的筛票、快照、处理、结果、历史和校验合并到带来源字段的表，IndexedDB 名称为 `IvacpDB`；MySQL 使用新镜像表 `sync_records`、`sync_clients`。旧系统转换逻辑在 `domain/migration/legacy.ts`，服务端入口在 `server/migration/legacy-mysql.ts`，迁移界面在 `/settings/data` 接通。不得将服务函数存在视为完整迁移验收。

规则组管理已接通：`app/(app)/page.tsx` 只组装 `features/rule-groups/components/kanban-board.tsx`。看板、卡片、配置表单和导入确认按职责拆分；`features/rule-groups/store.ts` 负责 IndexedDB 写入和缓存。`domain/rule-groups/import.ts` 在覆盖事务之前校验全部输入、恢复日期并规范化旧车型配置。合并与覆盖均使用单次读写事务；拖拽排序写入成功才发布新的缓存。数据库版本仍为 v1，没有为 UI 新增表或索引。

筛票编排位于 `features/workflow`：repository 管理启动、超时恢复、事务提交与迟到响应门禁；service 调用双来源接口并独立落库。`shared/hooks/use-live-data.ts` 订阅 Dexie 查询读过的表，让运行状态、当前归属、处理结果与其他标签页变化自动刷新。过程快照不再挂到筛票运行，避免同一票在列表重复出现。

处理生命周期位于 `features/tickets/services/process-repository.ts` 与 `process.ts`：事务创建 snapshot/task、归档旧 result，成功时原子写 task/result/assignment；Jira 和飞书都检查最新运行，旧归属任务不能改写新组分配。回填另用事务领取状态，网络调用在事务外执行；评论和状态流转分别提交。快照新增可选 Jira 站点字段、结果新增回填开始时间，均为非索引属性，未新增数据库版本。

共享服务端处理路由只组装 `server/pipeline/process/orchestrator.ts`，复用准备、附件、需求、信号映射、日志、证据、最终结论等阶段。所有新成功路径先严格保存最终回复、stages 与 `process-response.json`，最后发布带 `responseArtifactVersion: 1` 的成功指标。恢复时校验同一工单与回复，保留曲线、ticks、模型与 Token，重新签发运行引用及回填凭据；旧版本运行保留兼容判断。

当前已增加 `/rule-groups/[id]`、`/tickets/[source]/[key]` 及结果兼容页、校验详情页。`/meegle` 保留首页兼容入口。AutoCycle、数据管理和标注已接通；终端工作台已接通；其余功能对照仍按 `docs/REFACTOR_STATUS.md` 续接；下文旧系统架构不是新仓库完整实现的证明。

## 本年度统计读取边界

`KanbanBoard` 工具栏的 `AnnualStatisticsDialog` 在打开或重新统计时调用 `loadAnnualStatistics`，在一个 Dexie 只读事务中读取双来源结果、历史以及飞书快照/分配身份；纯函数 `calculateAnnualStatistics` 负责年度过滤、结果 ID 去重、年度最新票据去重及复核聚合。统计不写入数据库、不上传票据、不新增 API 或 schema 版本。`loadAnnualStatistics` / `calculateAnnualStatistics` 支持可选 `MonthRange`（年份 + 起止月，含首尾月，上限为统计时刻），默认仍为当年 1 月至统计时刻。年度按浏览器本地时区划分，数据范围和复核状态限制见产品文档。

`lib/pipeline/log-extract.ts` 的 `extractVehicleHalHashLines` 在 `buildFilteredLogsBySignalIds` 中把含 `BoschVehicleHalHash` 的行并入 Android 日志。

Token 与接手时段统计：`lib/server/qwen.ts` 的 `callQwen` 用 `AsyncLocalStorage` 累计每个请求内的 `usage.total_tokens`（缺失则字符估算）；`/api/issues/process` 在入口调用 `startQwenTokenUsage()`，响应带 `tokenUsage`（飞书 `/api/meegle/analyze` 透传）。前端 store 把它写入 `IssueProcessResult` / `MeegleProcessResult.tokenUsage`（非索引字段，无需 schema 升版，随镜像同步）。`StatisticsRun` 新增 `tokenUsage`、`handoverAt`，`SourceStatistics` 新增 `maxTokens/avgTokens/totalTokens/tokenSampleCount` 与 `workHoursHandovers/offHoursHandovers/unknownHandovers`（`isWorkingHoursInChina`：周一至周五 9:00–19:00 东八区），团队合并用 `totalTokens / tokenSampleCount` 加权；MySQL 投影同步增加这两个字段。飞书原票链接由 `lib/meegle/work-item-url.ts` 生成。

> 主页通过 `ruleGroupWorkflowStore` 并发编排 Jira JQL 与飞书项目 MQL。Jira 与飞书项目继续使用各自的 IndexedDB 表、外部 API 与回填实现；来源状态只在编排和展示层统一，失败不跨来源传播。

> 项目：Jira 智能分析平台（Next.js 全栈实现）  
> 版本：2.0  
> 更新时间：2025-07

---

## 目录

1. [架构概览](#1-架构概览)
2. [前端架构](#2-前端架构)
3. [后端架构](#3-后端架构)
4. [数据存储设计](#4-数据存储设计)
5. [集成架构](#5-集成架构)
6. [关键技术决策](#6-关键技术决策)
7. [部署架构](#7-部署架构)

---

## 1. 架构概览

### 飞书项目筛票边界

飞书筛票由服务端编排，并以 `RuleGroup.meegleMql` 作为各规则组的工作项查询主条件。完整 MQL 由浏览器从 `FROM \`project_key\`.\`work_item_type\`` 解析项目 key，只有兼容旧条件式 MQL 时才回退读取“我的待办”，避免待办为空时阻断真正的 MQL。一个工作项命中多个规则组时，按 `RuleGroup.sortOrder`、再按 `RuleGroup.id` 决定唯一归属。浏览器仅将结果写入 Dexie 的 `meegleAssignments` 和 `meegleFilterAudits`，不读写 Jira 的 `FilterTask` 或 `FilteredIssueSnapshot`；CLI 返回 `data: {}`、`list: null` 被规范化为成功的 0 条结果，避免误记为查询失败；成功 MQL 查询会将该组所有未再次命中的分配（含已完成、已回填和人工分配）解除 `ruleGroupId`，但不删除其结果或历史。单规则组筛选还依赖高优先级比较组：目标或任一所需比较 MQL 失败时，系统写入失败审计并保留该组既有归属，不以失败响应清空或覆盖原结果，也不改变 Jira 数据。当前筛选列表只读取最新任务；若最新任务失败，则不加载更早成功任务的快照，防止把历史票误报为本次 MQL 命中。

飞书分析恢复以 assignment 的 `latestAttemptTaskId` 和不可变 runId 为边界。刷新时只采用同一 runId 的完整成功产物；无完整产物的任务在创建未满 2 小时时继续保持处理中，超过 2 小时则在 IndexedDB 事务中将 task 与 assignment 一并标记失败，避免中断任务永久占用处理态。

### 1.1 系统定位

本系统是一套面向车载软件质量团队的 **Jira 工单智能分析平台**，核心能力包括：

- 从 Jira 批量拉取工单（JQL 筛票）
- 从飞书项目 `mywork todo` 拉取当前用户待办，并在 `/meegle` 拖拽分配到现有规则组
- 自动下载并解析工单附件（CANtrace/Proto/图片）
- 调用 Qwen AI API 对工单进行推理分析
- 生成结构化的分析结论并回填到 Jira 评论
- 通过飞书 Webhook 推送通知
- 支持拖拽排序规则组与任务卡片
- 支持自动周期调度，免人工干预

### 1.2 技术栈总览

| 技术 | 用途 |
|------|------|
| Next.js 14+ (App Router) | 全栈框架，SSR/RSC + API Routes |
| React 18+ | UI 渲染，Server Components + Client Components |
| TypeScript | 全栈类型安全 |
| shadcn/ui | UI 组件库（基于 Radix UI + Tailwind CSS） |
| IndexedDB (Dexie.js) | 客户端持久化存储 |
| Qwen API | AI 推理与复核服务 |

### 1.3 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户浏览器                                       │
│                                                                               │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │              Next.js 前端（React + TypeScript + shadcn/ui）            │   │
│   │                                                                      │   │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │   │
│   │  │  App Router   │  │  React State │  │  IndexedDB（Dexie.js）    │  │   │
│   │  │  页面 + 布局  │  │  Zustand/    │  │  本地数据持久化            │  │   │
│   │  │              │  │  React Query │  │                          │  │   │
│   │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │   │
│   │                                                                      │   │
│   │  ┌──────────────┐  ┌──────────────────────────────────────────────┐ │   │
│   │  │    网络层（fetch）                                             │ │   │
│   │  │                                                                │ │   │
│   │  └──────────────┘  └──────────────────────────────────────────────┘ │   │
│   └──────────┬─────────────────────────┬────────────┬─────────────────┘   │
│              │ HTTP/REST API            │            │ WebSocket
└──────────────┼─────────────────────────┼────────────┼─────────────────────┘
               │                         │            │
  ┌────────────▼─────────────────────────▼────────────┼─────────────────┐
  │         Next.js API Routes（后端服务层）            │                 │
  │                                                    │                 │
  │  ┌─────────────┐                                   │  ┌───────────┐  │
  │  │  REST API   │                                   │  │ Terminal  │  │
  │  │  Route      │                                   │  │ Gateway   │  │
  │  │  Handlers   │                                   │  │ (ssh2)    │  │
  │  └──────┬──────┘                                   │  └─────┬─────┘  │
  │         │                                          │        │        │
  │  ┌──────▼──────────────────────────────────────┐   │        │ SSH    │
  │  │              服务层（lib/services/）            │   │        │        │
  │  │                                               │   │  ┌─────▼─────┐  │
  │  │  筛票服务  分析服务  复核服务  校验服务  调度服务  │   │  │ SSH Server │  │
  │  └──────────────────────┬────────────────────────┘   │  └───────────┘  │
  │                         │                                             │
  │  ┌──────────────────────▼────────────────────────┐                    │
  │  │              核心处理层（lib/core/）              │                    │
  │  │  pipeline │ jira-client │ qwen-client │ can   │                    │
  │  └────────────────────────────────────────────────┘                    │
  │                                                                       │
  │  ┌──────────────────────────────────────────────┐                    │
  │  │      IndexedDB（客户端）/ SQLite（服务端可选）    │                    │
  │  └──────────────────────────────────────────────┘                    │
  └──────────────┬──────────────┬──────────────────────┬──────────────────┘
                 │              │                      │
┌────────────────▼──┐    ┌──────▼──────────────────┐   │
│   Jira Server      │    │   Qwen API               │   │
│  （REST API）       │    │  （通义千问大模型）        │   │
└───────────────────┘    └─────────────────────────┘   │
                                      │                │
                          ┌───────────▼────────────┐   │
                          │   飞书 Webhook           │   │
                          └────────────────────────┘   │
                                                       │
                                            ┌──────────▼────────────┐
                                            │    审计日志 (JSONL)     │
                                            └───────────────────────┘
```

### 1.4 核心数据流（端到端）

```
用户操作（浏览器）
   │
   ▼
[1] 筛票
   POST /api/filter-tasks
        │
        ▼
   filterTaskRunner（API Route 内异步执行）
   执行 JQL 查询 Jira
        │
        ▼
   FilteredIssueSnapshot（IndexedDB 存储）
        │
        ▼
[2] 处理
   POST /api/process-tasks
        │
        ▼
   issueProcessPipeline
   ┌─────────────────────────────────────────────────────┐
   │  下载附件(ZIP/PNG) → 解包 → 解析CAN/Proto信号           │
   │       → 输出CAN提取结果/signals.json/signals_id.json/extract.md │
   │       → Qwen AI 推理 → 生成 replyText                   │
   └─────────────────────────────────────────────────────┘
        │
        ▼
   IssueProcessResult（存储）
        │
   ┌────┴────────────────────┐
   ▼                         ▼
[3] AI 复核                [4] 校验
reviewIssueResult       buildValidationPayload
Few-shot Qwen 调用        比对AI结论时间与CANtrace信号时间
        │                         │
        ▼                         ▼
reviewStatus 更新        IssueValidationRun 存储
        │
        ▼
[5] 回填 Jira
jiraClient.addComment()
hasCommentedToJira = true
        │
        ▼
[6] 飞书通知
POST /api/feishu/process-result

[7] Docupedia 归档
lib/server/docupedia.ts
服务端成功响应完成后，Next.js `after` 异步上传当前 run 的 logRoot 文本日志；浏览器收到成功响应后独立持久化 IndexedDB，两者互不作为门槛。失败不影响结果、复核或回填，重启不恢复未完成上传

归档模块在文本文章 find-or-create 成功后调用 `lib/server/docupedia-upload-stats.ts`，只记录原始归档正文 `text.length > 500` 的文章，不计 HTML 转义和包装字符，不计目录页面。记录追加到 `log/docupedia-upload-stats/YYYY-MM.jsonl`，月份取服务器本地时间，`uploadedAt` 保存 UTC ISO 时间。同月以标题去重，累计篇数从持久文件中的唯一标题计算；单个 Next.js 进程内按月文件串行写入，避免并发分析相互覆盖，不支持多个服务进程同时写同一统计目录。写入失败独立告警，不进入上传失败计数。数据清理跳过统计目录，进程重启后从原文件继续累计；无合格文章时不创建月文件。

[8] 远程终端 (Terminal)
Browser -- WebSocket --> Terminal Gateway -- SSH --> Server
                               │
                               └--> Audit Log (JSONL)

[9] 飞书项目工作台
/meegle --> /api/meegle/mywork --> meegle mywork todo
  │
  ├── RuleGroup.meegleMql --> Meegle MQL 查询（筛票主条件）
  ├── 多组命中 --> sortOrder、id 确定唯一自动归属
  ├── MQL 响应失败 --> meegleFilterAudits；保留既有自动结果，不改 Jira 数据
  ├── 拖拽分配 --> IndexedDB meegleAssignments
  ├── 首页恢复 --> 仅检查 status=processing 的 task runId；success 产物完整时重建 result + 签名引用并标记 completed
  ├── /api/meegle/context --> 工作项、评论附件与插件附件合并快照
  ├── meegleProcessStore --> 独立 snapshot/task/result/history/validation 表
  ├── meegleProcessStore --> /api/issues/process（浏览器直接复用完整分析流水线）
  │   └── log/<规则组>/<车型>/meegle-<id>/<runId>/（不可变运行产物）
  └── /meegle/issues/<id>/result
      ├── /api/meegle/workitem（详情凭据与当前经办人）
      ├── MeegleAssigneeControl（项目成员模糊搜索与安全修改）
      ├── processAssignment（重新分析，旧 result 进入 history）
      ├── /api/meegle/artifacts（artifactRef 白名单只读）
      ├── /api/issues/review（AI 建议）+ 人工复核门禁
      └── /api/meegle/comment --> /api/meegle/workflow（分步持久化）
```

Meegle 与 Jira 只共享分析、复核、证据校验、处理结果通知和 success-only Docupedia 归档算法。Meegle 的业务生命周期由 `stores/meegleProcessStore.ts` 管理，并写入 Dexie v7 的专用表；跨来源只共享 `IssueReviewSample` 与 `LearningMemory`。共享处理响应包含当前 run 构造的 `reviewEvidence`（车型、prop、signal token、十进制/十六进制 Property ID），两个结果表各自持久化该字段，人工通过和人工驳回再通过 `lib/analysis/review-sample.ts` 写入统一正负样本池。Meegle MQL 筛票的分配与失败审计均限定在飞书专用表中，不能写入或改动 Jira 数据。浏览器在保存 Meegle snapshot/task 后直接调用 `/api/issues/process`，并以 task ID 作为安全 `runId`；共享成功路径只归档该运行目录，失败不阻断结果。结果页重新分析复用同一 `processAssignment` 生命周期，由 store 在新 task 创建前将旧 result 归档到 history。两个 store 都通过 `lib/feishu/process-result-notify.ts` 调用同一 webhook，payload 的 `source` 决定 Jira 或飞书项目标题。标准详情和结果页读取会签发经办人详情凭据；`/api/meegle/authorize` 绑定当前成员和目标用户，`/api/meegle/assignee` 二次读取后动态替换“经办人”角色，不调用 workflow。

### Meegle 附件插件适配

标准 `multi_attachment` 字段与 MQL 不包含第三方附件插件的数据。服务端先将评论 Markdown、`file_url` 和 `file_urls` 中的安全 HTTPS 附件规范化为带 `source=meegle-comment` 的 `JiraAttachment`，其时间取所属评论的 `created_at`；再调用 `lib/server/meegle-plugin-attachments.ts` 的 `/api/files/list`，将 `id/name/size/type/uploadedAt/uploadedBy` 规范化为同一结构。评论接口只返回不透明 URL，无法在下载前取得原始名称，因此共享处理 run 会先在私有暂存目录通过 Meegle `attachment +download` 预取评论附件，以 CLI 返回值补齐名称、MIME 和大小。补齐后的评论附件与插件附件由共享分类器按各自时间选择最新 CAN 与日志包；选中的评论文件复用暂存副本，插件下载 URL 继续由共享下载器流式落盘，未选中的评论暂存文件在处理结束时清理。两类来源都没有 CAN trace 或日志压缩包时，Meegle 直接返回固定补件结论，不进入仅评论 AI 分析；Jira 的无附件路径不变。共享下载器仅在目标主机等于 `JIRA_SERVER` 时发送 Jira Basic Auth，防止凭据泄露到飞书或插件主机。列表请求和插件文件下载均复用 `HTTPS_PROXY` / `HTTP_PROXY` 配置。

---

### Terminal Gateway

远程终端使用独立 Node.js Gateway 进程，负责 WebSocket、SSH、PTY、命令限制和审计。Gateway 启动时通过 `@next/env` 加载与 Next.js 相同的 `.env`，读取 `REMOTE_SHELL_TARGETS_JSON` 白名单；默认监听 `0.0.0.0:39222`，可用 `REMOTE_SHELL_GATEWAY_HOST` 和 `REMOTE_SHELL_GATEWAY_PORT` 覆盖。Next.js 只负责 `/terminal` 页面和公开目标列表 API，浏览器默认连接当前页面 hostname 的 Gateway 端口，也可用 `NEXT_PUBLIC_REMOTE_SHELL_GATEWAY_URL` 覆盖。

`REMOTE_SHELL_TARGETS_JSON` 的敏感认证字段只在 Gateway 进程内使用，不返回浏览器。每个目标至少需要配置 `privateKeyPath`、`password` 或 `agentSocket` 之一；私钥可额外配置 `privateKeyPassphrase`。SSH 认证失败会被转换为明确的认证错误并写入审计日志，不记录命令输出或密码内容。

远程终端项目操作读取仓库内 `docs/project.json`。Next.js 通过 `/api/terminal/projects` 返回项目、分支和 repo 元数据；Terminal Gateway 根据当前 WebSocket session 复用目标服务器认证材料，在当前已认证 SSH 连接上使用独立 exec 通道执行 git status、上传文件、打包下载和配置文件扫描，不把这些自动化命令写入交互式 PTY。此外，针对选中的文件，浏览器可通过 WebSocket 向 Gateway 发送 `gitAdd`、`gitCheckout` 或 `gitReset` 类型的消息，Gateway 同样会通过独立 SSH exec 静默在对应的 repo 目录下执行远程的 `git add`、`git checkout --` 和 `git reset HEAD` 命令，避免干扰用户的 PTY 屏幕。配置文件扫描使用 `signalConfigFiles` 消息，在每个 repo 下读取 `tools/json/config_*.json` 并把 `*` 作为前端复选框名称；前端以 `repoPath + branchName` 作为配置复选框状态和请求签名，路径或分支变化会清空旧列表并重新扫描；点击“配置”会发送 `checkoutSignalConfigFiles`，Gateway 只接受 `tools/json/config_*.json` 形式的文件路径，并在对应 repo 下执行 `git checkout --` 恢复未勾选文件。上传文件从浏览器转为 base64 发送到 Gateway，再写入远端 `mainPath/scriptPath/`、`mainPath/repoPath/tools/sdb/` 或 `mainPath/repoPath/tools/inc/`。打包下载在远端生成临时 zip，使用静默 `zip -q` 避免进度信息混入 stdout，并通过 base64 起止标记截取有效内容，base64 回传浏览器后由前端触发本地下载。

需要改变用户当前 shell 上下文的动作通过交互式 PTY 发送命令：选择项目发送 `cd mainPath`，选择分支发送各 repo 的 `git checkout branchName`，点击配信号发送 `cd mainPath/scriptPath`。一键 checkout 和一键 pull 也通过交互式 PTY 顺序执行当前分支配置下所有 repo 的 `git checkout .` / `git pull`。分支切换命令带有失败兜底：若 checkout 因本地未提交文件失败，则先 `git stash push -u` 再重试 checkout。这类命令会显示在终端中，并继续经过 Gateway 的命令审计和拦截逻辑。

---

## 2. 前端架构

### 2.1 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 16+ | App Router，SSR/RSC/ISR |
| React | 19+ | UI 渲染，Server + Client Components |
| TypeScript | 5.x | 静态类型 |
| Tailwind CSS | 4.x | 原子化样式（`@import "tailwindcss"` v4 语法） |
| CSS Variables | — | 暗色工业风设计系统（`--c-*` 令牌） |
| Radix UI Primitives | latest | Dialog 等无障碍基础组件（直接使用 Primitive，不走 shadcn/ui 包装） |
| Zustand | latest | 轻量级客户端状态管理 |
| Dexie.js | 4.x | IndexedDB 封装库 |
| dnd kit | latest | 拖拽排序（`@dnd-kit/core` + `@dnd-kit/sortable`） |
| nanoid | — | 唯一 ID 生成 |

### 2.1.1 UI 设计系统

项目采用**暗色工业指令台（Dark Industrial Command Terminal）**风格：

- **背景色**：`#080b0a`（近黑色，带极轻微绿色调）
- **主题色**：Amber `#e8a520`（汽车警示信号黄）
- **角色区分色**：VehicleService → 绿色 / VehicleHAL → 紫色 / Chery → Amber / Geely → 蓝色
- **字体**：系统字体栈（macOS: SF Pro + PingFang SC；Win: Segoe UI + Microsoft YaHei）
- **等宽字体**：Cascadia Code / JetBrains Mono（用于 JQL、配置路径等技术内容）
- **布局**：水平行（Row）取代卡片（Card），左侧彩色 3px 竖条区分角色
- 所有 CSS 设计令牌定义于 `app/globals.css` 的 `:root` 块中

### 2.2 目录结构（实际已落地）

```
app/                              # 项目根目录
├── app/
│   ├── layout.tsx                # 根布局（NavBar）
│   ├── page.tsx                  # 首页（渲染 KanbanBoard）
│   ├── globals.css               # 全局样式 + 设计系统 CSS 令牌（暗色工业风）
│   └── api/                      # API Route Handlers（待实现）
├── components/
│   ├── ui/                       # 基础 UI 原语（保留备用）
│   │   ├── button.tsx, badge.tsx, card.tsx
│   │   ├── dialog.tsx, input.tsx, textarea.tsx, label.tsx
│   │   └── scroll-area.tsx, separator.tsx
│   ├── rule-group/
│   │   ├── RuleGroupRow.tsx      # 规则组行（暗色工业风，左彩条，hover 显示操作）
│   │   ├── RuleGroupList.tsx     # 规则组列表（DndContext + SortableContext）
│   │   └── RuleGroupDialog.tsx   # 规则组编辑弹框（Radix Primitive，暗色风格）
│   ├── KanbanBoard.tsx           # 主看板页（Client Component）
│   └── layout/
│       └── NavBar.tsx            # 顶部导航（monospace 品牌标识 + 状态点动画）
├── lib/
│   ├── db/schema.ts              # IndexedDB Dexie Schema（8张表）
│   └── utils/cn.ts               # classnames 合并工具
├── stores/
│   └── ruleGroupStore.ts         # Zustand 规则组状态（含 IndexedDB 读写）
└── types/
    └── rule-group.ts             # TypeScript 类型导出
```

### 2.3 组件层次（v1 已实现）

```
RootLayout（根布局）
└── NavBar（顶部导航栏 — 暗色工业风，monospace 品牌标识）
    └── {children}
        └── KanbanBoard（主看板，Client Component）
            ├── 页头区（grid 背景 + 面包屑 + 统计数字 + 新建按钮）
            ├── RuleGroupList（dnd kit 排序容器）
            │   ├── 表头行（列标签）
            │   └── RuleGroupRow × N（可拖拽行，左彩条，hover 显示操作）
            │       ├── 拖拽把手（⠿ 字符）+ 序号 + 名称
            │       ├── 车型 Tag + 角色 Tag + Jira 项目 Tag
            │       ├── JQL 预览（monospace 字体，单行截断）
            │       ├── 悬停显示：编辑按钮 + 删除按钮
            │       └── 底部操作：筛票按钮 + 一键处理按钮 + 创建日期
            └── RuleGroupDialog（Radix Dialog Primitive，暗色弹框）
                ├── 弹框头部（命令行风格标题）
                ├── 表单字段（名称、车型、角色、JQL、CAN 路径、AI Prompt）
                └── 弹框底部（取消 / 保存）
```

### 2.4 UI 组件使用规范

> ⚠️ 本项目不强制使用 shadcn/ui Card 组件。规则组条目使用自定义 `RuleGroupRow` 行式布局。
> 原有 `components/ui/` 组件保留备用，后续页面（分析详情、设置页）按需选用。

| 场景 | 实现方式 |
|------|---------|
| 规则组条目 | `RuleGroupRow`（自定义行布局，左彩条，暗色工业风） |
| 规则组编辑弹框 | `RuleGroupDialog`（直接使用 `@radix-ui/react-dialog` Primitive） |
| Geely2 专项页 | `/geely2` + `/geely2/results/:id`，Client Component 直接读取 IndexedDB 聚合吉利二期分析结果 |
| 操作按钮 | 内联 `<button>` + CSS 变量样式（hover 效果用事件处理） |
| 标签/徽标 | 内联 `<span>` + CSS 变量颜色（无需 Badge 组件） |
| 工单详情页（待实现） | 可使用 `components/ui/card.tsx` |
| Dialog | `@radix-ui/react-dialog` Primitive 直接使用 |
| Input/Textarea | `components/ui/input.tsx` / `textarea.tsx` 或内联 `<input>` |
| ScrollArea | `components/ui/scroll-area.tsx` |
| Separator | `components/ui/separator.tsx` |

### 2.5 拖拽排序（dnd kit）

```typescript
// RuleGroupList.tsx 示意
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

export function RuleGroupList({ groups }: { groups: RuleGroup[] }) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active.id !== over?.id) {
      // 更新排序并持久化到 IndexedDB
      const oldIndex = groups.findIndex(g => g.id === active.id);
      const newIndex = groups.findIndex(g => g.id === over?.id);
      const newOrder = arrayMove(groups, oldIndex, newIndex);
      updateGroupOrder(newOrder);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={groups} strategy={verticalListSortingStrategy}>
        {groups.map(group => (
          <SortableRuleGroupCard key={group.id} group={group} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
```

### 2.6 状态管理

```
┌───────────────────────────────────────────────┐
│                  数据流                         │
│                                               │
│  服务端数据                客户端状态            │
│  ┌─────────────┐         ┌─────────────────┐ │
│  │ React Query │◄─fetch──│ API Routes      │ │
│  │ (缓存+同步) │         │ /api/*          │ │
│  └──────┬──────┘         └─────────────────┘ │
│         │                                     │
│         ▼                                     │
│  ┌─────────────┐  ┌────────────────────────┐ │
│  │  Zustand    │  │  IndexedDB (Dexie.js)  │ │
│  │  UI 状态    │  │  持久化缓存 + 离线数据   │ │
│  └─────────────┘  └────────────────────────┘ │
│         │                    │                 │
│         ▼                    ▼                 │
│  ┌─────────────────────────────────────────┐ │
│  │         React 组件树渲染                   │ │
│  └─────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

**本地状态更新流程：**

```
用户操作 / AutoCycle 本地调度
     │
     ▼
Zustand Store 执行 fetch / IndexedDB 读写
     │  响应式触发
     ▼
RuleGroupCard / TaskItem 组件重新渲染
```

---

## 3. 后端架构

### 3.1 分层设计

```
┌─────────────────────────────────────────────────┐
│  接入层（app/api/ Route Handlers）                │
│  • Next.js API Route Handlers                    │
│  • 参数校验（Zod Schema）、权限检查、任务分发         │
└────────────────────────┬────────────────────────┘
                         │
┌────────────────────────▼────────────────────────┐
│         类型层（types/）                          │
│  • TypeScript Interface / Type 定义请求/响应结构   │
│  • Zod Schema 运行时校验                          │
└────────────────────────┬────────────────────────┘
                         │
┌────────────────────────▼────────────────────────┐
│        服务层（lib/services/）                    │
│  • 业务逻辑封装，独立于 HTTP 层                      │
│  • 各服务模块职责单一，通过函数调用组合                 │
└────────────────────────┬────────────────────────┘
                         │
┌────────────────────────▼────────────────────────┐
│       核心处理层（lib/core/）                     │
│  • 与具体技术深度耦合（Jira REST、Qwen API、CAN 解析） │
│  • 被服务层调用，不直接操作存储层                      │
└────────────────────────┬────────────────────────┘
                         │
┌────────────────────────▼────────────────────────┐
│        数据层（lib/db/）                          │
│  • Dexie.js IndexedDB Schema（客户端）             │
│  • 服务端镜像：MySQL（mysql2，lib/server/mysql-mirror）│
└─────────────────────────────────────────────────┘
```

### 3.2 API Route 设计

```
app/api/
├── auth/
│   ├── login/route.ts        # POST: 基于 docs/login.json 登录并写入 Session Cookie
│   ├── logout/route.ts       # POST: 清除 Session Cookie
│   └── session/route.ts      # GET: 读取当前登录用户和角色
├── openapi/
│   └── route.ts              # GET: OpenAPI 3.0 JSON 规格（/api/openapi）
├── docs/
│   └── route.ts              # GET: Swagger UI 文档页（/api/docs）
├── rule-groups/
│   ├── route.ts              # GET: 获取规则组列表 / POST: 创建规则组
│   ├── [id]/
│   │   └── route.ts          # GET/PUT/DELETE: 单个规则组 CRUD
│   └── reorder/
│       └── route.ts          # PUT: 更新拖拽排序
├── filter-tasks/
│   ├── route.ts              # GET: 列表 / POST: 创建筛票任务
│   └── [id]/
│       └── route.ts          # GET: 单个任务详情
├── process-tasks/
│   ├── route.ts              # POST: 创建处理任务
│   └── [id]/
│       ├── route.ts          # GET: 处理结果
│       ├── review/
│       │   └── route.ts      # POST: 触发 AI 复核
│       └── comment/
│           └── route.ts      # POST: 回填 Jira 评论
├── rule-groups/
│   └── [id]/
│       └── processed-issues/
│           └── [issueKey]/
│               └── transition/
│                   └── route.ts # GET: 可用 Jira 流转 / POST: 执行状态流转与可选指派
└── feishu/
    └── process-result/
        └── route.ts          # POST: 发送单票处理结果飞书通知
```

登录与鉴权由根目录 `proxy.ts` 统一处理：`/login`、`/api/auth/*`、`/api/openapi` 和 `/api/docs` 为公开入口；其他业务页面未登录时重定向到 `/login?next=...`，业务 API 未登录时返回 401，角色不足时返回 403。用户账号只从 `docs/login.json` 读取，Session Token 使用 HMAC 签名后写入 `jira_analyzer_session` httpOnly Cookie。

规则组后端 API 位于 `/api/rule-groups`、`/api/rule-groups/[id]` 和 `/api/rule-groups/reorder`。根据“不引入后端数据库”的约束，这些接口使用 `lib/server/rule-groups.ts` 读写项目本地 `data/rule-groups.json`，用于提供服务端规则组管理接口和权限边界；现有首页工作数据仍由浏览器 IndexedDB 维护。规则组写操作只允许管理员执行，普通分析员只能读取。

### 3.3 服务模块划分

#### 筛票子系统

| 模块 | 路径 | 职责 |
|------|------|------|
| `filterTaskRunner.ts` | `lib/services/` | 接收筛票任务，构建 JQL，调用 Jira 查询，写入快照 |
| `filterTaskExecutor.ts` | `lib/services/` | Promise 并发控制，提交 filterTaskRunner 异步执行 |
| `bulkTaskActions.ts` | `lib/services/` | 批量筛票/批量处理的入口聚合 |

#### 分析子系统

| 模块 | 路径 | 职责 |
|------|------|------|
| `analysisRunner.ts` | `lib/services/` | 分析任务调度主入口 |
| `taskExecutor.ts` | `lib/services/` | Promise 并发包装，提交分析任务异步执行 |
| `issueAnalysisService.ts` | `lib/services/` | 单工单完整分析流程（下载→解析→推理→存储） |
| `issueProcessPipeline.ts` | `lib/services/` | 处理流水线编排 |
| `jiraIssuePayload.ts` | `lib/services/` | 构建发送给 AI 的 Jira 工单上下文结构体 |
| `cantracePayload.ts` | `lib/services/` | 构建 CANtrace 信号数据结构体 |

#### 复核与校验子系统

| 模块 | 路径 | 职责 |
|------|------|------|
| `issueReviewService.ts` | `lib/services/` | Few-shot Qwen 复核，更新 reviewStatus |
| `issueValidationRunner.ts` | `lib/services/` | 校验任务运行器 |
| `issueValidationService.ts` | `lib/services/` | 比对 AI 结论时间与 CANtrace 信号时间轴 |

#### 规则组子系统

| 模块 | 路径 | 职责 |
|------|------|------|
| `taskCatalog.ts` | `lib/services/` | 从配置动态加载规则组定义 |
| `ruleGroupPayload.ts` | `lib/services/` | 构建规则组快照数据 |

#### 调度与通知子系统

| 模块 | 路径 | 职责 |
|------|------|------|
| `autoCycleStore.ts` | `stores/` | AutoCycle 状态持久化到 IndexedDB，提供开关、间隔更新和运行时间标记 |
| `KanbanBoard` 本地调度器 | `components/KanbanBoard.tsx` | 页面打开时恢复 AutoCycle 状态，每 30 秒检查到期规则组；以当次 `runUnifiedFilter` 的来源汇总调用 `processRuleGroup`，不使用失败来源的历史结果 |
| `process-result/route.ts` | `app/api/feishu/` | 发送单票处理结果飞书通知 |
| `transition/route.ts` | `app/api/rule-groups/[id]/processed-issues/[issueKey]/` | 读取 Jira 可用 workflow transitions，从 Jira 票详情过滤相关人员候选，执行 transition，并可选调用 assignee API |
| `openapi/route.ts` | `app/api/openapi/` | 返回当前已实现 API Routes 的 OpenAPI 3.0 JSON 规格 |
| `docs/route.ts` | `app/api/docs/` | 返回 Swagger UI HTML，并从 `/api/openapi` 加载接口规格 |
| `session.ts` / `permissions.ts` | `lib/auth/` | 从 `docs/login.json` 读取本地用户、签发 Session Token，并提供路径权限判断 |
| `rule-groups.ts` | `lib/server/` | 为 `/api/rule-groups` 提供本地 JSON 轻量持久层，读写 `data/rule-groups.json` |
| `learningMemoryService.ts` | `lib/services/` | AI 学习记忆的持久化读写 |

### 3.4 异步任务执行模型

系统使用 Node.js 原生异步能力（Promise + AsyncQueue）实现轻量级异步执行，不依赖外部消息队列。

```
HTTP 请求（API Route Handler）
    │  提交任务
    ▼
submitAnalysisTask() / submitFilterTask()
    │
    ▼
AsyncTaskQueue.enqueue(runnerFn, taskId)
    │  Promise 异步执行（p-limit 控制并发）
    ▼
runnerFn 执行业务逻辑
    │
    ▼
前端 Store 在操作完成后写入 IndexedDB 并更新本地状态
```

---

## 4. 数据存储设计

### 4.1 IndexedDB Schema（Dexie.js）

```typescript
// lib/db/schema.ts
import Dexie, { Table } from 'dexie';

export interface RuleGroup {
  id: string;
  name: string;
  carModel: string;
  role: string;
  jiraProject: string;
  config: Record<string, unknown>;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FilterTask {
  id: string;
  ruleGroupId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  jql: string;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface FilteredIssueSnapshot {
  id: string;
  filterTaskId: string;
  issueKey: string;
  summary: string;
  rawData: Record<string, unknown>;
}

export interface IssueProcessTask {
  id: string;
  snapshotId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
}

export interface IssueProcessResult {
  id: string;
  processTaskId: string;
  issueKey: string;
  replyText: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  hasCommentedToJira: boolean;
  aiConclusionTime?: string;
  createdAt: Date;
}

export interface IssueAnalysisHistory {
  id: string;
  ruleGroupId: string;
  issueKey: string;
  sourceSnapshotId: string;
  sourceProcessTaskId: string;
  sourceResultId: string;
  replyText: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  hasCommentedToJira: boolean;
  aiConclusionTime?: string;
  manualCorrectResult?: string;
  errorReason?: string;
  resultCreatedAt: Date;
  archivedAt: Date;
}

export interface IssueValidationRun {
  id: string;
  resultId: string;
  validationStatus: 'pass' | 'fail' | 'warning';
  diffSeconds: number;
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface AutoCycleState {
  id: string;
  ruleGroupId: string;
  isActive: boolean;
  intervalMinutes: number;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

export interface LearningMemory {
  id: string;
  ruleGroupId: string;
  memoryKey: string;
  content: string;
  updatedAt: Date;
}

export class AnalyzerDB extends Dexie {
  ruleGroups!: Table<RuleGroup>;
  filterTasks!: Table<FilterTask>;
  filteredIssueSnapshots!: Table<FilteredIssueSnapshot>;
  issueProcessTasks!: Table<IssueProcessTask>;
  issueProcessResults!: Table<IssueProcessResult>;
  issueAnalysisHistories!: Table<IssueAnalysisHistory>;
  issueValidationRuns!: Table<IssueValidationRun>;
  autoCycleStates!: Table<AutoCycleState>;
  learningMemories!: Table<LearningMemory>;

  constructor() {
    super('JiraAnalyzerDB');
    this.version(1).stores({
      ruleGroups: 'id, carModel, role, sortOrder',
      filterTasks: 'id, ruleGroupId, status, createdAt',
      filteredIssueSnapshots: 'id, filterTaskId, issueKey',
      issueProcessTasks: 'id, snapshotId, status',
      issueProcessResults: 'id, processTaskId, reviewStatus',
      issueAnalysisHistories: 'id, ruleGroupId, issueKey, sourceResultId, archivedAt',
      issueValidationRuns: 'id, resultId, validationStatus',
      autoCycleStates: 'id, ruleGroupId',
      learningMemories: 'id, ruleGroupId, memoryKey',
    });
  }
}

export const db = new AnalyzerDB();
```

### 4.2 核心实体关系

```
┌───────────────────┐         ┌─────────────────────────┐
│   RuleGroup        │         │   FilterTask              │
│───────────────────│         │─────────────────────────│
│ id (PK)           │◄────────│ ruleGroupId (FK)         │
│ name              │  1    N │ id (PK)                  │
│ carModel          │         │ status                   │
│ role              │         │ jql                      │
│ jiraProject       │         │ createdAt                │
│ config (JSON)     │         └──────────┬──────────────┘
│ sortOrder         │                    │ 1
└───────────────────┘                    │
                                         │ N
                              ┌──────────▼──────────────┐
                              │  FilteredIssueSnapshot   │
                              │─────────────────────────│
                              │ id (PK)                  │
                              │ filterTaskId (FK)        │
                              │ issueKey                 │
                              │ summary                  │
                              │ rawData (JSON)           │
                              └──────────┬──────────────┘
                                         │ 1
                                         │
                                         │ N
                              ┌──────────▼──────────────┐
                              │  IssueProcessTask        │
                              │─────────────────────────│
                              │ id (PK)                  │
                              │ snapshotId (FK)          │
                              │ status                   │
                              │ createdAt                │
                              └──────────┬──────────────┘
                                         │ 1
                                         │
                                         │ 1
                              ┌──────────▼──────────────┐
                              │  IssueProcessResult      │
                              │─────────────────────────│
                              │ id (PK)                  │
                              │ processTaskId (FK)       │
                              │ replyText                │
                              │ reviewStatus             │
                              │ hasCommentedToJira       │
                              │ aiConclusionTime         │
                              └──────────┬──────────────┘
                                         │ 1
                                         │
                                         │ N
                              ┌──────────▼──────────────┐
                              │  IssueValidationRun      │
                              │─────────────────────────│
                              │ id (PK)                  │
                              │ resultId (FK)            │
                              │ validationStatus         │
                              │ diffSeconds              │
                              │ detail (JSON)            │
                              └─────────────────────────┘

┌─────────────────────────┐         ┌─────────────────────────┐
│  AutoCycleState          │         │  LearningMemory          │
│─────────────────────────│         │─────────────────────────│
│ id (PK)                 │         │ id (PK)                  │
│ ruleGroupId (FK)        │         │ ruleGroupId (FK)         │
│ isActive                │         │ memoryKey                │
│ intervalMinutes         │         │ content (TEXT)           │
│ lastRunAt               │         │ updatedAt                │
│ nextRunAt               │         └─────────────────────────┘
└─────────────────────────┘
```

### 4.3 关键字段说明

| 表 | 字段 | 说明 |
|---|---|---|
| `IssueProcessResult` | `reviewStatus` | `pending` / `approved` / `rejected` |
| `IssueProcessResult` | `hasCommentedToJira` | 是否已回填 Jira 评论，防止重复提交 |
| `IssueProcessResult` / `MeegleProcessResult` | `handoverAt` | 经办人最近一次改为 HUANG Hongwei / DAI Yungui 的时间；处理时由服务端读取 Jira changelog（`/api/jira/handover`）或飞书操作记录（`/api/meegle/analyze`、`/recover` 返回），失败则留空 |
| `IssueProcessResult` / `MeegleProcessResult` | `handoverOutAt` / `dwellMs` / `isWeekend` | 处理完成时（基准为处理结束时间）和评论回填成功时（基准为 `commentedAt`）由 `completeHandoverFields` 写入：转出时间 = 基准 + 1 小时，停留 = 转出 − 接手，无接手时间则停留默认 4 小时，停留 > 24 小时且接手当天（东八区）为周六/日则为“是”，否则“否”。均为非索引字段，不升级 Dexie 版本 |
| `IssueProcessResult` | `aiConclusionTime` | AI 推断的故障发生时间（用于校验） |
| `IssueProcessResult` / `MeegleProcessResult` | `reviewEvidence` | 当前 run 的车型、prop、signal token 与 Property ID，人工复核写样本时直接复用 |
| `IssueReviewSample` | `sampleKind` | `correction` / `approved`；缺失时按历史 `correction` 兼容 |
| `IssueReviewSample` | `approvedConclusion` | 人工确认通过的 AI 结论，仅供正向分析模式参考 |
| `IssueReviewSample` | `evidenceFingerprintText` | 标题、规则组和结构化证据组成的不可变召回文本 |
| `IssueAnalysisHistory` | `sourceResultId` | 被归档的历史分析结果 ID，用于防止重复归档 |
| `IssueAnalysisHistory` | `reviewStatus` | 历史分析当时的复核状态，不影响新分析结果 |
| `IssueAnalysisHistory` | `hasCommentedToJira` | 历史分析当时是否已回填 Jira，不影响新分析结果 |
| `IssueValidationRun` | `diffSeconds` | AI 结论时间与 CANtrace 信号时间差值（秒） |
| `AutoCycleState` | `intervalMinutes` | 自动调度间隔，支持运行时修改 |
| `RuleGroup` | `config` | 存储规则组参数（提示词模板、阈值等） |
| `RuleGroup` | `sortOrder` | 拖拽排序序号，dnd kit 更新后持久化 |

### 4.4 服务端文件系统存储

分析流水线在服务端本地磁盘上持久保存两类数据，按 **规则组 / 车型 / 工单号** 三级分类：

```
PROJECT_ROOT/
├── jira-issues/                    # 附件永久存储（不清理）
│   └── {ruleGroupId}/
│       └── {carModel|unknown}/
│           └── {issueKey}/
│               ├── trace.asc       # CAN trace 文件
│               ├── logs.zip        # 下载的原始日志包
│               └── extracted/      # 解压后的全部文件（含递归展开的 Bosch-*.zip / *.gz / *.tar.gz / *.zst）
│
└── log/                            # AI 分析步骤结果
    └── {ruleGroupId}/
        └── {carModel|unknown}/
            └── {issueKey}/
                ├── pipeline.log        # 完整管道执行日志（带时间戳）
                ├── input_comments.txt  # 发送给 AI 的 commentsText 原文
                ├── step1_requirements.md   # Step 1：需求提取结果
                ├── step2_signals.md        # Step 2：信号提取结果
                ├── signals.json           # Step 2 token 在 config_车型.json 中命中的配置项
                ├── signals_id.json        # prop -> decimal/hex id 映射结果
                ├── can_trace_extracted_result.txt # CAN trace 解码后的信号值持续区间摘要
                ├── can_signal_summary.txt # CAN 信号摘要，供前端展示
                ├── extract.md             # 评论时间窗内且包含 prop id 的日志摘录
                ├── step4_android_qnx_input.md # Step 4 实际输入的 Android/QNX 筛选日志
                ├── step3_upper_summary.md  # Step 3：上层日志摘要
                ├── step4_android_qnx.md    # Step 4：Android/QNX 分析
                ├── pipeline-metrics.json   # 阶段耗时、Prompt 长度、证据完整性和最终状态
                ├── final_reply.md          # 最终 AI 结论
                └── stages.json             # 流水线阶段快照（含耗时）
```

**目录命名规则**：`sanitizeName(s)` 将 `/\\:*?"<>|` 替换为 `_`，限制 80 字符。  
**重新处理**：同一工单再次分析会覆盖原文件（无时间戳后缀）。  
**日志展开策略**：顶层日志包解压后，会继续递归展开其中的嵌套压缩文件；Android `aplog.*.gz`、QNX `Bosch-*.zip` 等文件会在展开后再参与日志搜集。  
**信号归一化策略**：AI Step 2 提取的 token 先在车型配置 JSON 中按 `prop`、`getSignals`、`setSignals` 建索引匹配，再统一收敛到 `prop`，最后用 proto `Property_ID` 枚举映射 decimal/hex id。  
**时间窗日志筛选**：路由优先从 Jira 评论中提取问题发生时间；若评论给出完整时间戳，则以评论时间范围筛日志；若只有时间点，则结合 trace 日期补全年月日并扩展短时间窗。只有评论缺失时间时，才回退到 trace 录制时间。筛出的 Android/QNX 文本既写入 `extract.md`，也作为 Step 4 的实际模型输入。  
**度量基线**：`pipeline-metrics.json` 是后续准确率和速度优化的统一观测入口；`scripts/build-golden-baseline.mjs` 会聚合所有 metrics，输出 `docs/golden-baseline/golden-baseline.json` 和 `golden-baseline.md`，其中 `golden-baseline.json` 供脚本比较，Markdown 供人工审阅。
**结构化证据边界**：完整 CAN / 日志 / Step 产物必须落盘保留；Token 预算只能裁剪模型输入，不能裁剪审计证据。结构化证据校验复用 `IssueValidationRun` 记录总体 advisory verdict，复用 `IssueValidationCheck` 记录每一条结构化断言的 expected / actual / message / evidenceSource / confidence，不引入后端数据库，也不改变 Jira 回填权限判断。

**Evidence Packet**：Step 5 前会生成结构化 Evidence Packet，文件位于 `log/{ruleGroupId}/{carModel}/{issueKey}/evidence-packet.json`。它由 `signals.json`、`signals_id.json`、CAN trace 摘要、日志筛选结果和时间窗组成，供最终结论 prompt、结构化校验和离线评测共用；旧历史票没有该文件时仍回退到 Phase 1 文本证据。
**统一复核样本池**：第一阶段在浏览器内按 Embedding/标题相似度召回同规则组样本，再以车型、prop、signal token 和 Property ID 重合混合排序；正样本必须满足车型或结构化证据门槛。共享处理路由使用当前 Evidence Packet 二次重排，最终最多保留 3 条，并按纠错/正确两个同优先级区块注入 Step 5。历史样本不能替代当前票证据。
**.gitignore**：`/jira-issues/**` 和 `/log/**` 已加入 .gitignore，目录本身由 `.gitkeep` 保持追踪。

### 4.5 数据持久化策略

```
┌─────────────────────────────────────────────────────┐
│                  数据存储分层                          │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  IndexedDB（客户端 - 主存储）                    │  │
│  │  • 所有业务数据存储在浏览器 IndexedDB 中           │  │
│  │  • 通过 Dexie.js 提供响应式查询                   │  │
│  │  • 支持离线访问历史数据                           │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  服务端临时存储（可选）                           │  │
│  │  • API Route 内使用内存 Map 缓存热数据            │  │
│  │  • MySQL 镜像（idb_records）：备份 / 恢复 / 团队汇总 │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  数据同步机制                                    │  │
│  │  • 写入：Store 在操作完成后写入 IndexedDB          │  │
│  │  • 读取：Zustand 状态 + IndexedDB 离线回退         │  │
│  │  • 冲突：Last-Write-Wins（单用户场景）            │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 5. 集成架构

### 5.1 Jira 集成

```
                    ┌─────────────────────────────┐
                    │      lib/core/jiraClient.ts   │
                    │  基于 fetch 的 Jira REST 封装  │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
   ┌──────────▼──────┐  ┌──────────▼──────┐  ┌─────────▼───────┐
   │  searchIssues   │  │ downloadAttach  │  │  addComment     │
   │  （JQL 查询）    │  │ （下载附件）     │  │  （回填评论）    │
   └─────────────────┘  └─────────────────┘  └─────────────────┘
```

- **认证**：Basic Auth（用户名+Token），配置在环境变量 `JIRA_BASE_URL` / `JIRA_TOKEN`
- **数据流向**：只读查询（search/download）+ 只写回填（comment）
- **错误处理**：fetch 异常被捕获后记录到任务状态，支持指数退避重试

### 5.2 Qwen AI 集成

```
lib/services/
    issueAnalysisService.ts
            │
            ▼
lib/core/qwenClient.ts
            │  OpenAI 兼容接口
            ▼
    ┌───────────────────┐
    │   Qwen API         │
    │  （通义千问大模型）  │
    │  dashscope.aliyuncs.com │
    └───────────────────┘
```

```typescript
// lib/core/qwenClient.ts 示意
import OpenAI from 'openai';

const qwenClient = new OpenAI({
  apiKey: process.env.QWEN_API_KEY,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

export async function analyzeIssue(context: IssueContext): Promise<AnalysisResult> {
  const response = await qwenClient.chat.completions.create({
    model: process.env.QWEN_MODEL || 'qwen-plus',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildAnalysisPrompt(context) },
    ],
    temperature: 0.1,
  });
  return parseAnalysisResponse(response.choices[0].message.content);
}

export async function reviewIssue(
  result: IssueProcessResult,
  fewShotExamples: FewShotExample[]
): Promise<ReviewResult> {
  const messages = buildFewShotMessages(fewShotExamples, result);
  const response = await qwenClient.chat.completions.create({
    model: process.env.QWEN_MODEL || 'qwen-plus',
    messages,
    temperature: 0,
  });
  return parseReviewResponse(response.choices[0].message.content);
}
```

- **SDK**：使用 OpenAI Node.js SDK（Qwen 兼容 OpenAI 接口）
- **配置**：环境变量 `QWEN_API_KEY` / `QWEN_MODEL` / `QWEN_BASE_URL`
- **调用模式**：
  - **分析推理**：System Prompt（角色定义）+ 工单上下文（Jira 字段 + CAN 信号数据）
  - **AI 复核**：使用 `VALIDATE_QWEN_MODEL` / `VALIDATE_API_KEY` 调用上下文更大的验证模型；Prompt 包含 Few-shot 示例、待复核结论、Jira 描述/评论/原始快照、CAN 信号摘要，以及 `log/<规则组>/<车型>/<IssueKey>/` 下 Step1-5、信号映射、日志筛选和最终回复文本
  - **学习记忆**：`IssueReviewSample` / `LearningMemory` 中的历史经验作为动态 Prompt 片段注入；Few-shot 召回优先通过 `EMBEDING_BASE_URL` / `EMBEDING_MODEL` / `EMBEDING_API_KEY` 调用 OpenAI 兼容 Embedding 服务，使用余弦相似度选择相似案例，Embedding 服务不可用时回退到标题 Token 重叠度
  - **prop/signal RAG**：Few-shot 召回文本由 issue summary 扩展为 evidence fingerprint，包含 rule group、车型、`prop`、signal token 和 Property ID；主分析模型、验证模型、Embedding 服务三者配置解耦，`EMBEDING_*` 拼写保持现状，Embedding 不可用时不能阻塞主流程

### 5.3 飞书集成

```
app/api/feishu/process-result/route.ts
        │
        ▼
飞书群机器人 Webhook（HTTP POST fetch）
        │
        ▼
卡片消息（单票处理结果）
```

- **触发时机**：单票处理成功、单票处理失败
- **配置**：环境变量 `NEXT_PUBLIC_FEISHU_WEBHOOK_URL`
- **消息格式**：飞书消息卡片（Interactive Card）JSON
- **图片说明**：自定义机器人 webhook 发送图片需要先上传图片获取 `image_key`。当前版本未接入应用级鉴权，因此若存在结果图片，只在卡片中附带可访问链接。
- **原票链接**：payload 可选 `issueUrl`（仅接受 http/https），作为卡片 markdown 最后一行「原票链接」展示；飞书项目处理通知由 `meegleProcessStore` 通过 `buildMeegleWorkItemUrl` 生成并附带，Jira 通知不附带。

### 5.4 Docupedia 集成

```
app/api/issues/process/route.ts
        │  success-only
        ▼
lib/server/docupedia.ts
        │
        ▼
Docupedia / Confluence REST API
```

- **触发时机**：单票处理结果为 `success` 后触发；`reject`、`failed` 和历史日志补传不触发。
- **上传范围**：仅当前处理上下文中的 `log/<规则组>/<车型>/<IssueKey>/`，不会扫描 `log/` 根目录，也不会检查之前未上传的日志。
- **开关配置**：`ENABLE_DOCUPEDIA=1` 开启成功票自动归档，`ENABLE_DOCUPEDIA=0` 关闭自动上传；未配置 `ENABLE_DOCUPEDIA` 时兼容旧的 `DOCUPEDIA_ENABLED` 开关。
- **页面结构**：沿用参考项目的 Docupedia 目标配置，默认 `DOCUPEDIA_BASE_URL=https://inside-docupedia.bosch.com/confluence2`、`DOCUPEDIA_SPACE_KEY=BCSCVC`，并通过 `DOCUPEDIA_PARENT_ID` 指定目标父页面；每次成功归档都会在目标父页面下创建 `meegle_<随机数>` 根页面。当前日志目录中 `stepN_` 开头且数字相同的可导入文本文件会合并为一个 `meegle_<随机数>_stepN` 子文章，正文按源文件名分段拼接；非 `stepN_` 文本文件仍按 `meegle_<随机数>_stepN_...` 标题创建文章，`input_comments.txt` 明确跳过，不再把 `log/<规则组>/<车型>/<IssueKey>/` 路径映射成 Docupedia 页面标题。子文章沿用根页面的随机前缀，避免 Docupedia 同空间标题重复导致创建失败。
- **鉴权配置**：支持 `DOCUPEDIA_AUTH=auto|cookie|bearer|basic|negotiate`，并读取 `DOCUPEDIA_COOKIE`、`DOCUPEDIA_TOKEN`、`DOCUPEDIA_USERNAME` / `DOCUPEDIA_PASSWORD`、`EMAIL` / `DAN_TEST` 等凭据；`auto` 模式下 `DAN_TEST` 按 Bearer token 使用，显式 `DOCUPEDIA_AUTH=basic` 时可用 `EMAIL` + `DAN_TEST` 组成 Basic 认证。Node HTTPS 请求会显式读取 `HTTPS_PROXY` / `HTTP_PROXY` / 小写代理变量，避免内网 Docupedia 连接绕过代理。
- **稳定性策略**：Docupedia 单个 REST 请求默认超时 180 秒，可通过 `DOCUPEDIA_REQUEST_TIMEOUT_MS` 调整；`socket hang up`、超时、连接重置、429 和 5xx 等瞬时错误会在页面 find-or-create 层默认重试 6 次。等待采用初始 3 秒、最多 60 秒的指数退避与 ±20% 抖动，可通过 `DOCUPEDIA_REQUEST_RETRIES`、`DOCUPEDIA_RETRY_DELAY_MS` 和 `DOCUPEDIA_RETRY_MAX_DELAY_MS` 覆盖；重试前会重新查询页面是否已创建，避免 POST 成功但响应断开时重复创建。根页面和目录页面失败会终止归档；单个日志文章最终失败会计入 `failed` 并继续上传后续文章。
- **运行可观测性与失败策略**：后台归档开始、每篇文章创建或确认已存在、以及单篇最终失败都会立即写入当前 run 的 `pipeline.log` 的 `DOCUPEDIA` 阶段，并由同一 `PipelineLogger` 输出到 Next.js 服务终端；上传失败不改变 `IssueProcessResult` 成功状态，`ENABLE_DOCUPEDIA=0` 可显式关闭归档，进程重启后仍不会恢复未完成上传。

### 5.5 CANtrace / Proto 集成

```
附件（ZIP 包）
    │  解压（JSZip）
    ▼
.blf / .asc / .trc（CAN 总线日志）
    │  scripts/plot_can_signals.js 调用 Python 解析目标信号，并使用 Playwright + Chart.js 离线绘制时序图
    │  目标信号只来自 Step 2 提取并匹配到的信号；候选池中的其他信号只落盘审计，不进入 CANtrace 回放或绘图
    │  前端详情页只使用后端返回的提取后 traceData 渲染交互式散点图，不读取候选池或审计文件补充系列
    │  用户锁定浏览器视口时，/api/issues/save-screenshot 按 chartImagePath 覆盖 log/.../can_signals.png
    │  /api/jira/comment 上传同一个 log/.../can_signals.png，确保 Jira 回填使用前端保存后的图
    │  .asc → Python ASCReader + 手工 CANFD fallback 解码
    │  .blf → Python BLFReader 解码
    ▼
信号时间序列（信号名 → 时间戳 → 值）
    │  lib/core/signalMapping.ts 映射
    ▼
关键信号提取

.proto 文件 + 二进制数据
    │  lib/core/protoUtils.ts 解析（protobufjs）
    ▼
结构化 protobuf 消息
```

### 5.5 解票准确率评测闭环

- **离线评测**：`scripts/eval-accuracy.ts` 回放 `log/<规则组>/<车型>/<票>/`，与在线 U3 共用五类具名可信证据源：`evidence_packet`、`can_signal_summary`、`can_trace_extracted_result`、`signals_id`、`extract`。两端复用 `computeGrounding()` 计算证据接地率 EGR；若 `docs/golden-baseline/eval-set.json` 配置了人工稀疏真值，则同步计算信号召回率与结论关键判断命中率。
- **Step 2 信号补救**：`buildSignalConfigMatches()` 的精确匹配保持不变；未命中的 token 先进入 `recoverFuzzyMatches()`，再进入一次受限 `recoverViaSelfCheck()`，模型只能从真实候选 `prop` 列表中选择或返回 `null`。`signals.json` 持久化 `matches`、`recovered`、`unmatched` 与 `messageCharacteristics`，`pipeline-metrics.json.counts` 记录 `recoveredMatches` 和 `unmatchedTokens`。
- **Step 5 证据自批判**：`runEvidenceSelfCritique()` 在 `final_reply.md` 落盘前复用 `computeGrounding()` 找出未接地断言，支持最多 3 轮迭代自愈修正，并引入接地率回滚保护（Rollback Guard）机制。失败时保留原结论，不阻断处理和 Jira 回填；修订过程及最终接地率写入 `evidence-grounding.json` 与 `pipeline-metrics.json.groundingBefore/groundingAfter`。

### 5.6 Phase 3 准确率评测可信度增强

Phase 3 在准确率闭环中增加评测集覆盖报告和真实时间窗判定。`scripts/eval-set-coverage.ts` 只读 `eval-set.json` 和本地 `log/`，输出覆盖报告，不自动修改人工真值；`lib/analysis/evidence-packet.ts` 负责计算 comment / trace 时间窗 overlap；`structured-evidence-validation.ts` 通过同一归一化证据索引支持时间、键值断言、标识符和 Property ID 匹配，并复用到在线自检和离线评测。证据源会先经过有效性校验：缺失来源写入 `missingEvidenceSources`，离线读取或结构化解析错误写入 `evidenceReadErrors` / `evidenceSourceErrors`；完全无法判定的结果标记为 `unknown_missing_evidence`，不进入平均 EGR 分母。Step 5 在结构化证据包生成后对 few-shot 案例做二段式 RAG 精召回 / 重排；在线校准、多轮批判修正与接地率回滚保护均为 advisory / non-blocking，失败时保留原结论，不阻断处理或 Jira 回填。

### 5.7 接地校准与时钟偏差（2026-10）

- **评测覆盖**：`scripts/eval-ticket-dirs.ts` 同时识别 Jira `log/<组>/<车型>/<票>/` 与飞书 `log/<组>/<车型>/meegle-<id>/<runId>/` 布局，每票取最新一次 run；`eval-accuracy` 与 `eval-set-coverage` 共用。
- **真值导出**：`npm run eval:export-truth [-- --owner admin] [--dry-run]` 读取 MySQL 镜像中的 `issueReviewSamples` 与 `ruleGroups`，按票取最新样本，用 `lib/analysis/eval-truth.ts` 生成 `eval-set.json` 条目（`source: "mysql-review-sample"`）：`expectedKeywords` 来自固定结论措辞（转对应模块 / 转对手件 / 再转给VHAL分析），`expectedSignals` 优先取样本信号标记，缺失时取结论中出现的信号名；车型目录由本地 `log/` 反查，找不到日志的样本跳过。手写条目优先且不会被改动，导出条目每次运行刷新。测试：`test/eval-truth.test.ts`。
- **补充证据源**：测试人员在评论中粘贴的 Android/QNX 日志属于真实证据。在线 U3 与离线评测通过 `withSupplementalCommentSource()` 追加 `input_comments` 源；仅当五类核心源中至少一个有效时才追加，不改变“缺证据 → unknown”的语义。
- **匹配容差**：秒级时间断言可匹配同一秒内的毫秒级证据（带小数的断言仍需精确）；支持 `Name X val 3` 键值写法；信号短名（≥6 位字母数字、不含下划线）可按 `_<短名>` 后缀匹配完整信号名。
- **批判修正保护**：`runEvidenceSelfCritique` 只处理列出的未接地断言，并丢弃“已接地断言数少于原文”的修订，防止靠删除正确内容抬高接地率。
- **时钟偏差**：`detectClockOffsetHours()` 在评论窗与 trace 窗不重叠时，尝试 ±1..12 整小时平移（±60 s 容差），平移后完全落入 trace 窗即判定为疑似时钟偏差（常见 UTC 与北京时间相差 8 小时）。证据包写入 `timeWindow.suspectedClockOffsetHours` 与 `suspected_clock_offset` 风险标记；Step 5 按偏差对齐并在结论中声明该假设；错误归因不再记为 `time_window_mismatch`。离线评测对旧证据包按同一规则补算。

### 5.8 IndexedDB 服务器镜像（MySQL）

- **定位**：IndexedDB 仍是主存储；MySQL 是自托管镜像，用于换机/清缓存恢复、多浏览器合并和团队汇总。连接由 `.env` 的 `MYSQL_URL`（`mysql://user:pass@127.0.0.1:3306/jira_analyzer_next`）配置，首次访问自动建库建表；未配置时 `/api/backup/status` 返回 `configured=false`，前端只提供文件备份。
- **存储模型**：通用表 `idb_records(owner, table_name, record_id, data LONGTEXT, deleted, client_id, backup_run_id, updated_at)`，主键 `(owner, table_name, record_id)`；`idb_sync_clients` 记录每个浏览器的最近推送和完整备份时间。记录 JSON 由 `lib/db/backup-format.ts` 序列化（Date 编码为 `{"$date": ISO}`），与 Dexie schema 版本解耦，新增表只需加入 `BACKUP_TABLES`（测试会校验与 `AnalyzerDB` 一致）。
- **接口**：`GET /api/backup/status`、`POST /api/backup/push`、`POST /api/backup/finalize`、`GET /api/backup/pull`（按 `record_id` 游标分页）。owner 取服务端 session 的 `username`，前端不能指定，账号之间互相隔离。
- **浏览器同步**（`lib/db/backup.ts`）：`NavBar` 登录后调用 `installAutoSync()`，在全部表上注册 Dexie `creating/updating/deleting` 钩子，成功提交后把 `(表, id)` 加入待推送队列（持久化到 localStorage）。3 秒去抖后 `bulkGet` 读取当前值：存在则 upsert，不存在则软删除。按约 2 MB 分批，失败 60 秒后重试，页面隐藏时立即推送。
- **完整备份**：带 `backupRunId` 上传全部记录，然后 `finalize` 只把“本浏览器（`client_id`）在本次开始前上传、本次未上传”的记录标记删除，避免同账号不同浏览器互删。
- **恢复**：分页拉取并默认只补齐本地缺失记录（可选覆盖）；恢复期间抑制钩子，不会回推。
- **边界**：同步失败只显示提示，不影响分析、复核、回填；不做跨账号读取，也不做冲突合并（以最后写入为准）。

#### 5.8.1 镜像库结构（`jira_analyzer_next`）

镜像库不按业务建 25 张表，而是用一张通用表保存 IndexedDB 的“一条记录 = 一行”。因此弹窗中的“服务器记录数”是**当前账号所有 IndexedDB 表的记录总行数**（不含软删除），不等于票数。

**`idb_records`：IndexedDB 记录镜像**

| 列 | 类型 | 含义 |
|----|------|------|
| `owner` | VARCHAR(128) | 登录账号（session `username`），由服务端决定，用于隔离 |
| `table_name` | VARCHAR(64) | 来源 IndexedDB 表名，如 `meegleProcessResults` |
| `record_id` | VARCHAR(255) | 该记录在 IndexedDB 中的主键 `id` |
| `data` | LONGTEXT | 整条记录的 JSON（Date 编码为 `{"$date": ISO}`）；已删除时为 NULL |
| `deleted` | TINYINT(1) | 软删除标记，1 = 本地已删除；恢复和计数都排除 |
| `client_id` | VARCHAR(64) | 最后写入该行的浏览器（localStorage 中的随机 UUID） |
| `backup_run_id` | VARCHAR(64) | 最近一次完整备份批次号，增量推送为 NULL；完整备份收尾时用于判断哪些记录本次未上传 |
| `updated_at` | DATETIME(3) | 服务器最后写入时间 |

主键为 `(owner, table_name, record_id)`，同一账号同一记录只有一行，多次推送是覆盖（upsert）；另有索引 `idx_owner_updated (owner, updated_at)`。

**`idb_sync_clients`：浏览器同步状态**

| 列 | 含义 |
|----|------|
| `owner` + `client_id`（主键） | 账号 + 浏览器 |
| `last_push_at` | 该浏览器最近一次推送时间 |
| `last_full_backup_at` | 该浏览器最近一次完整备份完成时间 |

**`table_name` 取值与含义**（来自 Dexie `AnalyzerDB`，清单见 `BACKUP_TABLES`）

| 类别 | 表 | 含义 |
|------|----|------|
| 配置 | `ruleGroups`、`autoCycleStates` | 规则组；自动循环调度状态 |
| Jira 筛票 | `filterTasks`、`filteredIssueSnapshots` | 每次 JQL 筛票任务（含定时自动筛票，数量增长最快）；筛中票据快照 |
| Jira 处理 | `issueProcessTasks`、`issueProcessResults`、`issueAnalysisHistories` | 单票处理任务；AI 结论与复核/回填状态；被重跑覆盖前的历史结论 |
| Jira 校验 | `issueValidationRuns`、`issueValidationChecks` | 每次结构化证据校验；其中每条断言的检查明细 |
| 飞书筛票 | `meegleFilterTasks`、`meegleFilteredIssueSnapshots`、`meegleFilterAudits`、`meegleAssignments` | 筛选任务；筛中工作项快照；逐项命中/未命中审计；工作项分配到规则组 |
| 飞书处理 | `meegleIssueSnapshots`、`meegleProcessTasks`、`meegleProcessResults`、`meegleAnalysisHistories` | 处理时快照；处理任务；AI 结论与复核/评论/流转状态；历史结论 |
| 飞书校验 | `meegleValidationRuns`、`meegleValidationChecks` | 同 Jira 校验 |
| 学习与准确率 | `issueReviewSamples`、`learningMemories` | 人工复核正/负样本（RAG 与评测真值来源）；学习记忆 |
| 对话与知识 | `knowledgeDocs`、`chatMessages`、`memories`、`notes` | 知识库文档（含分段向量，体积最大）；对话历史；对话记忆；笔记 |

**如何解读记录数（2026-10-20 admin 账号，共 11080 行）**：其中筛票过程记录占大头，`filterTasks` 3017、`meegleFilterTasks` 1798、`meegleFilterAudits` 980，大部分来自自动循环筛票。校验明细有 `meegleValidationChecks` 1353 和 `issueValidationChecks` 875。真正的分析结论只有 `issueProcessResults` 120 与 `meegleProcessResults` 200，人工复核样本 `issueReviewSamples` 101。按体积，`knowledgeDocs`（约 31 MB，含向量）和 `meegleProcessResults`（约 17 MB）最大。

常用查询：

```sql
-- 当前账号各表记录数
SELECT table_name, COUNT(*) FROM idb_records WHERE owner = 'admin' AND deleted = 0 GROUP BY table_name;
-- 团队各成员的人工复核样本
SELECT owner, COUNT(*) FROM idb_records WHERE table_name = 'issueReviewSamples' AND deleted = 0 GROUP BY owner;
-- 读取一条飞书结论
SELECT JSON_EXTRACT(data, '$.replyText') FROM idb_records WHERE table_name = 'meegleProcessResults' AND record_id = '<id>';
```

---

## 6. 关键技术决策

### 6.1 选用 IndexedDB 而非 SQLite / PostgreSQL

**决策**：使用浏览器原生 IndexedDB 作为主存储。  
**理由**：
- 无需独立数据库服务，纯前端部署即可工作
- Dexie.js 提供类 ORM 的查询体验和响应式监听
- 支持离线访问和大容量数据存储
- 工单分析场景单用户使用，不存在并发写入冲突

**权衡**：多设备同步需额外实现。现已在 API Route 层加挂 MySQL 作为服务端镜像（见 §5.8），IndexedDB 仍是主存储；必要时可使用 SQLite / MySQL / PostgreSQL 等服务端数据库。

### 6.2 Next.js 全栈而非前后端分离

**决策**：使用 Next.js App Router 统一前后端。  
**理由**：
- 减少仓库和部署单元数量（一套代码、一个进程）
- Server Components 减少客户端 JavaScript 体积
- API Routes 提供完整的服务端能力（Jira 调用、AI 请求等需要服务端执行）
- TypeScript 全栈类型安全，共享类型定义

### 6.3 Promise 异步而非消息队列

**决策**：使用 Node.js 原生 Promise + p-limit 替代 Celery/BullMQ。  
**理由**：
- 部署简单，不引入 Redis 等外部依赖
- 任务量中低，单进程异步即可满足
- 任务状态持久化在 IndexedDB / 内存 Map，进程重启可恢复

**潜在风险**：Serverless 部署时长时间任务可能超时，需改用 Edge Runtime 或外部任务队列。

### 6.4 本地状态刷新

**决策**：任务状态通过 Zustand 与 IndexedDB 管理，页面在用户操作完成、重新进入页面或本地调度触发后刷新状态。
**理由**：
- 当前是单用户本地工具，任务状态主要服务当前浏览器会话；
- 服务端主动推送曾导致前台频繁刷新，收益低于复杂度；
- 本地状态和持久化恢复已能覆盖首页、规则组详情和单票详情的主要使用场景；
- 减少服务端连接维护、代理配置和部署复杂度。

### 6.5 shadcn/ui 而非 Ant Design / Material UI

**决策**：使用 shadcn/ui 作为 UI 组件库。  
**理由**：
- 组件源码直接复制到项目中，完全可控可定制
- 基于 Radix UI 无障碍原语，体验和可访问性兼备
- Tailwind CSS 驱动样式，与 Next.js 生态完美契合
- 无全局 CSS 冲突，Tree-shaking 友好
- 设计语言简洁克制，适合工具型产品

### 6.6 dnd kit 拖拽排序

**决策**：使用 dnd kit 实现规则组和任务卡片排序。  
**理由**：
- React 生态中性能最好的拖拽库，支持虚拟化长列表
- TypeScript 原生支持，类型推导完整
- 支持键盘排序（无障碍）和触摸设备
- 排序后自动更新 IndexedDB 中的 `sortOrder` 字段

---

## 7. 部署架构

### 7.1 推荐部署模式（Vercel / Node.js 服务器）

```
┌────────────────────────────────────────────────────────┐
│                    部署方案 A：Vercel                    │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Vercel Edge Network（CDN + 边缘节点）              │  │
│  │  • 静态资源全球加速                                 │  │
│  │  • Server Components 边缘渲染                      │  │
│  └───────────────────┬──────────────────────────────┘  │
│                      │                                  │
│  ┌───────────────────▼──────────────────────────────┐  │
│  │  Serverless Functions（API Routes）                │  │
│  │  • 筛票/分析/复核 API                              │  │
│  │  • 注意：长时间任务需使用 Vercel Functions 配置      │  │
│  └───────────────────┬──────────────────────────────┘  │
│                      │                                  │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│                  部署方案 B：自托管 Node.js              │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Nginx（反向代理 + 静态文件缓存）                    │  │
│  │  • /*  → Next.js 服务                             │  │
│  └───────────────────┬──────────────────────────────┘  │
│                      │                                  │
│  ┌───────────────────▼──────────────────────────────┐  │
│  │  Node.js 进程（next start）                       │  │
│  │  • SSR + API Routes                              │  │
│  │  • 建议：PM2 守护进程管理                          │  │
│  └───────────────────┬──────────────────────────────┘  │
│                      │                                  │
│  ┌───────────────────▼──────────────────────────────┐  │
│  │  客户端 IndexedDB（数据持久化在用户浏览器）          │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### 7.2 关键配置

| 配置项 | 位置 | 说明 |
|--------|------|------|
| `JIRA_BASE_URL` | `.env.local` | Jira Server 地址 |
| `JIRA_USERNAME` | `.env.local` | Jira 用户名 |
| `JIRA_TOKEN` | `.env.local` | Jira API Token |
| `QWEN_API_KEY` | `.env.local` | 通义千问 API Key |
| `QWEN_MODEL` | `.env.local` | 模型名（默认 qwen-plus） |
| `QWEN_BASE_URL` | `.env.local` | API 地址（默认 dashscope） |
| `NEXT_PUBLIC_FEISHU_WEBHOOK_URL` | `.env.local` | 飞书群机器人 Webhook |
| `ENABLE_DOCUPEDIA` | `.env.local` | 可选；设为 `1` 时开启处理成功后的 Docupedia 归档，设为 `0` 时关闭自动上传；未设置时兼容旧 `DOCUPEDIA_ENABLED` |
| `DOCUPEDIA_BASE_URL` / `DOCUPEDIA_SPACE_KEY` / `DOCUPEDIA_PARENT_ID` | `.env.local` | Docupedia 目标空间与父页面；默认沿用参考项目域名和空间，父页面可通过环境变量覆盖 |
| `DOCUPEDIA_AUTH` / `DOCUPEDIA_COOKIE` / `DOCUPEDIA_TOKEN` | `.env.local` | Docupedia 鉴权模式与凭据；也支持 basic 和 negotiate |
| `DOCUPEDIA_REQUEST_TIMEOUT_MS` / `DOCUPEDIA_REQUEST_RETRIES` / `DOCUPEDIA_RETRY_DELAY_MS` / `DOCUPEDIA_RETRY_MAX_DELAY_MS` | `.env.local` | Docupedia 请求稳定性配置；默认单请求 180 秒超时、瞬时错误重试 6 次、初始等待 3 秒、最大等待 60 秒并使用指数退避和 ±20% 抖动 |
| `AUTH_SECRET` | `.env.local` | 可选 Session Token HMAC 签名密钥；账号信息固定读取 `docs/login.json` |
| `next.config.ts` | 项目根目录 | Next.js 构建与运行时配置 |
| `tailwind.config.ts` | 项目根目录 | Tailwind 主题与 shadcn/ui 配置 |
| `components.json` | 项目根目录 | shadcn/ui CLI 配置 |

### 7.3 项目初始化命令

```bash
# 创建项目
npx create-next-app@latest jira-analyzer-web --typescript --tailwind --eslint --app --src-dir

# 安装 shadcn/ui
npx shadcn-ui@latest init

# 安装 shadcn/ui 组件
npx shadcn-ui@latest add button card dialog input select textarea scroll-area separator

# 安装依赖
npm install dexie @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install openai zod zustand @tanstack/react-query
npm install -D @types/node
```

### 7.5 未来扩展方向

```
当前全栈单体架构
        │
        ▼
（当需要多用户 / 数据持久化 / 团队协作）
        │
        ├──▶ 已完成第一步：MySQL 镜像（§5.8），IndexedDB 仍为主存储
        │
        ├──▶ 进一步可引入 Prisma + MySQL/PostgreSQL 作为服务端主存储
        │      • 支持多用户数据隔离
        │      • 保留 IndexedDB 作为离线缓存层
        │
        ├──▶ 引入 BullMQ + Redis 替换 Promise 异步队列
        │      • 支持任务重试、优先级队列、持久化
        │      • Serverless 部署时解决超时限制
        │
        ├──▶ 引入 NextAuth.js 认证
        │      • 支持多用户登录和权限管理
        │
        └──▶ 容器化部署（Docker）
               • next + nginx 各为独立容器
               • docker-compose 一键启动
```

---

## 环境变量

项目需要以下环境变量：

- QWEN_API_KEY
- QWEN_MODEL

- BASE_URL 用于指定 API 请求的基础 URL，默认为 `http://wx8vm00001.apac.bosch.com:30001`，可根据实际部署环境调整。

QWEN_API_KEY 用于访问 Qwen API。

QWEN_MODEL 用于指定调用模型。

默认示例：

- Qwen3-32B-FP16

实际模型 ID 以 Qwen 控制台当前可用模型为准。


### Bosch Jira（Atlassian Cloud）

- `BOSCH_JIRA_URL`、`BOSCH_JIRA_USERNAME`、`bosch_jira_api_token`（兜底 `BOSCH_JIRA_PASSWORD`）用于 Bosch Jira 规则组。
- `lib/server/jira-connection.ts` 按 `jiraProvider` 解析服务地址、Basic 凭据与搜索方式；`/api/jira/filter`、`/api/jira/comment`、`/api/issues/process` 和经办人接口都接收 `jiraProvider`（经办人 GET 使用 `?provider=bosch`），缺省沿用 `JIRA_SERVER` 等原变量。
- Bosch 筛票使用 `POST /rest/api/2/search/jql` 并以 `nextPageToken` 翻页（最多 20 页 × 100）；评论、附件、指派使用 v2 接口，描述与评论为纯文本，无需 ADF 转换；Cloud 指派使用 `accountId`。
- 附件下载按 URL 主机匹配对应凭据，Cloud 的 303 跳转到 `api.media.atlassian.com` 时不再携带凭据。
- `RuleGroup.jiraProvider` 存于 IndexedDB 规则组，不改 schema 版本（非索引字段）。

## 不允许引入的内容

必要时允许引入服务端数据库（SQLite / MySQL / PostgreSQL，可配合 Prisma 等 ORM）；当前采用本地 Docker MySQL 作为 IndexedDB 的服务端镜像（§5.8）。第一版仍不要引入：

- Supabase
- Firebase
- NextAuth
- 云同步（团队协作已放开，基于现有登录与 MySQL 镜像，见「团队模板库」）

## 共享 CAN 图表架构（v3.43）

`components/analysis/CanSignalChart.tsx` 是 Jira 与飞书项目结果详情的统一 CAN 可视化边界。`components/analysis/CanSignalChartClient.tsx` 以 `next/dynamic` 的 `ssr: false` 提供浏览器加载边界，防止 Chart.js 缩放插件在 Next.js 服务端读取 `window`；业务详情页只引用该边界，并传入持久化的 `traceData`、`ticks`、`chartImagePath` 和 `signalSummary`。共享组件负责 Chart.js 实例生命周期、多图 X 轴联动、缩放/平移、截图合成以及静态图片降级。

服务端静态图仍由 `scripts/plot_can_signals.js` 调用 Python 解码后使用 Playwright + Chart.js 生成。Node 页面和 Python fallback 都只在 DBC choices 覆盖真实数据范围时使用离散 Y 轴刻度；Playwright 页面错误或图表实例数量不符时不得把空白截图视为成功，而应保留可用的 Python 图。

## 首页对话与知识库侧栏

`components/chat/ChatSidebar.tsx` 由 `KanbanBoard` 控制显隐。知识库（`knowledgeDocs`，含分段与向量）与对话历史（`chatMessages`）存于 IndexedDB（Dexie v10）；检索在浏览器端完成（`lib/knowledge/retrieval.ts`，余弦相似度，无向量时关键词回退），仅将命中片段与近 10 条历史发给 `POST /api/chat`，该路由用 `callQwen` 生成回答并去除 `<think>` 内容，受现有会话鉴权保护。

**记忆与笔记（Dexie v11）**：新增 `memories`、`notes` 表，并给 `chatMessages`、`knowledgeDocs` 增加 `userId` 索引，所有读写按 `/api/auth/session` 返回的 `username` 过滤。记忆管线在浏览器端 `lib/knowledge/memory-service.ts`：`POST /api/memory`（`extract` 抽取、`decide` 判定 ADD/UPDATE/NOOP）+ 本地余弦相邻检索 + 衰减排序（`memory-core.ts`）。笔记分段向量存于笔记记录，未归档笔记并入知识库检索。`/api/chat` 另接收 `memories` 并读取服务端 session 注入当前用户信息。

**历史导入**：`lib/knowledge/import-history.ts` 读取 `issueProcessResults`、`meegleProcessResults`、`issueReviewSamples`，生成确定性 id（`import:<user>:<类型>:<id>`）的 `knowledgeDocs`，分段并批量向量化，重复导入覆盖。

### 经办人接手时间（可选）

- `STATISTICS_SOLVE_TIME_USERS`：目标经办人姓名列表，格式 `[HUANG Hongwei, DAI Yungui]`（逗号分隔，不区分大小写、子串匹配姓名）。Jira 按 changelog 中 assignee 的显示名匹配；飞书把变更记录里出现过的 user_key 经 `user search` 解析成姓名后匹配。未配置则不计算接手时间。
- `MEEGLE_ASSIGNEE_ROLE_KEY`：飞书经办人角色 key 后缀，默认 `role_b43b38`。

## 团队模板库

- 格式与校验：`lib/templates/rule-group-template.ts`（纯函数）：`buildTemplate`、`parseTemplate`（校验并规范化文件/接口输入，抛中文错误）、`templateToRuleGroupInput`、`configChecksum`（FNV-1a，仅用于判断配置是否变化）。`schemaVersion` 目前为 1，更高版本拒绝导入。
- 存储：`lib/server/team-templates.ts` 在同一 MySQL 库建表 `team_templates(template_key, version, name, description, tags, author, config, checksum, apply_count, deleted, created_at)`，主键 `(template_key, version)`；每个版本一行，列表取每个 key 的最新未删除版本。发布时版本由服务端递增，校验和相同则幂等；作者校验：他人占用的 key 只有管理员可更新。
- 接口（均需登录 + `MYSQL_URL`）：`GET/POST /api/templates`、`GET/DELETE /api/templates/[key]`、`POST /api/templates/[key]/applied`。
- 前端：`components/templates/TemplateLibraryDialog.tsx`，应用时调用 `ruleGroupStore.addRuleGroup`（总是新建规则组，写入 IndexedDB，不覆盖）。
- 统计报告：`lib/analysis/weekly-report.ts` 的 `buildStatisticsReport` 生成 Markdown，由统计弹窗复制。
- 测试：`test/team-templates.test.ts`（格式、校验、报告；配置 `MYSQL_URL` 时含真实库集成）。

## 结构化驳回原因与按原因检索

- `lib/analysis/reject-reasons.ts`：类型常量与复核要点、关键词推断（历史数据）、`validateRejectInput`、`formatRejectReason/parseRejectReason`、`summarizeErrorPatterns`、`categoryShares`。
- `errorCategory` 非索引字段，加在 `IssueProcessResult / IssueReviewSample / IssueAnalysisHistory / MeegleProcessResult(+历史)` 上，无需 Dexie 升级。
- `fetchFewShotSamples`（processTaskStore）在 embedding 排序后调用 `rankReviewSampleCandidates`，新增 `categoryPrior / focusCategories / onlyCategories / maxPerCategory`；`fetchErrorPatterns` 汇总历史驳回类型，随 `ProcessRequest.errorPatterns` 发往 `/api/issues/process`。
- 服务端用 `buildErrorPatternBlock` 生成 `<历史错误模式>`，只信任类型代码与数值，标签与要点取自服务端常量，防止请求体注入提示词；该段加入 Step5 的 `buildStep5MergedPrompt` 分段，随预算裁剪。
- UI：共享组件 `components/analysis/RejectReasonPicker.tsx`，用于 Jira 改判对话框与飞书结果详情。

## 台架 / 实车场景

- `lib/analysis/issue-scene.ts`（纯函数）：`detectIssueScene(summary)` → `bench | vehicle | undefined`；`filterBySameScene` 召回过滤；`buildIssueScenePromptBlock` 场景提示块；`applyIssueSceneReplyTag` 结论前缀（幂等）。
- 不新增存储字段：场景总是由标题实时推导，历史样本与结果无需迁移。`IssueReviewSample.issueSummary` 缺失的样本在有场景的票中不会被召回。
- 召回点：`stores/processTaskStore.ts` 的 `fetchFewShotSamples` / `fetchErrorPatterns`（含规则组错误类型先验）与 Jira/飞书 `aiReview` 样本；服务端 `app/api/issues/process/route.ts` 入口兜底过滤 `fewShotSamples` 并在 Step 5 合并提示中以 `trimPriority: 0` 注入 `<问题场景>`。
- UI：`components/analysis/IssueSceneBadge.tsx`；标注工作台 `/api/labeling/items?scene=bench|vehicle|none|all`，Jira 条目标题取自镜像中 `filteredIssueSnapshots.summary`（按 issueKey）。

## 数据标注工作台

- `lib/labeling/schema.ts`：标签定义、`validateAnnotation`、`suggestLabels`、`toExportRecord`（纯函数）。
- `lib/server/labeling.ts`：MySQL 表 `labeling_annotations`（自动建表，主键 owner+item_id，`revision` 递增）；条目来自 `idb_records` 中 `issueProcessResults / meegleProcessResults`，用 `JSON_EXTRACT` 只取必要字段，避免加载图表大字段。条目 ID 为 `jira:<id>` / `meegle:<id>`。
- 接口 `/api/labeling/{items,items/detail,annotations,export}`；页面 `app/labeling` + `components/labeling/LabelingWorkbench.tsx`，首页工具栏有“数据标注”入口。

## 团队统计

- 记录提取：`lib/analysis/statistics-records.ts` 的 `buildStatisticsRuns()` 把六张表（Jira/飞书的结果、历史、快照、分配）转为 `StatisticsRun`，浏览器端 `loadAnnualStatistics` 与服务端共用同一份逻辑。
- 服务端：`lib/server/team-statistics.ts` 用 `JSON_EXTRACT` 从 `idb_records.data` 只投影统计所需字段（Date 编码为 `{"$date": ISO}`），按 `owner` 分组；`lib/analysis/team-statistics.ts` 对每个账号调用 `calculateAnnualStatistics`，再用 `mergeAnnualStatistics` 汇总。接口 `GET /api/statistics/team?year&startMonth&endMonth`（需登录，只返回聚合数字）。
- 前端：`AnnualStatisticsDialog` 增加「我的 / 团队」切换与成员明细表。

## 测试体系

- **统一入口**：`npm test`（= `vitest run`），配置见 `vitest.config.ts`（`@` 别名、自动加载 `.env`）。`npm run vitest` 进入 watch 模式。
- **原生用例**：新增测试一律写成 `test/*.test.ts`（如 `eval-truth.test.ts`、`backup-format.test.ts`；后者的 MySQL 集成用例在未配置 `MYSQL_URL` 时自动跳过）。
- **遗留脚本桥接**：`test/legacy-scripts.test.ts` 并发执行 `package.json` 中全部 `test:*` 脚本，以及没有 npm 入口的 `scripts/check-*.mjs`，每个脚本是一个独立用例。`test:perf:security` 依赖本地真实 `log/` 数据，已排除。
- **约定**：测试只断言代码行为和 docs 中的产品约定，不断言 `session-handoff.md` 的文字（它是每轮会被改写的日记）。

### 自动周期与数据管理续接实现

`features/workflow/auto-cycle-service.ts` 使用 IndexedDB 事务领取每组的运行租约，网络筛票与处理在事务外进行；同组存在运行任务时跳过启动。跨标签页通过 token 协调，过期租约在两小时后可重新领取。处理队列实际出队时再次读取周期开关和 token，避免关闭后启动排队工单；周期结束按当前间隔安排下一轮，不重置用户关闭状态。AppShell 中的 WorkflowRuntime 统一轮询任务恢复和自动周期。

`features/data-management` 组装备份和迁移界面。writeTables 在一个跨表事务中写入；镜像恢复先拉取全部表，再原子写入，拉取中断不改变本地。Dexie hooks 仅在事务提交后安排镜像同步，回滚不能生成删除队列。首次自动同步只增量补齐本地 ID；完整备份 finalize 必须由明确操作触发。管理员 `GET /api/migration/legacy?preview=1` 仅执行只读预检；实际服务端迁移按批次合并，可在失败后重复续迁，当前不保证整库事务原子性。

### 标注客户端分层

`app/(app)/labeling/page.tsx` 仅组装 `features/labeling`。工作台负责筛选与选择，详情以账号/条目身份隔离异步请求和编辑器；`service.ts` 使用统一请求封装，保存前复用 `domain/labeling/schema.ts`，JSONL 保持原始文本，失败不触发下载。

独立标注仍由既有 MySQL `labeling_annotations` 保存，不改写 IndexedDB 分析结果或 `sync_records` 原始数据。未提交草稿仅在 sessionStorage 临时保存，键包含账号与条目，携带草稿格式版本与原标注内容基线，基线变化不自动恢复；已保存业务数据仍以现有 MySQL 标注 API 为准。组件切换取消过期结果，保存/撤销期间阻止切换；正常站内链接经过草稿确认，历史返回通过暂存恢复，不修改 Next.js 历史栈。

### OpenAPI 与本地文档资源

`server/openapi` 管理迁移后的基础描述、当前契约修订与明确的请求 schema，`app/api/openapi` 和 `app/api/docs` 仅返回 JSON 与 HTML。Swagger UI 从 `swagger-ui-dist` 的本机安装读取，`docs/assets/[file]` 只允许固定 JS/CSS 名称；不拼接用户路径，不读取运行数据，不向外部校验器发送规格。路由与方法全集测试将规格和 `src/app/api/**/route.ts` 对照；另检查引用、路径参数、Cookie鉴权、角色及标注/模板示例的领域合法性。

### 终端客户端与Gateway关联

`app/(app)/terminal` 只组装管理员工作台。`features/terminal` 拆分配置请求校验、命令生成/文件解析、文件读写、串行SessionClient、xterm生命周期、每标签工作区与Repo面板。xterm在浏览器挂载后动态导入；隐藏标签保持挂载与会话，销毁时释放socket、监听器、resize观察器和定时器。

`domain/terminal/context.ts` 统一生成包含项目名、mainPath、scriptPath、分支及全部repo身份的contextKey。结构化Client/Server消息新增可选requestId，返回状态、Git、配置与下载回显；自动输入后刷新无requestId但带contextKey。旧字段保持兼容，新客户端仅接受自身关联响应，因此更新客户端时需同时更新Gateway。队列一次发送一个结构化请求，连接和有副作用的操作超时关闭会话，避免把迟到成功归给后续动作；只读扫描/状态查询超时清空队列并保留 PTY，迟到响应仍按 requestId 丢弃。

Gateway按session串行处理输入和审计，将普通多行输入逐行检查；阻止命令或审计失败时取消PTY残留输入。SSH连接建立前后均检查manager是否关闭，失败/关闭时释放晚到channel。逐文件Git操作在网络前校验非空相对路径与仓库归属，使用literal pathspec与选项分隔；护栏仍是现有命令模式匹配，不是隔离shell，访问权限继续由管理员会话和SSH账号提供。

### 指定票号分析编排

`features/direct-analysis/service.ts` 校验票号、精确读取同站点Jira工单、调用领域车型匹配并复用 `features/tickets/services/process.ts`。统一process现在返回实际ProcessTask（或未启动时undefined），调用方据此显示失败而不把已吞入生命周期的API失败误当成功。相同页面相同站点/票号共享promise，跨标签页沿用task事务门禁；出队前核对捕获的完整分析配置签名。

直接分析快照为origin=process，无filterRunId，附非索引可选analysisTrigger=direct，无schema版本变化。最近入口在单一只读事务关联snapshot/task/group，不修改处理或筛票数据。

Jira的inflight键、task门禁、归档及最终提交比较快照中的不可变provider；详情与候选项也按provider分组，ticketHref传递provider查询参数。即使原组配置后来切换站点，同名票的分析与历史仍分别保留。无显式provider的旧记录保留按原组推断的兼容边界，不能凭新参数为已丢失的原来源补写证明。

### Jira运行产物与复核证据

`createProcessContext` 对带runId的所有来源使用独立日志子目录并拒绝重复runId；Meegle附件仍按run隔离，Jira附件按jira-default/jira-bosch隔离并保留同站点缓存复用。无runId旧调用保留原目录兼容，不能把这一路径视为跨站点隔离证明。

ProcessResponse/ProcessResult新增非索引可选analysisRunId和analysisGroupName（分析时目录名），由服务端确认后回传；客户端落库时与当前task.id核对。AI复核仅在服务端曾返回运行身份时提交runId，新结果按不可变分析目录名精确读取相应票/run子目录，不依赖后续规则组名称，找不到返回404，不能读到旧父目录证据。旧结果不虚构runId，原有无run请求仍兼容票目录。Meegle继续使用签名artifactRef，客户端补齐meegle-工单前缀；本轮没有新增云存储或Jira后台恢复API。

## 当前统计身份实现（2026-10-28）

`src/domain/analysis/statistics-records.ts` 统一提取当前模型的统计运行。飞书结果通过 snapshotId、历史通过 sourceSnapshotId 关联分析原快照；其次使用 assignmentId 关联分配。完整身份采用项目、类型、字符串化工作项 ID 的元组，避免不同项目或类型中的同号被合并；身份不可用时保留分配 ID 回退及无分配旧记录的兼容边界。

`features/statistics/load-local-statistics.ts` 在单一 Dexie 只读事务中读取结果、历史、快照、分配四表。`server/statistics/team-statistics.ts` 从 sync_records 投影关联 ID 和最小身份字段，按 owner 建立独立上下文；身份行不按统计时间截断，因为创建时间可能早于分析范围。接口仍只返回聚合数字，不返回工单内容，无 schema 升版。

## 团队模板的共享配置校验（2026-10-28）

`src/domain/rule-groups/model-files.ts` 提供统一车型文件 schema 与解析函数，规则组备份导入及团队模板解析共同复用，避免模板直接把任意对象断言为 ModelFileConfig 后保存。模板保留自己的元信息、提示词白名单与配置 checksum，不引入新数据库或 schema 版本。

模板删除由 ConfirmDialog 接收真实失败，不能再经过吞掉异常的 useAction 后误关对话框；其他操作继续沿用现有 UI / 服务 / 领域分层。应用计数失败不回滚已经创建的本地规则组。

## 智能助手的运行与持久化边界（2026-10-28）

`features/chat/lib/chat-runtime.ts` 维护当前标签页内按 userId 分开的运行状态、AbortController 与订阅。ChatPanel 用 useSyncExternalStore 观察运行，用统一 useAsync 读取 IndexedDB 消息；抽屉卸载不拥有请求生命周期。消息提交后 version 递增，重开抽屉和后台完成均重新读取持久数据。同账号同标签页只有一个正在执行的发送，跨标签页不新增调度或租约。

`conversation.streamChat` 解析 NDJSON，必须收到 done 才接受最终回复；停止或错误释放 reader，部分增量不作为成功落库。运行服务在检索和模型返回后检查取消信号，晚到响应不能启动后续分析、保存成功助手消息或抽取记忆。文档、未归档笔记和记忆的上下文组装仍独立于 UI。

`notes-service` 在事务外进行向量化，然后在短 Dexie 写事务内比较原记录和当前记录，只有基线一致才提交；NoteEditor 同时提交打开时原始基线，检测另一标签页的编辑或删除。四类孤儿记录认领使用同一跨表事务；不增加 schema 或新数据库。

## 当前运维与评测分层（2026-10-28）

完整入口审计发现 package.json 的 6 个运维命令原先引用缺失脚本，已恢复。scripts/eval-accuracy.ts、eval-set-coverage.ts、export-eval-set.ts 为薄 CLI，分别调用 src/server/evaluation 的准确率、覆盖和真值服务；共用 ticket-directories 收集旧票目录及新 Jira/飞书 run 目录。新版指标是成功提交标记；responseArtifactVersion=1 还需对应响应文件，不能把取消或未完成运行残留的 final_reply 当成功评测样本。

真值导出使用统一 ReviewSample、Date 序列化和目录规范化函数，从 sync_records 读取 reviewSamples/ruleGroups；不再使用旧 idb_records/issueReviewSamples。指标基线工具保留原统计字段。附件下载脚本保留原多平台后端；独立 replay_cantrace.py 复用 plot_can_signals.py 的解码、时钟、周期和绘图函数，避免两份核心算法漂移。Python 缓存加入忽略。

README 已替换脚手架说明，提供实际分层、运行、迁移、检查和运维入口。下文旧系统路径示例仍需最终文档审计，不能当作当前新库表名或测试命令使用。

## 当前 Docupedia 统计与重试边界（2026-10-28）

`src/server/docupedia/upload-stats.ts` 的 DOCUPEDIA_STAT_MIN_CHARACTERS=500 供计数和成功日志共用。以原始正文 text.length 判断，不计 HTML 包装。每个“目录/月份”键使用独立 Promise 写队列，同进程串行读持久文件、按标题去重、追加累计值；进程重启从原文件续计。该设计不提供多进程同时写同一文件的互斥。损坏文件不自动覆盖，修复后后续请求可继续；调用方仅告警，不回滚成功归档。

`client.ts` 保留原 meegle_ 随机前缀、Step合并、瞬时错误退避、文章间100–150秒节流。withDocupediaRetries新增实际尝试计数，避免永久403只尝试一次却报告配置上限。协议测试拦截 node:https，长等待仅在测试中加速，不改变生产节流。原始500阈值和标题前缀均与参考当前源码核对，文档700/jira_残留已统一。

## 团队模板的数据库门禁（2026-10-28）

`src/server/templates/template-lock.ts` 从池中取得单一连接，以 WEIGHT_STRING 的 utf8mb4_unicode_ci / CHAR(64) 权重生成不超过64字节的命名锁，匹配当前 team_templates.template_key 的排序与长度。GET_LOCK等待上限10秒；操作、回读和RELEASE_LOCK都用同一连接，避免池大小5时等待者占满池而持锁者再申请连接的死锁。该门禁跨Node进程生效；当前实例中其他数据库的同名标识可能被一并串行，不影响数据归属。

发布、删除和迁移模板行共用withTemplateLock。获取锁通信失败或释放状态不确定时销毁连接，防止带锁连接回池；正常业务异常先释放再保留原错误，已提交成功不因清理失败而误报失败。门禁超时以HttpError(503)穿过发布校验包装，OpenAPI同步描述。没有新增表或schema版本；如果修改列排序规则，需要同步门禁权重规则。

同配置去重仅在全体版本中的最高版本未删除且配置相同时成立，并回读该版本，不能拿较旧的可见版本代替已删除最新版本。旧模板迁移仍逐行提交；SQL和门禁都复用传入连接，不更改旧库。

### SSH 传输与查询超时隔离（2026-10-28）

`terminal-gateway/ssh-connection.ts` 管理每会话的 ssh2 Client、PTY 和独立 exec 通道。会话内查询及文件操作复用认证，每操作 20 秒超时、40 MB 输出上限，使用 StringDecoder 保留跨分片 UTF-8。操作失败关闭自身通道，连接关闭取消全部未完成操作；SSH 每 10 秒保活，连续 3 次无回应判定断连。PTY 初始化另有 18 秒总时限。

SessionManager 的自动 Git 刷新按会话延迟 1.2 秒合并；刷新执行期间的新输入最多保留一次后续刷新，断开时清理计时器。连接审计期间缓存最多 256 KiB 首屏输出，发送 connected 后按序交付，防止客户端丢弃未确认会话的数据。

## 日志版本提取实现（2026-10-29）

`src/server/pipeline/log-versions.ts` 使用现有 `dltreader` 依赖流式解码 SCC DLT，无新增 Python 或外部服务依赖。`collectEvidence` 在嵌套解压完成后、生成提取日志时调用，按 Buildinfo 相对路径分组保存 SOC 和 SCC 及 DLT 来源。`log-versions.json`、`extract.md`、`step4_android_qnx_input.md` 写入本次 logRoot，版本进入 Step 4/Step 5 输入。飞书产物白名单允许读取版本 JSON。保留既有 IndexedDB 架构，不升版。

7za 使用 `x` 保留压缩包目录结构，避免原 `e` 打平层级造成同名 Buildinfo 覆盖和 SCC 跨目录匹配。缺文件与解析失败不阻塞分析，失败通过 VERSION_EXTRACT 日志记录；取消仍传播。版本文字在日志截断之后附加，生成结构化信号证据时剔除这段元数据，避免将版本当成日志命中。

### VHAL 配置快照（2026-10-29）

`src/server/pipeline/vhal-version.ts` 移植参考 `extract-vhal-version.js` 的解析规则（去除块注释，匹配有效的 `#define VER_PRO_CFG "8位数字"`）。只读取请求中当前规则组的 `basePaths.proto_dir/type.h`，无硬编码默认目录，无缓存。`collectEvidence` 依次提取 SOC/SCC、VHAL，再写运行产物；不依赖压缩日志存在。

`log-versions.json` 保留 schemaVersion=1 和 records，新增可选兼容字段 `vhal`：成功为 `{status:"ok",file,raw,platform,version}`；缺少根目录为 `{status:"not_configured"}`；读取或解析失败为 `{status:"unavailable",file,error}`。旧产物不回写，无 IndexedDB schema 变更。VHAL 文本与 SOC/SCC 一起追加到分析输入，结构化信号证据构建时排除这段元数据。

`buildFilteredLogsBySignalIds` 将已提取的 `boschVehicleHalHashLines` 与 Android/QNX 文本一起返回；`collectEvidence` 复用同次扫描结果，完成筛选后将这些完整行和 SOC/SCC、VHAL 一并写入 `log-versions.json`，不额外扫描，也不受 Android 文本字符截断影响。schemaVersion 保持 1，新增字段不影响旧产物读取。

## 远程终端同步约束（需求确认，尚未实现，2026-10-29）

以 docs/project.json 全部项目/分支组/repos 为范围，复用现有登录、管理员权限和白名单SSH目标。读取 SSH 仓库本地 refs/heads/<branchName> 固定 commit，从同一提交读取信息与配置文件，不 fetch/pull。RTC完整保存RTC1-数字格式。

文件递归收集并打平到 configuration/<projectName>/<分支组名>/{json,sdb,.h,xls}；没有repoName/scripts层。来源与各repo提交必须通过清单追溯。提交不变且完整跳过、缺失补齐、变化替换托管快照并移除旧文件。打平冲突建议：同内容去重，异内容报告冲突并保留上一份完整分支组快照；该发布边界属待审补充建议。详见 requirements/terminal-sync-review.md；不是当前已实现架构。
