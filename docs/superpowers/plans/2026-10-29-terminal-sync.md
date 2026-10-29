# 远程终端全项目同步实现计划

> **面向 AI 代理的工作者：** 按 executing-plans 逐任务实现，使用测试驱动开发及完成前验证。

**目标：** 管理员复用 SSH 连接，按 v0.3 同步全部本地分支提交、RTC 映射及打平配置文件。

**架构：** Gateway 执行结构化 syncProjects，不接受浏览器提供的配置或路径。Git 固定本地 refs/heads 提交并按 blob 读取；本机全局flock锁、临时目录与恢复备份保护文件和 project.json。客户端同步请求独立于单分支查询队列，按 session/requestId 关联。

**技术栈：** TypeScript、Node fs/crypto、现有 ssh2 exec、React、Vitest/Playwright；远端需 git、bash、base64。

- [x] 任务1：测试 Git 元数据/RTC/递归过滤/二进制 blob，创建 sync/remote.ts 与领域同步结果类型。先失败后实现；真实临时 Git 仓库验证不checkout、不fetch、工作区改动不混入。
- [x] 任务2：测试持久化/全项目遍历/跳过/补齐/回退/删除/备份/失败/锁/路径约束；实现 sync/storage.ts、sync/runner.ts。真实临时文件系统，不写业务配置。
- [x] 任务3：扩展 Gateway 的 syncProjects 管理员入口，复用认证channel，断线取消与进度/报告关联；添加 Gateway/客户端回归，保持PTY可用。
- [x] 任务4：终端Pane/Workspace接入同步按钮与进度结果，包含项目/分支/repo/commit/RTC/目录/警告；浏览器模拟同步、失败重试、切换上下文、断线及权限。
- [x] 任务5：运行定向及适当全量检查、独立生产构建和浏览器看板持久化回归，更新Harness/需求/交接；保留业务服务及既有改动，不自动提交或真实连接远端。

用户最新文档§6.1修改为冲突备份到bak并覆盖；覆盖旧的冲突即失败建议。同名新文件按project.json仓库顺序及源路径排序后依次覆盖，最后者生效；bak同名覆盖。传输失败仍保留完整旧分支组快照。发现配置在运行中被编辑则拒绝发布。

最终验证：全量380项通过，类型检查/全量ESLint/独立生产构建通过；终端与看板8项生产浏览器通过。本地真实SSH测试1项通过。独立审查问题均修复复查，实际业务部署/远端验收未执行。见session-handoff.md。
