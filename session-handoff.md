# IVACP 会话交接

更新时间：2026-10-27。本轮从 `session.md` 和上一轮看板继续。完整重构尚未完成。

## 范围与工作区

- 目标仓库 `/home/huo2wx/project/nextjs/ivacp/ivacp`，参考 `/home/huo2wx/project/nextjs/app` 保持只读。除 Geely2 外保留原功能，统一存储、提供迁移、刷新 UI，测试使用 Vitest。
- 本轮开始基线 `05070a3`。改动尚未提交，勿 reset、清理或整体提交。具体功能对照见 `docs/REFACTOR_STATUS.md`，续接计划见 `docs/superpowers/plans/2026-10-27-workflow-continuation.md`。

## 本轮实现

- 双来源筛票：独立成功/失败状态、事务提交、最新运行门禁、飞书优先级与唯一归属、成功空结果清理关联且保留历史。
- 规则组工单列表、统一工单详情、单票与批量处理、重跑历史、任务状态；原子保存 task/result/snapshot，迟到响应不能覆盖新运行或新归属。
- 服务端共享 process/review/screenshot/chart/embeddings/飞书通知路由；完整阶段、附件、离线 ASC/BLF/CAN FD 解析绘图、证据和最终结论。Meegle 显式取消注册表与最终成功提交互斥；HTTP 断开不停止后台分析。
- 每次飞书运行独立目录；完整 process-response.json 先落盘，再提交 version=1 成功指标；刷新恢复保留 CAN 曲线、枚举、Token、模型，并重签凭据。旧运行不重放、不自动回填。
- AI/人工复核、结构化驳回、few-shot、一致性校验与人工改判；飞书 AI 复核只提供建议。
- Jira/飞书回填门禁、跨标签页领取、评论和流转分别记账、经办人指派。Jira 快照保存不可变站点，旧快照无法判定来源则阻止外部写入。
- 共享交互 CAN 图：缩放、平移、重置、合并截图；枚举不覆盖实际值时采用数值轴。详情保留旧链接参数、上下文和过程产物入口。
- 自动周期看板配置与 AppShell 调度，跨标签页租约、运行任务忙碌门禁、失败重试；出队前再次核对开关/token，关闭后不启动排队任务。最小 5 分钟，周期结束后计时，仅登录并保持浏览器打开时执行。
- `/settings/data`：逐表统计、JSON导出与预览导入、同源旧库只读探测与迁移、镜像备份恢复、管理员 MySQL 只读预检/确认迁移/报告。恢复先下载所有表再原子写入；首次自动同步仅增量补齐，不能自动finalize删除镜像；Dexie提交后再排同步队列。
- 修复聊天面板与 useAsync 既有 ESLint 问题，加载函数保持稳定引用，不关闭全局规则。
- 阶段和客户端经历规格/质量审查，已修复鉴权、取消提交竞态、恢复完整性、来源隔离、回填领取和周期队列问题。

## 最近验证与边界

- 最近全量 Vitest：53 文件通过、3 文件跳过；230 测试通过、6 跳过（6项浏览器场景单独启用）。日志 `/tmp/ivacp-continuation-tests.log`。真实离线 CAN 测试使用 `CAN_PYTHON_BIN=/home/huo2wx/anaconda3/bin/python3`。
- 最近 AutoCycle + process lifecycle 定向：2文件11项通过，包含真实限流队列关闭测试。
- 数据管理定向：4文件21项通过，包含并发写入期间一致性导出回归；新增数据管理/周期开关开发浏览器场景1项通过。最新生产浏览器3文件6场景全部通过，包括新增数据管理与周期开关。
- 之前生产浏览器验收2文件5场景通过，涵盖看板CRUD/排序/刷新/导入/权限、双来源处理/复核/截图/回填/重跑/失败隔离、跨标签页仅一次Jira评论。全部外部写接口与镜像使用mock；未实际回填或迁移真实旧库。
- 本轮最新生产构建成功，包含自动周期和数据管理，保留1项动态路径NFT tracing warning。最新全量ESLint与typecheck通过。
- MySQL 迁移仍按批次提交，可重复合并续迁，不保证整库事务原子性。浏览器导入/恢复为跨表事务。
- 无头宿主缺中文字体，布局截图与中文DOM断言分别验证。

## 重要：真实用户工单中断与预览恢复

停止3017预览前未检查活跃任务，发送过一次Ctrl-C后才发现真实飞书分析。已向用户说明并致歉，没有再次停止或重复提交工单。

- 原exec session **40371** 已退出（exit 130），原next-server PID **586858** 已消失。
- issue `meegle-7142715073`；run **MqsRZnmxIWvOaadcs2Vhs**；组 `chery T1YA-8255`；车型 `T1YA_8255`。
- 产物 `log/chery T1YA-8255/T1YA_8255/meegle-7142715073/MqsRZnmxIWvOaadcs2Vhs` 保留。
- 已完成需求、信号、CAN图、上层摘要、证据包和 Android/QNX 分析，中断在 AI_STEP5 最终一致性分析。无 process-response.json、无最终成功指标，**不能恢复为成功**。不得自行重复提交、回填或更改用户任务记录。
- 最新生产构建已重新启动3017，exec session **42430**，浏览器验收使用隔离context和mock接口。之后停止任何预览前先检查活跃分析；不要因curl失败认定分析退出。
- 临时开发验收服务3021，exec session **93019**；仅用于mock浏览器。与本轮无关的早期next-server PID5218勿触碰。

## 本地环境

```bash
source ~/.bashrc >/dev/null 2>&1
export PATH=/home/huo2wx/.nvm/versions/node/v20.20.0/bin:$PATH
```

本机默认Python缺CAN包，Anaconda解释器依赖齐全。已创建被git忽略的 `.env.local`，仅包含 CAN_PYTHON_BIN 与 IVACP_BROWSER_EXECUTABLE 两项本机路径，未更改 `.env` 或新增凭据。

## 后续完整目标

1. 自动周期和数据管理的最新生产浏览器3文件6场景通过；一致性导出回归、全量测试、lint、typecheck、build均通过。
2. 接通 `/labeling`（标注编辑/JSONL导出）、`/terminal`（项目、文件、权限、审计）与 `/api/docs`、`/api/openapi`。
3. 对照直接工单key分析/车型规则组匹配入口，补齐原功能；复查统计、模板、聊天、知识库、笔记和记忆完整交互。
4. 检查真实运行最终产物与恢复；不得自行重复处理、回填、群通知或迁移用户数据。
5. 全部功能对照与真实业务验收完成前，不将当前绿色测试描述为全项目重构完成。
