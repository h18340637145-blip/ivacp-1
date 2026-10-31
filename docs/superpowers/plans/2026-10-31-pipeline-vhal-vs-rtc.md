# RTC 关联 VS 提交定位 VHAL 实现计划

目标：实现需求稿 v0.1，保留来源提交，通过同项目、同分支组的 RTC 关联取得 VS 提交并定位归档。

架构：在共享 resolveVhal 内增加纯数据关联步骤；领域 schema 以可选字段承载关联证据，保持旧结果兼容。现有结果保存、恢复、历史及详情继续复用 versionVhalCheck。

技术栈：TypeScript、Zod、Vitest、Next.js、IndexedDB。

- [x] 在 `test/pipeline-vhal-vs-rtc.test.ts` 添加临时文件系统回归：跨仓库关联、范围隔离、完整 RTC、多 RTC 去重与歧义、缺失、归档、持久化及旧结果兼容。运行 `npx vitest run test/pipeline-vhal-vs-rtc.test.ts` 确认缺失行为导致失败。
- [x] 在 `src/domain/analysis/version-vhal.ts` 增加可选 VS 关联证据类型；在 `src/server/pipeline/version-vhal/resolution.ts` 实现 RTC 关联，改用 VS commit 匹配归档；在 `src/server/pipeline/process/version-vhal-stage.ts` 输出完整关联摘要及提示。运行新旧 VHAL 定向测试验证。
- [x] 扩展 `test/pipeline-version-vhal-browser.test.ts` 验证关联证据经分析响应、IndexedDB、刷新详情保留；覆盖旧结果与看板。更新恢复与生命周期测试使用的新证据夹具。
- [x] 执行 typecheck、ESLint、相关 Vitest；只读验证真实 7147061892 映射。使用独立副本构建和浏览器验收，不操作既有服务或工单。
- [x] 同步需求、PRODUCT、ARCHITECTURE、WORKFLOW、SEQUENCE_DIAGRAMS、PIPELINE_GUIDE、OpenAPI 与 session-handoff，记录验证结果与真实业务验收边界。

在当前会话内依次执行，不提交既有混合改动。
