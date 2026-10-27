# IVACP 会话交接

更新时间：2026-10-27。续接来源：仓库根目录 `session.md` 中的 Copilot 重构日志。

## 已确认的范围

- 在 `/home/huo2wx/project/nextjs/ivacp/ivacp` 重构，参考 `/home/huo2wx/project/nextjs/app`，不修改参考项目。
- 保留原系统 Jira / 飞书项目等功能，移除 Geely2 专项页面。
- 新设计系统、统一领域模型、新建 IndexedDB / MySQL 数据库，并提供旧数据迁移；测试使用 Vitest。
- 工作区保留大量 Copilot 未提交、部分已暂存的迁移代码；不要 reset、清理或整体提交这些改动。

## Copilot 中断位置

日志末尾因月度额度耗尽，五个后台任务中四个失败、Meegle 服务端任务报告完成。已留下领域实体、统一数据库、登录、外壳、镜像/迁移服务、多个服务端模块和统计/模板页面。任务报告不能替代运行验收。

续接开始时首页 `src/app/(app)/page.tsx` 仍然返回 `null`。旧交接文档中的 `lib/`、`stores/` 路径及“已实现”描述来自参考系统，不能视为新仓库现状。

## 本轮已接通：规则组看板

- 首页组装 `src/features/rule-groups/components/kanban-board.tsx`，展示规则组卡片、来源、车型、提示词数量、查询摘要和更新时间。
- 支持关键词与来源筛选；管理员新建、编辑、删除、导入、拖拽排序，普通分析员只读配置与导出。
- 配置表单支持普通 / Bosch Jira、JQL / MQL、expand、JSON / DBC / Proto 根目录、车型文件、全部 6 项提示词。
- IndexedDB `IvacpDB.ruleGroups` 保存配置与排序；刷新重新读取。加载失败显示错误和重试入口。
- JSON 导入支持合并及确认覆盖；`src/domain/rule-groups/import.ts` 在写库前完整校验、还原 Date、兼容旧车型字段，拒绝重复 ID、错误日期和错误结构。
- 合并更新保留已有排序与创建时间，新组追加；导入事务保证不发生半写入。排序在数据库事务成功后更新缓存。
- 删除与覆盖只操作规则组配置，保留分析结果与历史。确认弹窗异步失败时保留弹窗并显示错误。
- 修复 `terminal-gateway/server.ts` 将必填 operator 覆盖为 undefined 导致的类型检查失败。
- 已同步四份 Harness 文档与 `docs/CONVENTIONS.md`，标记新仓库实际状态，并修正文档里的 Button API 与 Node 环境约定。

## 验证

- Vitest 全量（含本地 MySQL 集成）：140 个测试通过；浏览器验收默认显式跳过，需指定本地服务地址。
- `npm run typecheck`、本轮改动定向 ESLint、`npm run build` 通过。构建保留 2 个既有动态日志路径 tracing warning，没有阻断产物生成。
- 生产服务器 + Chromium 浏览器验收：2 个场景通过，覆盖新建完整配置、编辑保留 ID、键盘排序、刷新持久化、导出、合并导入、无效文件拒绝、覆盖导入保留分析结果、筛选禁用排序、删除与分析员只读权限。375 / 768 / 1024 / 1440px 均无横向溢出。
- 键盘测试需在按空格激活后等待两个动画帧：dnd-kit KeyboardSensor 延迟注册监听器、拖拽区域延迟测量；移动后等待 live-region 目标更新再放置，避免测试事件过快。
- 浏览器使用隔离 context，拦截 `/api/backup/**`，不把测试记录镜像到真实账号。
- 初次全量 ESLint 有 6 个既有错误，位于 `src/features/chat/components/{chat-panel,knowledge-panel,memory-panel,notes-panel}.tsx` 和 `src/shared/hooks/use-async.ts`，涉及 `react-hooks/set-state-in-effect` / `react-hooks/use-memo`。本轮没有全局关闭规则或更改这些模块。
- 无头浏览器系统缺少中文字体，截图用于布局核验；中文内容与交互通过 DOM 定位和断言核验。
- 未调用真实 Jira / 飞书工单写接口，未执行旧库全量迁移，未完成全系统端到端验收。

## 本地运行

必须加载 shell 环境，并显式使用 Node 20，避免系统旧 Node 与 npm 混用：

```bash
source ~/.bashrc >/dev/null 2>&1
export PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH
npm run dev
```

检查命令：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`。本机 MySQL 测试和浏览器运行可能需要沙箱外本地网络权限。

浏览器验收使用已有 Playwright（Vitest 编排，不新增另一套测试框架）：

```bash
# 先构建并启动本地生产服务器，或使用已运行的本地服务
npm run build
npm run start -- --hostname 127.0.0.1 --port 3017
# 另一终端，同样先加载环境与 Node 20
IVACP_BROWSER_BASE_URL=http://127.0.0.1:3017 \
IVACP_BROWSER_EXECUTABLE=/home/huo2wx/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell \
npx vitest run test/kanban-browser.test.ts
```

若已安装当前 Playwright 对应浏览器，可省略 `IVACP_BROWSER_EXECUTABLE`。

## 下一步：双来源筛票闭环

本轮遵守一次一个明确目标，仅接通规则组配置入口。完整重构尚未完成，建议接续顺序：

1. 在统一模型上接通双来源筛票编排及 `/rule-groups/[id]` 分来源列表。Jira 筛票服务已有初版；飞书客户端筛票落库和对账还需连接。必须保留来源失败隔离、成功空 MQL、唯一归属和历史数据保留边界。
2. 接通共享 `/api/issues/process` 入口（目前缺失），复用 `src/server/pipeline/process/*` 已迁移阶段，补齐需要的路由与阶段；连接 Jira / 飞书客户端 task/result/history 持久化、停止与恢复。当前 Meegle 服务端仍依赖该缺失入口。
3. 统一工单详情、CAN 图、AI 复核、人工复核、校验与回填门禁，再接自动周期。保持不可变 runId 恢复和真实人工复核授权边界。
4. 连接数据管理 `/settings/data`（备份 / 恢复 / 旧库迁移 UI）、标注 `/labeling`、终端 `/terminal`、OpenAPI `/api/docs` 和 `/api/openapi`，补齐聊天所需 `/api/embeddings` 等缺失接口。
5. 检查侧栏与旧路由重定向的目标页面是否存在；当前很多目标尚未创建，导航不代表可用功能。
6. 处理上述 6 个既有 ESLint 错误，完成原系统功能点对照及真实环境验收。

具体本轮计划：`docs/superpowers/plans/2026-10-27-refactor-continuation.md`。
