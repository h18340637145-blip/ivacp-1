# IVACP 重构续接计划

**目标：** 接续 `session.md` 已确认的重构，让空白首页恢复为可持久化的规则组看板。

**既定方案：** 沿用 `domain / shared / features / server / app` 分层、`IvacpDB`、现有 UI 组件与权限；不修改参考项目，不执行真实工单回填或数据库迁移。按当前工作区继续开发，不创建会遗漏未提交代码的工作树。

## 本轮实现

- [x] 在 `test/rule-group-import.test.ts` 中验证导入格式、历史日期与车型配置、重复 ID、非法输入；先验证失败，再实现 `src/domain/rule-groups/import.ts`。
- [x] 完善 `src/features/rule-groups/store.ts`：加载失败可重试、写入后更新缓存、导入先完整校验再事务写入、合并保留已有排序。
- [x] 在 `src/features/rule-groups/components/` 实现配置表单、导入确认、规则组卡片和拖拽看板；组装到 `src/app/(app)/page.tsx`。表单覆盖普通/Bosch Jira、JQL/MQL、路径、车型文件与全部提示词。只向管理员提供管理操作。
- [x] 修复现有终端审计事件的类型检查阻断，保留必填操作人语义。
- [x] 执行 Vitest、类型检查、定向 ESLint、生产构建与浏览器验证；浏览器验证新建、编辑、刷新保留、排序、导入、导出和删除。
- [x] 更新四份 Harness 文档与 `session-handoff.md`，区分旧系统规格、当前已接通功能与剩余迁移项。

## 后续依赖顺序

1. 双来源筛票编排及 `/rule-groups/[id]` 分来源列表。
2. 共享处理流水线入口、Jira/飞书客户端任务生命周期、结果和历史详情。
3. 人工复核、AI 复核、校验、截图与回填门禁、自动周期。
4. 数据管理与一键迁移 UI、标注、终端工作台和 OpenAPI 页面。
5. 全功能对照与实际环境验收。

当前 `session.md` 中的后台任务完成字样不能作为这些功能已可运行的证据。
