# Pipeline 版本与 VHAL 检查实现计划

目标：落实需求稿 v0.3，在共享证据整理后检查版本和 VHAL 配置，保留完整运行结果与非阻断提示。
架构：独立的只读解析模块、共享检查阶段、领域结果契约；复用 finishSuccess 的严格成功提交与 IndexedDB 保存。Excel 使用 Python 标准库解析 xlsx，无新增包；原无附件/拒绝路径保持原义。

- [x] 解析与规则：新增 test/pipeline-version-vhal.test.ts，先验证完整 hash/最新编译日期/冲突、commit 映射、根目录与 bak、8 位版本、DBC 映射、Excel 多 sheet/两列/Project/大小写与停止条件；再实现 src/server/pipeline/version-vhal/{resolution,workbook,signals}.ts 与 scripts/read-vhal-xlsx.py。
- [x] 共享阶段：新增 version-vhal-stage.ts，在 orchestrator.ts 的 collectEvidence 后接入。先用编排测试验证停止与继续，再实现 AI 严格 JSON 校验、未知与冲突提示、四个审计产物、Step4/5 补充证据及提前完整保存。
- [x] 结果闭环：领域契约增加可选 versionVhalCheck；更新 finish、process-repository、飞书兼容与恢复校验、产物白名单。详情页增加阶段状态和可展开证据。测试持久化重读与旧结果兼容。
- [x] 验证：source ~/.bashrc 后显式使用 Node 20；定向 Vitest、全量 Vitest、lint、typecheck；独立构建目录构建与隔离浏览器验证详情/刷新/看板持久化，不停止现有服务，不调用真实模型或工单写接口。
- [x] 更新需求状态、PRODUCT/ARCHITECTURE/WORKFLOW/SEQUENCE_DIAGRAMS/PIPELINE_GUIDE 与 session-handoff，列明真实环境未验证部分。

执行采用当前工作区增量修改，保留既有未提交内容，不整体提交；阶段完成后按需求逐项审查。
