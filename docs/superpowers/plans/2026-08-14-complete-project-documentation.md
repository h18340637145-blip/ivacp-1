# 全量项目文档集实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 `docs/output-docs/` 生成覆盖仓库全部当前功能的、可导航且相互一致的中文 Markdown 文档集。

**架构：** 使用 `README.md` 作为文档入口，将产品需求、系统边界、业务流程、模块设计和实现细节分别放入五份专题文档。以现有 Harness 文档、当前代码结构和公开脚本为事实来源，并在交付前执行结构、链接与术语一致性检查。

**技术栈：** Markdown、Mermaid、Next.js、React、TypeScript、Zustand、Dexie / IndexedDB。

---

## 文件结构

- 创建：`docs/output-docs/README.md` — 文档导航、读者、术语和阅读路径。
- 创建：`docs/output-docs/产品文档.md` — 产品范围、角色、功能与业务规则。
- 创建：`docs/output-docs/架构文档.md` — 系统边界、技术架构、存储、外部集成与安全。
- 创建：`docs/output-docs/流程文档.md` — 主要业务时序、状态流转与异常分支。
- 创建：`docs/output-docs/概要设计.md` — 分层模块、职责、依赖、数据流与状态机。
- 创建：`docs/output-docs/详细设计.md` — 路由、Store、数据模型、流水线、接口和配置细节。
- 修改：`session-handoff.md` — 追加本次文档交付和验证记录。

### 任务 1：建立文档入口与产品视图

**文件：**
- 创建：`docs/output-docs/README.md`
- 创建：`docs/output-docs/产品文档.md`

- [ ] **步骤 1：编写文档目录和阅读路径**

在 `README.md` 中链接五份专题文档，说明产品、开发、测试 / 运维角色的推荐阅读顺序，并定义 Jira、飞书项目、规则组、筛票快照、处理任务、运行产物等术语。

- [ ] **步骤 2：编写产品范围与规则**

在 `产品文档.md` 中覆盖产品定位、三类用户、Jira / 飞书统一看板、规则组、筛票、分析、CAN 图、人工复核与回填、自动周期、Docupedia 和远程终端；写明来源隔离、人工授权、无后端数据库等业务边界。

- [ ] **步骤 3：检查入口链接与术语**

运行：`rg -n '](\./(产品文档|架构文档|流程文档|概要设计|详细设计)\.md)' docs/output-docs/README.md`

预期：输出 5 个相对链接；所有专题文档名称均被引用。

### 任务 2：建立架构和流程视图

**文件：**
- 创建：`docs/output-docs/架构文档.md`
- 创建：`docs/output-docs/流程文档.md`

- [ ] **步骤 1：编写架构边界**

描述浏览器展示与 IndexedDB、本地 Next.js API、本地 JSON 配置与运行日志、分析流水线和外部系统的职责；用 Mermaid 展示分层和集成关系，明确异步 Docupedia 和来源隔离。

- [ ] **步骤 2：编写端到端流程**

使用 Mermaid 描述统一筛票、Jira / 飞书分析、人工复核与受控回填、Docupedia 归档和远程终端受限操作；为每条流程列出失败分支和结果。

- [ ] **步骤 3：检查 Mermaid 与安全术语**

运行：`rg -n '```mermaid|人工复核|IndexedDB|Docupedia|config_\*\.json' docs/output-docs/架构文档.md docs/output-docs/流程文档.md`

预期：两份文档都包含系统边界，流程文档包含至少 3 段 Mermaid 图，并明确关键安全 / 可靠性约束。

### 任务 3：建立概要与详细设计视图

**文件：**
- 创建：`docs/output-docs/概要设计.md`
- 创建：`docs/output-docs/详细设计.md`

- [ ] **步骤 1：编写模块职责和数据流**

在 `概要设计.md` 中按 UI、客户端状态、API、流水线、外部适配、终端网关划分模块，记录输入 / 输出和依赖；提供统一看板、分析和结果生命周期的状态机。

- [ ] **步骤 2：编写可落地的实现细节**

在 `详细设计.md` 中列出主要 API 路由、Store、持久化表、分析阶段、artifact 白名单、回填幂等语义、CAN 信号约束、环境变量和验证脚本。仅描述可从仓库和 Harness 文档确认的能力。

- [ ] **步骤 3：检查详细设计覆盖面**

运行：`rg -n '/api/|Store|IndexedDB|PREPARING|Docupedia|MEEGLE_|JIRA_|ENABLE_DOCUPEDIA' docs/output-docs/详细设计.md`

预期：命中路由、客户端状态、持久化、流水线、外部配置和安全边界六类内容。

### 任务 4：交付校验与交接记录

**文件：**
- 修改：`docs/output-docs/*.md`
- 修改：`session-handoff.md`

- [ ] **步骤 1：检查文件集合与占位符**

运行：`test -f docs/output-docs/README.md -a -f docs/output-docs/产品文档.md -a -f docs/output-docs/架构文档.md -a -f docs/output-docs/流程文档.md -a -f docs/output-docs/概要设计.md -a -f docs/output-docs/详细设计.md && ! rg -n 'TODO|待定|TBD|后续补充' docs/output-docs`

预期：命令退出码为 0。

- [ ] **步骤 2：执行 Markdown 结构检查**

运行：`rg -n '^# ' docs/output-docs/*.md`

预期：每个文档都恰有一个一级标题，且主题与文件名一致。

- [ ] **步骤 3：更新交接记录**

在 `session-handoff.md` 的「已完成 / 已实现」顶部添加日期、交付目录、文档范围和上述检查结果；不改写已有历史记录。

- [ ] **步骤 4：检查变更范围**

运行：`git status --short docs/output-docs session-handoff.md`

预期：仅显示本计划创建的 6 份文档和 `session-handoff.md` 的追加变更。
