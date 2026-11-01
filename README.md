# IVACP 车辆智能分析与协作平台

重构自 Jira / 飞书项目分析系统，保留双来源筛票、CAN 与日志分析、人工复核、校验、回填、自动周期、统计、模板、智能助手、标注和终端；按确认移除 Geely2 专项。完整功能和验证边界见 [功能对照](docs/REFACTOR_STATUS.md)，本地环境与最近结果见 [会话交接](session-handoff.md)。

## 本地运行

需要 Node.js 20、npm；CAN 解析使用安装了 [Python 依赖](scripts/can/requirements.txt) 的解释器。MySQL、Jira、飞书 CLI、Qwen 和 SSH 按所用功能配置，IndexedDB 是浏览器主存储。

```bash
source ~/.bashrc
node --version
npm ci
npm run dev
```

打开 `http://localhost:3000`。账号沿用本地 `docs/login.json`；不要把实际密码粘贴到文档。环境参数放在被忽略的 `.env` / `.env.local`，包括 `AUTH_SECRET`、Qwen 的 `BASE_URL` / `QWEN_API_KEY` / `QWEN_MODEL`、Jira 的连接配置，以及可选 `MYSQL_URL`、`CAN_PYTHON_BIN`。生产环境必须配置稳定的 `AUTH_SECRET`；本地 HTTP 生产预览按环境配置 `AUTH_COOKIE_SECURE=false`。

```bash
npm run build -- --webpack
npm start
```

构建会改写当前目录的 `.next`。已有业务服务运行时，在独立副本中构建和验收，不覆盖该服务的构建目录。

## 代码入口

| 目录 | 职责 |
| --- | --- |
| `src/app` | 页面和 API 薄入口、登录与应用布局 |
| `src/features` | 按业务组织组件、客户端服务与状态 |
| `src/domain` | 统一实体、纯业务规则、校验和迁移映射 |
| `src/shared` | UI、IndexedDB、同步和通用工具 |
| `src/server` | 外部系统适配、分析流水线、MySQL 与离线评测服务 |
| `terminal-gateway` | 独立 WebSocket / SSH 网关；与终端客户端配套运行 |
| `scripts` | CAN 工具、迁移和运维 CLI |
| `test` | Vitest 服务、事务、离线 CAN、CLI 和可选浏览器验收 |

主要页面：`/` 规则组看板、`/rule-groups/[id]` 工单列表、`/tickets/[source]/[key]` 统一详情、`/statistics`、`/templates`、`/labeling`、`/terminal`、`/settings/data`。接口说明在 `/api/docs`，JSON 规格在 `/api/openapi`。

## 数据迁移与备份

`/settings/data` 支持备份文件预览导入、同源旧 IndexedDB 只读探测与迁移、服务器镜像备份恢复和旧 MySQL 迁移预检。IndexedDB 按来源隔离，跨端口时需要从原页面导出兼容备份后在新页面导入。旧表映射到新的 `IvacpDB`，服务端使用独立 `ivacp` 库和 `sync_records`。

命令行迁移入口是 `npm run migrate:legacy -- --legacy-app-dir=/path/to/old/app`，可按需加 `--owner=账号`；默认只补缺失数据，`--overwrite` 才覆盖。它还可补齐旧分析产物，不复制下载缓存。旧 MySQL 由 `LEGACY_MYSQL_URL` 指定，缺省读取同实例的 `jira_analyzer_next`。迁移不会修改旧库；具体批次与恢复边界见架构文档及交接记录。

## 检查与运维命令

```bash
npm test
npm run lint
npm run typecheck
npm run terminal:gateway
```

浏览器场景默认跳过。针对隔离预览设置 `IVACP_BROWSER_BASE_URL`，必要时设置 `IVACP_BROWSER_EXECUTABLE` 后，可用 Vitest 显式运行 `test/*browser.test.ts`。这些场景会拦截外部业务写接口；不要把它们当作真实外部系统验收。

| 命令 | 输入与产出 |
| --- | --- |
| `npm run jira:attachments -- --help` | 查看附件下载筛选、并发、分片和下载器选项；`--dry-run` 仅列附件 |
| `npm run cleanup:data -- --dry-run` | 预览 `jira-issues/` 和 `log/` 过期文件；去掉预览参数才删除，默认保留 90 天，可设 `DATA_RETENTION_DAYS`；保留 Docupedia 月度统计 |
| `npm run baseline:golden` | 从 `log/` 指标生成耗时、阶段与证据完整度基线 |
| `npm run eval:coverage` | 统计本地成功日志与人工评测集覆盖情况 |
| `npm run eval:accuracy` | 只读本地产物计算证据接地率、信号召回和关键判断命中；缺证据时显示未知，不调用模型 |
| `npm run eval:export-truth -- --owner admin --dry-run` | 只读新 MySQL 镜像，预览人工复核样本导出；去掉预览参数合并评测集，保留手写条目 |

独立 CAN 回放可运行 `python3 scripts/replay_cantrace.py --help`，支持信号 JSON、Proto 映射及仅导出数据；复用流水线解码器，不连接硬件总线。附件 CLI 的隔离测试需要本机 `openssl` 生成临时测试证书。

报告位于 `docs/golden-baseline/`，人工真值文件为 `eval-set.json`。评测兼容旧票目录及 Jira / 飞书独立运行目录，同票选择最新完整成功运行。

开发按 [AGENTS.md](AGENTS.md) 的最小 Loop 执行，当前目标、验收状态和下一步见 [会话交接](session-handoff.md)。

开始修改代码前，阅读 [产品](docs/PRODUCT.md)、[架构](docs/ARCHITECTURE.md)、[流程](docs/WORKFLOW.md)、[时序](docs/SEQUENCE_DIAGRAMS.md) 和 [交接](session-handoff.md)。
