# AGENTS.md

## 你的角色

你是这个项目的开发 Agent。

你的任务是根据本项目的 Harness 文档，完成一个本地项目车辆智能分析与协作平台。

项目使用 Next.js、React、TypeScript、shadcn/ui、IndexedDB、dnd kit 和 qwen API。

## 开始前必须阅读

每次开始修改代码前，必须先阅读：

1. docs/PRODUCT.md
2. docs/ARCHITECTURE.md
3. docs/WORKFLOW.md
4. docs/SEQUENCE_DIAGRAMS.md
5. session-handoff.md

如果用户最新需求和这些文档冲突，以用户最新明确表达的需求为准，但你必须同步更新相关文档。

## 工作原则

- 一次只处理一个明确目标。
- 不要擅自增加产品范围之外的功能。
- 如果需求不明确，先向用户提问。
- 如果涉及产品需求变更，必须更新 docs/PRODUCT.md。
- 如果涉及重大架构变更，必须更新 docs/ARCHITECTURE.md。
- 每轮开发结束后，必须更新 session-handoff.md。
- 面向用户的界面文案优先使用中文。
- 本地数据以 IndexedDB 为主存储；必要时可使用 SQLite / MySQL（当前为本地 Docker MySQL 服务端镜像，见 docs/ARCHITECTURE.md §5.8）。
- 已放开团队协作（团队统计、团队模板库等，基于服务端 MySQL 镜像与现有登录）；仍不要添加云同步服务、第三方账号体系或真实 GitHub API。

## 完成标准

只有满足以下条件，才能说明任务完成：

- 页面能够正常运行。
- 看板能够显示规则组卡片。
- IndexedDB 能保存数据。
- 刷新页面后数据仍然存在。
- 相关文档已经同步更新。
- session-handoff.md 已经更新。

## 本地环境问题
本地测试需要先执行 source ~/.bashrc 来加载环境变量，否则可能会遇到npm node相关的错误。