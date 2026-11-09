# 开发服务堆耗尽排查与验证（2026-11-09）

## 问题与改动

用户提供 `meegle-7147491031` / `KH-w_Q-59QfFaQtRYhSSh` 的崩溃日志：Next.js 16.2.4 运行约 99 分钟，V8 堆接近 10 GB 上限，GC 回收很少，最终发生 JavaScript heap out of memory。最后一条业务日志是 VHAL 版本 22.38，不能将最后输出位置直接当成分配内存的位置。

`package.json` 的 `dev` 和 `dev:with-terminal` 改用 `next dev --turbopack`，保留热更新、10 GB 堆上限和现有终端网关。已有 webpack 配置及其他用户修改保留；生产构建继续按 README 使用 `npm run build -- --webpack`。运行中的服务不会因修改 package.json 自动切换，下一次启动时生效。

## 真实票据证据

- 附件目录：约 4.1 GB / 1451 个文件（含压缩包与解压文件）。
- 该 run 的 `signals_id.json` 共 16 条记录，数值 ID 和十六进制 ID 全为 null。因此该票不会产生大量 prop ID 命中行。
- Node.js 22、512 MB 堆限制下直接运行已有函数：版本提取峰值约 13 MiB，时间窗 Markdown 和 Android/QNX/hash 扫描峰值约 41 MiB，三步都成功完成；耗时分别约 0.2 / 18.1 / 26.2 秒。
- 在 Node.js 20 的隔离 Turbopack 服务中调用 `collectEvidence`，读取同一真实目录，所有新产物仅写入 `/tmp/ivacp-oom-turbo/offline-evidence`：HTTP 200，服务整体峰值堆约 623 MiB、结束约 492 MiB；VHAL 仍为 22.38，保留 1 条 hash 行，extract.md 读回与返回文本完全一致。
- 上述为真实日志的本地证据处理，未调用 Qwen、重新处理线上工单或回填。

## 开发编译内存对比

在 `/tmp` 独立副本和 3101 / 3102 端口测试，没有覆盖用户 `.next`、停止或重启用户业务服务。副本不加载业务 `.env`；使用仅在副本有效的测试 session。

方法：读取 `src/app` 下全部 68 个 page / route，顺序 GET；再在副本 `src/domain/auth/permissions.ts` 末尾追加一条注释，重复访问全部路由。预加载脚本每秒采样 `process.memoryUsage()`。不手动 GC；下表统计的是采样峰值，不能视为 heap snapshot 对保留对象的精确归因。

| 场景 | 初始编译 | 4 轮热更新耗时 | V8 堆峰值 | 说明 |
| --- | --- | --- | --- | --- |
| webpack / Node.js 22 | 98 秒 | 116 / 94 / 140 / 109 秒 | 7591 MiB | 结束约 6708 MiB，该首轮实验服务已停止 |
| Turbopack / Node.js 20 | 42 秒 | 9 / 8 / 9 / 10 秒 | 651 MiB | 此峰值统计到四轮访问完成；之后另行进行了证据与浏览器验收 |

两种场景每轮都有相同的 9 个 HTTP 5xx：无 MySQL 配置的备份、统计、模板和标注接口返回 503，缺少实际工单/本地迁移上下文的迁移和流转测试路径返回 500；无 POST 处理器的 GET 返回 405，非法测试来源详情返回 404。这些接口状态用于编译，不是实际业务验收失败。未出现 Turbopack 编译 panic（最初跨目录 node_modules 软链接报错后，已改为独立依赖目录重测）。

同 Node.js 20 版本补测：webpack 初始编译 117 秒，两轮热更新分别 141 / 9 秒，峰值堆 4123 MiB（使用首轮遗留的磁盘编译缓存，因此耗时不能直接与冷副本等同）。同 Node 版本下 webpack 的峰值仍显著高于 Turbopack。有限轮次的对比证明了开发模式的内存压力差异，不能证明长期运行完全没有内存增长。

## 检查与边界

- 日志/版本/VHAL 相关 Vitest：7 文件、64 用例通过。
- 全量 Vitest（主机权限、4 worker）：544 通过 / 9 失败 / 41 跳过。9 个失败均来自本机 MySQL `ECONNREFUSED 127.0.0.1:3306`（labeling、team-templates、template-concurrency），不宣称全量绿色；未启动或修改用户数据库。
- 首次默认沙箱执行曾因 MySQL/SSH `EPERM` 等失败；主机权限执行后本地 SSH 场景通过，MySQL 仍拒绝连接。
- typecheck 通过；全量 lint 0 错误、2 条已有警告（`docs/loop-engineering/team-sharing-build/build.mjs` 的未使用变量）。
- `/tmp/ivacp-oom-build` 中 `npm run build -- --webpack` 通过，不覆盖用户 `.next`。
- 看板 / 双来源工作流浏览器验证：2 文件、5 用例通过（Chromium 1223，`IVACP_BROWSER_BASE_URL=http://localhost:3102`），覆盖卡片配置、排序、IndexedDB 写入、刷新保留、双来源处理/复核/重试。接口 mock，不是线上业务验收。
- 浏览器准备阶段依次遇到副本缺少 `vitest.config.mts`、默认浏览器版本未安装，已补齐配置并使用本机 Chromium。127.0.0.1 下 Next 开发来源校验会阻止 HMR，页面停留在「正在读取规则组」；改用服务公布的 localhost 后无 JavaScript 错误，同样的测试全部通过。开发模式请使用 README 中的 localhost 地址；本轮未扩展 allowedDevOrigins。
- 没有崩溃进程的 heap snapshot；当前证据支持开发编译和热更新累积是主要内存来源，不能证明运行 99 分钟内只有这一条内存增长路径。
- 未验证长时间线上批量任务、真实 Qwen、飞书/Jira 回填、远程 SSH；测试和本地内存对比不替代这些验收。

## 隔离进程清理阻塞

首轮 Node.js 22 webpack 实验已结束并释放资源。后续 Node.js 20 webpack / Turbopack 服务清理未执行：自动审批先因响应中断（content_filter）失败，再因不允许重试同一被过滤的清理操作而拒绝。已只读确认 PID 659187 / 659200 位于 `/tmp/ivacp-oom-dev`，599254 / 599281 位于 `/tmp/ivacp-oom-turbo`；用户已明确授权清理，重新核对 PID 后自动审批仍拒绝，并明确说明该限制无法由用户授权覆盖。停止操作未执行；可由用户在终端执行 `kill -TERM 659187 659200 599254 599281` 手动清理。不得绕过自动审批。
