## 最新续接：最近 10 条提交映射与 type.h 版本归档（2026-10-29）

- 用户要求点击「同步全部项目」时，将各对应仓库 git log -10 中全部 commit/RTC 更新至 docs/project.json；同名 type.h 内容变化时，以更新前映射和旧版本命名归档。保留本轮开始前所有未提交改动及用户 project.json 内容，没有主动执行真实业务同步。
- remote.ts 固定本地 branchName 尖端后执行 git log -10，以 NUL 分隔完整 commit 与正文，逐条提取完整 RTC；storage 按 commit 去重合并、修正已有 RTC、保留窗口外历史。文件完整未变也更新映射。清单 repos 保存最近 history，支持崩溃恢复与旧清单兼容。
- runner 对旧 type.h 从旧清单最终来源确定仓库及 commit，使用合并前 project.json 对应 RTC 与旧文件 VER_PRO_CFG，归档到 configuration/<项目>/<分支组>/bak/commitid_rtcids_vhal-version（无扩展名），新文件仍使用 type.h。多 RTC 下划线连接；无 RTC 使用 no-rtc、无有效版本使用 unknown-vhal。无旧清单时用对应仓库原映射末项；缺有效 commit 则保留旧快照并失败。归档名同名异内容阻止发布，同内容可复用；后续同步保留历史归档。普通文件 bak 规则沿用。
- 先新增 3 项失败回归，确认原实现缺少最近提交映射与版本命名归档，再修改实现。新增回归覆盖超过 10 条真实 Git 提交、完整正文/重复与空 RTC、未变文件更新映射、覆盖前映射命名、跨仓库来源、多轮归档、同内容无归档及归档冲突失败保留原快照。定向 4 文件 34 项通过，本机真实临时 SSH 1 项通过（同一已认证连接、无业务目标）。
- 最终全量 Vitest：84 文件通过、12 跳过；382 项通过、34 默认跳过。日志 /tmp/ivacp-history-all-tests.log；typecheck、全量及定向 ESLint、git diff --check 均通过。日志 /tmp/ivacp-history-{types,lint,lint-final,targeted,ssh}.log。
- 独立生产副本 /tmp/ivacp-history-source-8_c0kuyn，npm run build -- --webpack 退出 0；日志 /tmp/ivacp-history-build.log。预览 http://127.0.0.1:3053（exec21599）。终端 7 场景、看板 2 场景共 9 项生产浏览器验收通过，包括同步、VHAL 标签、卡片与 IndexedDB 刷新持久化；日志 /tmp/ivacp-history-browser.log。业务接口/Gateway 使用隔离 mock；同步文件和 Git 测试使用 /tmp 真实临时数据。
- PRODUCT、ARCHITECTURE、WORKFLOW、SEQUENCE_DIAGRAMS、需求 v0.4 均同步。静态旧流程配图保留基础流程，需求已注明 v0.4 的最近 10 条与 type.h 归档以文字第 5、6 节为准。没有重启现有业务前端/Gateway，没有连接真实业务 SSH、执行 fetch/pull 或改写业务配置快照；实际生效需运行更新后的 Gateway，真实业务验收未执行。

## 最新续接：当前分支 VHAL 版本标签（2026-10-29）

- 用户要求同步后提取type.h的VER_PRO_CFG原始8位版本，并在项目/分支选择栏下一行显示“当前分支已经配置的最新vhal版本是：82552236”。已实现，82552236同时记录platform=8255/version=22.36。
- 新增server/terminal/sync/vhal.ts，复用现有流水线parseVhalVersion，从最终打平生效的type.h读取。runner成功/未变分支结果与.sync-state.json新增可选vhal（targetId/raw/platform/version），随.sync-last.json落盘。旧完整清单再次同步可补记版本，不重新传输文件；无有效/已删除type.h不保留旧版本，同步失败不更新UI当前已发布版本。
- loadTerminalProjects增加本地已发布快照恢复（可注入root用于临时测试），各branch返回syncedVhal。恢复校验configurationKey、目标ID、type.h普通文件与manifest blob ID，不跟随目录或文件symlink，也不读取bak/type.h。服务配置schema保留该字段；Workspace按项目+分支缓存实时同步结果，按targetId隔离，在选择栏与同步面板之间显示标签。刷新从API恢复，切换分支不会串用旧版本。
- 定向5文件33项通过，含新增同步引擎回归：多来源type.h最终覆盖者、结构化版本与落盘、旧清单补记、刷新恢复、无效/删除版本清除。最终全量86文件通过/10跳过，381项通过/30浏览器默认跳过，日志/tmp/ivacp-vhal-label-tests.log。typecheck/全量ESLint/git diff --check通过；/tmp/ivacp-vhal-label-{types,lint}.log。
- 独立生产副本/tmp/ivacp-vhal-label-build-6fqhq8vs，构建退出0，日志/tmp/ivacp-vhal-label-build.log。预览http://127.0.0.1:3052（exec67298）。终端7+看板2共9个生产浏览器场景通过，日志/tmp/ivacp-vhal-label-browser.log；新增场景覆盖首次无版本、同步后精确label、切换分支隔离及刷新后恢复，其他场景覆盖原终端/权限/失败重试/超时交互/窄屏/看板IndexedDB持久化。
- PRODUCT/ARCHITECTURE/WORKFLOW/SEQUENCE_DIAGRAMS与需求§12已同步。已有docs/project.json用户改动保留，没有主动写业务快照或连接真实远端，没有重启现有业务前端/Gateway或3051旧隔离预览。本轮测试Gateway与项目接口用隔离mock；落盘与加载使用真实/tmp文件。正式使用仍需前端与Gateway配套更新，业务远端验收未执行。

## 最新续接：远程终端全项目同步已实现（2026-10-29）

- 按用户最新v0.3开发；本轮启动前发现用户已修改需求§6.1为“冲突旧文件备份bak后新覆盖、bak同名允许覆盖”，以此覆盖前轮冲突即失败建议，并同步所有Harness与图解。保留其他既有文档改动，无自动提交。
- 新增domain/terminal/sync.ts、server/terminal/sync/remote.ts/storage.ts/runner.ts。固定读取SSH服务器各repo本地refs/heads/<branchName>，先check-ref-format，禁止main~1等表达式及fallback HEAD，不fetch/pull/checkout；从提交%B提取完整RTC1-数字标识，递归Git普通blob，排除symlink/submodule。二进制base64传输后复核Git blob ID。
- 遍历docs/project.json全部项目/分支组/repos；文件全部打平到configuration/<projectName>/<分支组名>/<文件名>，不建分类或repo层。同内容合并，异内容将被覆盖者复制到bak/<文件名>后新覆盖；project.json repo顺序+各repo源路径排序，最后者生效，bak允许覆盖。保留未托管本地文件，移除旧托管文件，不删除其他来源仍使用的文件。
- 每组.sync-state.json保存身份、最新commit/RTC、全部来源和最终blob；configuration/.sync-last.json保存最近批次报告。未变且完整跳过、缺失/错误内容补齐、提交回退重新匹配而映射不重复。映射写到repo的commid-rtcids-map，保留其他字段和历史。configuration加入.gitignore，运行数据仍保存在磁盘。
- 使用Linux flock子进程持有全局系统锁，避免跨进程stale锁回收竞态；进程退出自动释放，不unlink锁文件。目录/文件名及symlink/O_NOFOLLOW防护，暂存完整目录后发布，原子JSON保存；分支组失败保留旧快照并继续其他组，配置中途改变拒绝发布。恢复校验manifest身份和仓库顺序，遗留previous+当前文件缺失时旁侧保存.sync-damaged-UUID再恢复旧快照继续；备份清理失败记警告。非全磁盘断电事务承诺。
- Gateway新增syncProjects/syncProgress/syncResult；启动时单独验证当前signed cookie的真实admin，requireAuth=false调试模式也不能绕过。只接受sessionId/requestId，配置由服务端读取，复用当前SSH channel.runCommand。5秒心跳；断线abort，读前后及发布前取消门禁；已开始的本地发布事务完成后停止。超时不关闭PTY。
- 客户端startSync独立于分支查询队列，按session/requestId和target过滤；切换项目不改变当前批次范围。Workspace/SyncPanel显示全部范围、进度、逐repo完整commit、RTC、目录、文件数、备份数、警告/失败，可重试。45秒无进度显示同步错误并保留PTY。
- 独立只读审查已修复并复查：旧stale锁竞态、分支表达式解析、目录错误中止全批、清理失败误报回滚、恢复补齐阻塞、恢复清单身份以及取消门禁。审查独立4文件26项通过。定向最终6文件41项通过，真实本地SSH同步1项通过（临时仓库及临时端口，验证二进制、映射、重复跳过、认证仅一次）。
- 最终全量Vitest：86文件通过/10跳过，380项通过/29浏览器默认跳过；日志/tmp/ivacp-sync-final-tests.log。typecheck、全量ESLint、git diff --check通过；/tmp/ivacp-sync-{types,lint,targeted}.log。此前第一轮374项通过已被最终计数覆盖，不混称本轮浏览器默认执行。
- 独立生产副本/tmp/ivacp-sync-build-h92vmhff，最终npm run build -- --webpack退出0；/tmp/ivacp-sync-final-build.log。最终生产预览http://127.0.0.1:3051（exec37557），终端6场景+看板2场景共8项通过，/tmp/ivacp-sync-final-browser.log。包括管理员/分析员、跨项目同步、失败重试、切换项目不丢同步、超时PTY可用、375/768/1440无溢出、看板卡片和IndexedDB刷新持久化。Gateway/模型/备份均mock，只有独立SSH测试连接了本机临时测试server，没有连接真实业务目标。
- 最初复制构建副本因.codegraph/daemon.sock失败，改为排除该目录；首次构建shell登录触发宿主只读motd错误，改login:false；两者没有修改业务目录.next。新增浏览器一处输入断言误按整段消息检查，改为拼接逐字符PTY消息后通过。未停止/重启现有业务前端或Gateway；仅停止本轮临时3051预览后运行最终构建并重启该预览。
- PRODUCT/ARCHITECTURE/WORKFLOW/SEQUENCE_DIAGRAMS、需求实现状态/备份规则/依赖及计划已同步。流程图9/9自动校验通过、0错误0警告，桌面显示检查通过，最终中文PNG人工检查可读；HTML SHA256 7ab942cfc485d384e193bab462cd842b05f5457e5ecb3c1b8482cfa50b41556f。字体子集仅在/tmp和PNG导出中使用，未改系统字体。需求相对链接检查通过。
- 部署边界：前端与Terminal Gateway必须配套更新；Gateway从本项目根目录运行，服务用户需可写docs/project.json及configuration。本机需要flock；远端需要git/bash/base64，沿用每exec20秒/40MB输出限制，单repo最多10000文件。过大文件/损坏清单会明确失败，不发布半份快照。真实业务SSH认证及实际全项目同步仍待用户环境验收，本轮真实docs/project.json未改写。

## 最新续接：终端同步需求 v0.3（2026-10-29，覆盖 v0.2 分类目录约定）

- 用户最新明确：四类来源文件的目标都为 `<文件名>`。所有匹配文件递归收集后，直接保存到 `configuration/<projectName>/<分支组名>/<文件名>`，不建立json、sdb、.h、xls、scripts或repoName子目录。v0.2中的分类目录与.h隐藏目录解释已废止；历史交接仅作追踪。
- 更新需求文档为v0.3：复制表、目录树、验收场景和确认项已统一；同步PRODUCT/ARCHITECTURE/WORKFLOW/SEQUENCE_DIAGRAMS、流程源JSON/HTML和两张PNG/文件SVG。其余已确认范围、SSH本地分支来源、RTC1-数字完整格式、管理员权限和更新策略保持。
- 同名冲突（包括跨来源目录）仍仅为补充建议：同名同内容合并，异内容报冲突并保留旧分支组快照。
- 流程图9/9校验通过、0错误0警告；桌面尺寸检查通过；人工检查两张中文PNG内容可读。spec SHA256 156637990ac9804e220862e293e2337936de706ec3b443c176852f04e29f6c82；HTML SHA256 b20f863408f341bfa461740fe28e703cf1e578c4448dceb187c36e0afe38a595。
- 文档相对链接、SVG及git diff --check通过；自动图检诊断移至/tmp/v03-terminal-sync-flow.visual-check.*。本轮纯文档/图更新，未改应用代码或project.json，未连接远端，未重启服务，未跑应用测试。

## 最新续接：终端同步需求 v0.2（2026-10-29，用户审核意见已纳入）

- 用户确认：覆盖project.json全部项目；最新commit取SSH服务器本地分支；RTC完整保存RTC1-3103704格式；json/sdb/scripts递归收集且打平；目标configuration/<projectName>/<分支组名>/{json,sdb,.h,xls}，无repoName/scripts层；管理员启动沿用现有登录；提交未变且完整跳过、缺失补齐、变化替换托管快照并移除旧文件。
- 更新 docs/requirements/terminal-sync-review.md 为v0.2，保留用户添加的真实提交信息例子并规范代码块，映射示例改为完整RTC ID。明确.h为字面量目录，type.h/types.hal进入.h、xls进入xls；固定SSH本地refs/heads分支commit读取，禁止fetch/pull或回退其他HEAD。
- 配置打平后的同名冲突及分支组完整发布边界仅为补充建议：同内容合并、多来源留清单；异内容报冲突并保留旧快照，尚非用户单独确认要求。下一步若继续开发，需遵循v0.2已确认项，不能再沿用前轮fetch-origin/repo层目录建议。
- PRODUCT、ARCHITECTURE、WORKFLOW、SEQUENCE_DIAGRAMS和两张PNG/文件SVG/流程HTML/源JSON均同步。流程图9/9校验通过、0错误0警告；四种桌面尺寸无溢出；最终两张中文PNG人工检查可读。流程spec SHA256 80c274c10a75818cc44f029a09c9998df7cecb580e75f289d8c881d34ca4a604；HTML SHA256 20627535774eea6aad40429f3d74be97c2d842e76758e2c2a0eddd5259a5803d。
- 文档相对链接、SVG XML、流程JSON和git diff --check通过。仅文档/配图更新，没有改project.json、应用代码或真实远端，不重启服务；未运行应用测试。图的自动检查诊断文件移至/tmp/v02-terminal-sync-flow.visual-check.*。

## 最新续接：远程终端同步需求审核稿（2026-10-29）

- 用户要求先整理同步需求并配图审核；本轮只编写文档和图，不实现功能、不修改docs/project.json、不连接真实SSH/Git origin、不重启服务。保留既有流水线改动。
- 新增 docs/requirements/terminal-sync-review.md，含明确需求、现有项目/分支组/repo配置结构、commit/RTC数组示例、文件复制表和目录图、异常/重试/回退语义、验收场景及A-G审核项。PRODUCT登记待审核入口，不把建议写成已上线行为。
- 建议方案待审核：全部项目/全部分支组，fetch origin后的分支commit，文件来自同一commit；configuration/<projectName>/<分支组名>/<repoName>/{json,sdb,scripts}，引入repo层防同名覆盖；JSON/SDB递归，scripts只当前层type.h/types.hal/*.xls；RTC格式须真实脱敏提交样例；管理员启动。以上可由用户修订，不能自行当作已确认需求。
- 图解：terminal-sync-flow.html（Archify workflow，9/9校验通过，0 errors/warnings；spec SHA256 e81070da1dd33ac139537e2734acb8dd212c37344ac1f81b814ac6d602d0ec62，HTML SHA256 d63aa59b3cf4e5af7a7d2056200cb700469ab86ee8e491ee1c81b697b4025556），以及assets目录两张中文PNG和文件映射SVG。流程源JSON可供后续调整。
- Archify四种桌面尺寸自动检查无溢出；初始截图缺中文字体，已临时下载Noto字体到/tmp并生成字体子集，嵌入文件SVG及PNG截图导出，未改系统字体或已校验HTML。人工检查两张最终PNG内容可读。诊断receipt/截图移至/tmp/terminal-sync-flow.visual-check.*。文档相对链接、project.json解析、git diff --check通过；纯文档轮未重跑应用测试。
- 下一步：请用户审核需求文档第10节A-G，特别是最新commit来源、目录层级及RTC样例。审核前不进入同步实现。

## 最新续接：BoschVehicleHalHash 随版本持久化（2026-10-29）

- `buildFilteredLogsBySignalIds` 新增返回 `boschVehicleHalHashLines`，复用当前扫描提取的完整行；`collectEvidence` 在筛选后将其写入 `log-versions.json`，与 records/vhal 同存。沿用去重、最多20行、无时间窗/信号ID限制；无日志/无命中为空数组，不重复扫描。Android输入原有行为保留。
- 新增 test/vehicle-hal-hash-persistence.test.ts 两项红绿回归，验证重复行、20行上限、无命中空数组、与Android输入一致、保留原SOC/SCC/VHAL结构。相关6文件29项通过，typecheck及相关3文件ESLint通过。四份Harness已同步。
- 未更改旧运行、真实日志或业务服务；本轮未重跑全量/浏览器/生产构建。

## 最新续接：规则组 Proto 根目录的 VHAL 版本（2026-10-29）

- 参考只读脚本 `/home/huo2wx/project/nextjs/test-vhal-version/extract-vhal-version.js`，新增 `src/server/pipeline/vhal-version.ts`。从当前规则组 `basePaths.proto_dir/type.h` 读取 VER_PRO_CFG，按4位平台+2位主版本+2位次版本解析；忽略注释，校验8位数字字符串。没有使用参考脚本中的硬编码目录，没有缓存，每次运行重新读当前配置。
- collectEvidence 中 SOC/SCC 后调用 VHAL 提取；有无日志包均可记录。log-versions.json 保留schemaVersion=1/records并新增vhal快照（ok/not_configured/unavailable；成功包含file/raw/platform/version）。配置缺失或文件无效不阻断流水线；取消仍传播。
- 在 extract.md、step4_android_qnx_input.md 的版本区块后追加“当前配置的 VHAL 版本”，供Step4/Step5分析，与日志中的SOC/SCC区分；元数据仍不计作信号日志证据。没有变更IndexedDB结构、旧运行或外部配置文件。
- 定向5文件27项通过：vhal-version(4)、log-versions(5)、pipeline-services、pipeline-orchestrator、pipeline-cancellation。覆盖参考编码/注释/非法宏、规则组根目录、每次运行更新、缺失/无效、有无ZIP的落盘和模型输入顺序；未执行真实模型或外部业务操作。
- typecheck、相关3文件ESLint及git diff --check通过。四份Harness及本交接已同步。本轮未重跑浏览器/生产构建和全量测试；上轮全量沙箱限制记录保留，不宣称全量通过。

## 最新续接：日志 SOC / SCC 版本提取（2026-10-29）

- 共享 Jira / 飞书流水线在 collectEvidence 中递归寻找 Buildinfo.txt，读取 MAIN_VERSION 全行作为 SOC；仅流式解码同目录 Scc-*.dlt 的 payload，提取 [Vip-App]App: 后的 SCC。多目录、多文件、多版本保留来源，不跨目录配对。
- 新增 src/server/pipeline/log-versions.ts。版本保存到每次运行 logRoot/log-versions.json，并追加到 extract.md 和 step4_android_qnx_input.md 的 Android 输入末尾，进入后续分析，不受时间窗或信号 ID 过滤影响。不把版本元数据计入结构化信号日志命中。飞书产物白名单支持版本 JSON。
- 7za 从 e 改为 x 保留层级，避免同名文件覆盖和配对错误。真实 ZIP 回归覆盖两个目录内同名 Buildinfo/Scc；缺失、坏 DLT 不阻断其他分析，取消仍传播。旧运行和用户样例未改写，未触发真实外部分析或重启业务服务。
- 用户真实样例只读验证：SOC=rb-chery-idcpro_hqx4560-es11_ip9_release_2026.43.8；SCC=ES11_IP9_2026.43.8。
- 定向4文件23项通过（log-versions、pipeline-services、pipeline-orchestrator、pipeline-cancellation）；版本测试5项含真实样例、递归配对、损坏/缺失、collectEvidence落盘和真实ZIP保留目录。typecheck、相关5文件ESLint通过。四份Harness文档已同步。
- 全量回归未完成：沙箱下出现MySQL连接和SSH监听EPERM、Docupedia新进程JSON为空、operations-cli子进程输出为空，运行长时间未结束后仅停止本轮测试session78339（exit130），没有停止业务服务。上述6文件独立复跑12失败/27通过，见 /tmp/ivacp-versions-unrelated.log；全量中断日志 /tmp/ivacp-versions-tests.log。不能宣称全量通过。本轮未重跑浏览器看板/IndexedDB持久化和生产构建，既有UI未改。

## 最新续接：终端连接稳定性（2026-10-28）

- 连接后的配置扫描和 Git 状态原先分别建立 SSH 连接，exec 没有执行超时；只读请求 30 秒超时会关闭整个 PTY。已改为每会话复用认证连接及独立 exec 通道，20 秒操作时限、保活和资源清理；只读查询超时保留终端并清空队列，写入超时仍断线并提示核对远端状态。
- 合并命令触发的自动状态刷新，断开时清理定时器；连接审计期间缓存首屏输出，避免 connected 之前的提示符丢失。
- 隔离本机 ssh2 Server 验证实际认证、PTY/exec 复用、超时恢复和清理；终端定向测试 25 项通过（随后增加首屏回归）。生产浏览器终端与看板共 6 场景通过，含只读查询超时后继续输入、看板刷新及 IndexedDB。未连接真实业务 SSH。
- 独立目录 `/tmp/ivacp-terminal-check-c6w8znl7` 生产构建通过；隔离预览 3043。typecheck、lint 通过。全量测试 339 项通过、31 项跳过、9 项失败；失败均为 MySQL 127.0.0.1:3306 拒绝连接，不代表终端失败。日志 `/tmp/ivacp-terminal-{all-tests,browser-final,build,types,lint}.log`。
- 已同步产品、架构、流程及时序文档。生效需要更新并重启实际 Terminal Gateway 和前端服务；本轮未重启既有业务服务，避免中断任务。

# IVACP 会话交接

更新时间：2026-10-28。当前续接基线 `f13a069`（前轮分析和数据管理已由用户提交）。完整重构尚未完成。

## 最新续接：团队模板并发一致性

- 基线仍为 `f13a069`，所有既有修改保留。先用唯一临时MySQL模板复现：并发同配置/不同配置发生重复版本主键冲突，作者争用返回SQL错误而非权限原因；旧实现4场景3失败，日志 `/tmp/ivacp-template-concurrency-red.log`。
- 新增 server/templates/template-lock.ts：同一连接读取MySQL排序权重、GET_LOCK(10秒)、执行操作及RELEASE_LOCK；锁名哈希权重而非仅转小写。与team_templates的utf8mb4_unicode_ci/VARCHAR(64)保持一致，大小写、重音、尾空格等价参数共享锁。先复现简单小写门禁下等价键同时进入2个回调，再修复为1个，日志 `/tmp/ivacp-template-collation-red.log`。
- 发布、删除、旧模板迁移行共用门禁；业务SQL和回读仅使用传入连接，避免5连接池被等待者占满后持锁者再借连接的死锁。正常异常释放锁并保留原错误；获取通信失败或释放不确定时销毁连接，不把带锁连接归还。等待超时503穿过发布校验包装，OpenAPI补充503。
- 发布只在最高版本未删除且配置相同时去重，并回读该最高版本。先回退验证混合版本删除状态会错误返回旧配置，再恢复修复；日志 `/tmp/ivacp-template-deleted-red.log`。原作者、管理员代更新保留作者、删除后重新发版及旧版本继续删除的行为保留。
- 迁移模板仍按行/批次提交，不增加整库原子性承诺。migrateTemplates复用锁与连接，模拟测试确认保留全部原字段、merge/overwrite SQL和旧库只读；未对用户旧库执行迁移。
- 新增3个测试文件、15项：7项真实MySQL并发（12同配置、12不同配置、两个独立Node进程、等价键、作者、混合删除状态、发布/删除/重发）；6项模拟锁清理/超时/释放故障；2项迁移门禁。所有数据库任务完成后才按唯一vitest-concurrent-*键清理，未修改用户模板。
- 包括原串行模板用例的定向 **4文件30项通过**；最新全量 **77文件通过/10跳过，348测试通过/26浏览器默认跳过**。lint/typecheck退出0，日志 `/tmp/ivacp-template-lock-{targeted,all-tests,lint,types}.log`。
- 独立副本 `/tmp/ivacp-template-lock-build-x8n_rhgg` 构建退出0，日志 `/tmp/ivacp-template-lock-build.log`。生产预览 **http://127.0.0.1:3033**（exec93507），模板3项与Swagger1项生产浏览器通过，日志 `/tmp/ivacp-template-lock-browser.log`。此浏览器验证不等于真实后端并发（后者由独立MySQL测试覆盖）；本轮未重跑全部26项既有UI场景。
- 未停止/重启3000业务服务，生产构建在独立目录；无Jira/飞书/Qwen/Docupedia/SSH操作。临时排序权重probe只执行SELECT，首次顶层await在CJS失败后已改为async main完成，不是数据库故障。
- Harness、OpenAPI和FINAL_AUDIT已同步；模板并发从待审计转为已有证据。门禁依赖当前MySQL列排序规则；更改该规则需同步权重语义，实例中其他数据库同名权重可能被一并串行但不会混淆数据。
- 下一步继续迁移关系/产物路径和API协议全量对照，整理Harness旧路径/表名，验证性能门槛及中文图形产物；真实业务环境仍未完整验收，完整目标保持进行中。计划 `docs/superpowers/plans/2026-10-28-template-concurrency.md`。

## 最新续接：Docupedia 统计与协议专项审计

- 基线仍为 `f13a069`，此前修改全部保留。按原实现/原测试保留严格超过500个UTF-16代码单元的统计阈值；700为Harness残留，已同步四份文档。原版与当前代码的随机文章前缀均为meegle_，jira_文档残留也已核对修正，未改变实际标题生成行为。
- source/server实际路径为 src/server/docupedia；新增DOCUPEDIA_STAT_MIN_CHARACTERS=500供阈值与成功日志共用，避免二者漂移，没有修改原统计门槛。
- 新增 docupedia-stats.test.ts 5项：500/501及emoji UTF-16边界、同月30并发请求/10唯一标题按序累计、跨月、本地时区与UTC时间、独立新进程续计与末尾换行、JSON损坏文件不覆盖及修复后队列继续。
- 新增 docupedia-client.test.ts 5项：Step合并只计文章一次、目录/评论/真实二进制排除、统计写失败不改变已成功归档、失败文章不计数/关闭不发请求、瞬时错误退避与curl502耗尽、上限抖动、失败后继续下一文章及100–150秒节流请求。HTTPS全部拦截，长节流仅在测试中加速，没有真实发布。
- 先复现永久403只尝试1次却报告配置最大3次，已在withDocupediaRetries记录实际attemptsUsed并修复错误文本。重试策略与生产等待不变。
- 初版图片fixture写成中文文本，内容检测因此按文章处理并触发生产节流；已改为含NUL的二进制样例，终止的仅是本轮自建Vitest进程，没有停止预览或用户业务服务。后续使用模拟长等待验证节流参数。
- 定向3文件14项（含清理保护4项）通过；最新全量 **74文件通过/10文件跳过，333测试通过/26浏览器默认跳过**。lint/typecheck均退出0，日志 `/tmp/ivacp-docupedia-{targeted,tests,lint,types}.log`。没有重跑未改变的26项UI验收；既有证据保留，不能混称本轮重跑。
- 独立副本 `/tmp/ivacp-docupedia-build-h3528xf8` 构建退出0，日志 `/tmp/ivacp-docupedia-build.log`；预览 **http://127.0.0.1:3032**（exec41078）。HTTP冒烟：/login与/api/openapi返回200，未登录首页307。未重启/停止3000用户服务，没有在工作目录执行生产构建。
- docs/FINAL_AUDIT.md 的Docupedia统计待办转为已补证据；多进程同时写同一统计文件仍不在原实现承诺内，真实远端认证/权限/发布闭环仍未验收。计划 `docs/superpowers/plans/2026-10-28-docupedia-audit.md`。
- 下一步继续模板同标识并发发布验证（包括版本/去重/权限与池连接耗尽边界），随后迁移关系、API协议、文档旧表路径整理、性能门槛与中文图形产物。完整目标继续保持进行中。

## 最新续接：完整审计与运维工具遗漏修复

- 基线仍为 `f13a069`，此前所有未提交修改保留。完整目标未完成；本轮开始从原项目页面、API和脚本盘点，新增 docs/FINAL_AUDIT.md 记录证据及未验证项，不用导航入口齐全替代完成。
- 当前枚举：原13页面/50API/58路由方法组合，新12页面/52API/61组合；参考API路径与方法均保留。页面重定向集中 next.config.ts，Geely2按确认移除；接口载荷与业务副作用仍需继续逐模块审计。
- 先用失败CLI测试发现 package.json 的六个运维命令引用文件缺失。已恢复附件下载、清理、指标基线、准确率、覆盖、真值导出，以及原独立CAN回放入口。下载脚本与原版SHA-256完全相同，保留全部Node/curl/Windows/PowerShell下载后端、分片、筛选和重试选项。
- 准确率/覆盖/真值脚本拆为薄入口与 server/evaluation 服务；共用目录收集器兼容旧父目录及Jira/飞书独立run，排除失败/取消/缺完整响应的运行。迁移复制会改变mtime，已先复现再改为优先指标completedAt，旧无时间才回退mtime。
- 真值导出只读 sync_records 的 reviewSamples/ruleGroups，使用统一ReviewSample/序列化/目录名规范化；--owner支持两种写法，--dry-run不写文件，合并保留手写条目。未导出真实用户样本。
- cleanup:data保留默认90天与Docupedia月度统计，新增只读预览，拒绝非正/无穷天数；测试只清理临时目录，未动用户日志或缓存。
- replay_cantrace.py复用现有plot_can_signals.py的解码/周期/时钟/绘图，保留信号JSON、多个DBC、Proto、摘要、图形及json-only；独立真实ASC/DBC测试验证数据、映射和PNG。Python缓存加入.gitignore，不删除任何已有缓存。
- README替换create-next-app脚手架，说明实际分层、环境、迁移、测试和全部运维入口。Harness新增当前工具流程，删除一个不存在的旧npm测试命令，并明确其余归档统计边界待审计。
- 新增4文件9项工具测试：全部package脚本路径、无副作用help、清理预览/删除/保护、临时日志CLI报告、目录完整运行/完成时间选择、模拟镜像真值合并、本地HTTPS假Jira筛选/重名/跳过/覆盖、独立CAN回放。全量 **72文件通过/10跳过，323测试通过/26浏览器默认跳过**；lint/typecheck退出0。日志 `/tmp/ivacp-cli-{all-tests,targeted,download,replay,lint,types}.log`。
- 独立副本 `/tmp/ivacp-operations-build-v66y60s0` 构建退出0，日志 `/tmp/ivacp-cli-build.log`；预览 **http://127.0.0.1:3031**（exec22966），该生产副本看板2场景CRUD/角色/IndexedDB刷新冒烟通过，日志 `/tmp/ivacp-cli-browser.log`。未停止或重启用户3000服务，也未覆盖工作目录生产构建。此前3030的10文件26场景生产完整回归作为未改UI部分的既有证据保留，不描述为本轮全量浏览器重跑。
- 没有下载真实Jira附件、发送Qwen/飞书/Docupedia请求或操作真实远端；HTTPS服务器和测试凭据全部本机临时。原有MySQL测试仍只操作唯一测试记录并清理，真值SQL单元测试用模拟池。
- 下一步按 FINAL_AUDIT：Docupedia统计原/当前实现均为>500字符，Harness写>700，需核对并统一后补阈值/去重/重启/并发/跨月测试；模板并发版本分配、文档旧表/路径整理、性能门槛、中文图形产物及迁移关系/协议边界继续审计。没有因这些待办而缩小原完整目标。计划 `docs/superpowers/plans/2026-10-28-operations-tools.md`。

## 最新续接：智能助手完整流程

- 基线仍为 `f13a069`，保留此前所有未提交工作；本轮对照原 ChatSidebar、NotesPanel、memory-service，核对对话/知识库/记忆/笔记全部主要交互。完整重构仍需最终需求逐项审计。
- 先用浏览器失败用例复现关闭抽屉后重新打开丢失 busy/停止入口。新增 features/chat/lib/chat-runtime.ts，按账号保存当前标签页运行状态、取消控制器和订阅；ChatPanel 用 useSyncExternalStore 订阅、useAsync 读取持久消息，关闭重开不重复请求或允许清空进行中对话。
- NDJSON 必须收到 done 才接受成功回复；截断、停止或模型错误不保存半截助手消息、不抽取该轮记忆。检索和模型返回后均检查取消；UTF-8逐字节分片、停止后晚到上下文/完整回复均有测试。reader在错误/停止时释放。
- 四类无归属记录使用跨表事务认领，不覆盖其他账号。文档上传服务层校验大小、支持的文本格式和空/二进制内容；向量失败降级关键词检索。
- 笔记事务外向量化，短写事务比较原记录；编辑器提交打开时基线，冲突不覆盖新修改、不复活删除，保留草稿。返回列表会重新读取最新记录，新增浏览器场景通过回退修复复现失败再恢复验证。
- 3文件12项服务测试通过：流完整性、账号运行隔离、孤儿归属、笔记并发/删除、文档过滤/关键词降级、笔记20版历史/归档召回、处理记录重复导入且不含曲线、记忆UPDATE/NOOP/置顶/遗忘/用户隔离。
- 助手浏览器最初3项通过，再补处理/历史/标注导入和确认删除、笔记冲突恢复共5项；覆盖引用、记忆召回、账号切换、刷新、停止与失败继续提问、375/768/1440px。外部模型/向量/记忆API均mock，无真实业务知识发送。
- 首次完整生产25项有1项模板文件测试在会话权限未就绪时直接操作隐藏input；修正为等待实际「从文件应用」按钮可用，并断言具体车型配置错误，避免假阳性。修正后的25项全部通过；新增冲突用例后最终生产 **10文件26场景全部通过**，日志 `/tmp/ivacp-chat-production-browser-complete.log`。
- 最新全量 Vitest：68文件通过、10文件跳过；314项通过、26项浏览器默认跳过。lint/typecheck退出0，日志 `/tmp/ivacp-chat-{tests,lint,types,targeted}.log`。
- 初版独立目录 `/tmp/ivacp-assistant-build-kcripfaz` 构建退出0，预览3029（exec9574）；最终独立目录 `/tmp/ivacp-assistant-final-5uwoywmx` 构建退出0，日志 `/tmp/ivacp-chat-build-final.log`，预览 **http://127.0.0.1:3030**（exec15734）。开发3021保留。未停止/重启3000用户服务，未在工作目录执行生产构建。
- 运行状态仅当前标签页内存；关闭抽屉可继续，整页刷新不恢复原网络请求，只读取已经提交的记录。未新增跨标签页聊天租约或服务端任务；所有现有数据仍在统一IndexedDB与既有镜像中，无schema变化。
- 下一步：按原页面、API、脚本和Harness逐项完成最终功能审计，核对迁移及文档中的旧实现说明；外部真实业务验收仍未完成，不能把mock绿色检查描述为全部目标完成。计划 `docs/superpowers/plans/2026-10-28-assistant-workspace.md`。

## 最新续接：团队模板库功能对照

- 基线仍为 `f13a069`，保留此前全部未提交工作；本轮完成团队模板库的功能对照和失败交互修复，完整重构仍未结束。
- 对照原 TemplateLibraryDialog、模板领域模型及当前服务端：保留发布/同配置去重/版本递增、搜索、文件与远程下载、应用新规则组/计数、作者或管理员软删除全部版本，以及普通成员发布下载权限。
- 先以 8 项失败测试复现 parseTemplate 直接断言任意 model_to_files，损坏配置会进入 IndexedDB；新增 domain/rule-groups/model-files.ts 提供共享 schema，规则组备份导入与模板统一复用。JSON 数组、DBC 逗号字符串兼容规范化；非法对象/字段在创建规则组前拒绝。没有改变数据库 schema。
- 浏览器复现删除失败后确认框误关闭：原因是 useAction 吞掉异常，ConfirmDialog 误认为成功。改为删除动作向确认框透传异常，原地显示错误并可重试，成功才关闭。
- 新增 template-validation 和 templates-browser 测试：管理员发布/重复发布去重、导出内容、搜索、远程应用计数失败不重复建组、看板与刷新持久化、服务器故障时文件应用、坏文件不写库、删除失败重试且保留已应用组；普通成员下载/发布/仅删自己/禁止应用，375/768/1440px无溢出。
- 本轮定向 3 文件 36 项通过；最新全量 65 文件通过、9 文件跳过，302 项通过、21 项浏览器默认跳过；lint/typecheck退出0。开发模板浏览器3项通过。日志 `/tmp/ivacp-templates-{targeted,validation,tests,lint,types,browser}.log`。
- 独立构建目录 `/tmp/ivacp-templates-build-8opth24s`，最终构建退出0，日志 `/tmp/ivacp-templates-build-final.log`；生产浏览器 **9文件21场景全部通过**，日志 `/tmp/ivacp-templates-production-browser.log`；预览 **http://127.0.0.1:3028**（exec30835），开发3021（exec15528）。没有重启或停止用户3000/PID1234807服务，生产构建均使用独立副本。
- 浏览器全部业务API mock，仅本地认证正常读取；现有 MySQL 模板集成测试读取 .env 的 MYSQL_URL，使用唯一 vitest-* 临时记录验证版本/去重/权限/应用计数并在 finally 清理，不改用户模板。未进行真实 Jira/飞书/SSH/云服务操作。
- 后续继续聊天、知识库、记忆、笔记完整交互及全项目业务验收；模板并发发布等边界还可进一步审查，不能据当前页面验收宣称全部重构完成。计划 `docs/superpowers/plans/2026-10-28-template-library.md`。

## 最新续接：统计身份对照与修复

- 本轮仅处理统计迁移对齐；基线仍为 `f13a069`，保留所有此前未提交修改，完整重构尚未完成。
- 对照原 AnnualStatisticsDialog、loadAnnualStatistics、statistics-records 发现：统一结果表的 ticketKey 只是飞书工作项 ID，原实现丢失了项目/类型身份，跨项目同号被合并。3 项失败测试先复现，再修复共享提取逻辑。
- 结果按 snapshotId、历史按 sourceSnapshotId 关联原分析快照；身份不完整时回退 assignmentId 对应分配。完整身份为项目/类型/字符串化 ID 元组；无法关联时按分配 ID 隔离，连分配 ID 都没有的旧记录沿用 ticketKey，丢失的上下文无法恢复。Jira 保持票号口径。
- 本地统计使用四表 Dexie 只读事务；团队 MySQL 投影新增关联 ID、飞书最小身份行，按 owner 隔离。上下文可能早于统计时间范围，不按其创建时间过滤；接口仍仅返回聚合数字，无 schema 变化。
- 浏览器发现团队请求失败后仍可复制上次本地报告；已先复现失败断言，再禁用失败状态的复制按钮和复制函数，重试成功恢复。
- 新增 statistics-identity/local/mirror-query/browser 四个测试文件：跨项目/类型、同票重跑、历史原快照优先、缺上下文回退、账号隔离、真实 fake-indexeddb 重读、SQL 投影链路；页面验收刷新、月份校验、团队失败重试、剪贴板内容与窄屏。
- 最新全量 Vitest 64 文件通过、8 文件跳过；294 项通过、18 项浏览器默认跳过。全量 lint/typecheck 退出 0，定向 3 文件 5 项通过；开发统计浏览器 1 场景通过。日志 `/tmp/ivacp-statistics-{tests,types,lint,targeted,browser}.log`。
- 独立构建目录 `/tmp/ivacp-statistics-build-qkvwbv88`，构建退出 0；生产预览 **http://127.0.0.1:3027**（exec92570），原用户3000服务未停止、重启或重建。本轮未改写工作目录 .next。
- 首轮生产回归17项通过、1项终端HTTP请求在localhost超时；改用绑定地址127.0.0.1后终端3项通过，最终用127.0.0.1完整生产回归 **8 文件 18 场景全部通过**，日志 `/tmp/ivacp-statistics-production-browser-final.log`。测试只使用隔离浏览器数据、mock API/镜像和临时数据库；未连接真实MySQL执行统计或任何外部写入。
- 下一步继续模板库及聊天/知识库/记忆/笔记完整功能对照；真实业务系统验收仍未完成。计划 `docs/superpowers/plans/2026-10-28-statistics-identity.md`。

## 最新续接：指定 Jira 票号分析

- 基线仍为 `f13a069`，此前标注/API/终端与本轮改动均未提交；保留所有现有修改，不reset或整体提交。完整重构尚未结束。
- 新增 `features/direct-analysis` 服务与首页组件：显式默认/Bosch站点、票号格式校验/转大写、准确核对查票返回、首个[]/【】车型匹配当前站点全部规则组。保留原版“全部匹配组”行为，不依赖该组JQL。
- 不创建临时filterRun，不改写批量列表；直接复用统一process队列/task/result/history，显式重跑保留历史，逐组显示实际任务状态。processTicket现在返回真实ProcessTask或undefined，不能因其已捕获HTTP失败就误报成功。
- 同页同站点/票号单飞，跨标签页沿用统一事务门禁；查询取消后晚到响应不启动分析。审查发现出队使用旧配置，已通过完整分析配置签名检查修复并用真实限流队列红绿验证；配置变化的组跳过。
- Jira inflight/事务任务门禁、归档、完成响应按快照provider隔离。同组更换站点后同票号不会复用另一站点的任务或归档，旧无站点记录保留原组推断兼容边界。
- ticketHref/详情增加provider查询参数与候选维度，默认/Bosch同票号可选择且相互隔离；兼容已有无provider链接（多个上下文时先选择）。
- 快照新增非索引可选analysisTrigger=direct，无DB版本变化。单一只读事务关联快照/任务/组产生“最近单票分析”，按站点/组/票取最新、最多8项。刷新首页后可打开旧结果，不重新调用分析。
- 收尾核查发现服务端Jira父目录仍共享，已补run日志独立/重复ID409与默认-Bosch缓存隔离；同站点缓存继续复用。额外审查指出复核旧查找会读父目录，已新增精确run读取，明确缺run返回404，不回退；旧无run调用保持兼容。
- ProcessResponse/ProcessResult新增analysisRunId与analysisGroupName（非索引）；服务端确认回传，客户端与task.id核对后保存；AI复核据此提交runId及分析时目录名，组改名或删除不影响原run定位，旧结果不编造。飞书AI复核payload修复meegle-前缀与artifactRef转发。
- 新增临时本地目录的Jira产物/cache回归、7项mock Qwen复核证据测试、运行ID保存/拒绝错误ID与旧结果兼容测试，未调用真实模型。
- 服务/生命周期/详情定向测试通过，新增产物与复核证据测试通过；单票开发浏览器3场景通过，覆盖分析员入口、逐组失败、重跑历史、详情与最近记录刷新、Bosch站点、非法/缺票/缺车型拒绝及375/768/1440px无溢出；只读审查及最近记录复查通过。
- 最新全量Vitest：61文件通过、7文件跳过；289测试通过、17浏览器场景默认跳过。全量ESLint/typecheck通过。独立第一轮生产副本 `/tmp/ivacp-direct-build-mcrmurwg` 构建退出0，预览3025（exec49973）、开发3021（exec31245）；最终副本 `/tmp/ivacp-direct-final-3se6zoi3` 构建退出0，最新预览3026（exec15773）。未停止/重启用户现有3000/历史3017服务，未提交真实Jira或模型分析。
- 第一轮与最终独立副本生产7文件17场景均通过（最终日志/tmp/ivacp-direct-final-browser.log）。中途一次构建误在工作目录完成（改写.next）；已确认用户服务PID1234807未重启且3000/login返回200，未停止任何业务进程。日志 `/tmp/ivacp-direct-{tests,all-tests,browser,production-browser,build,lint-full,types}.log`；截图 `/tmp/ivacp-direct-desktop.png`。计划 `docs/superpowers/plans/2026-10-28-direct-jira-analysis.md`。
- 下一步为统计、模板、聊天、知识库、笔记与记忆完整交互对照，及全项目真实业务环境验收；不把绿色mock验收当作外部系统真实业务验收。

## 最新续接：远程终端工作台

- 当前基线仍为 `f13a069`，前轮标注/API及本轮终端改动均未提交；不要reset、清理或整体提交。目标是保留除Geely2外全部原功能，完整重构尚未完成。
- 新增 `/terminal` 薄路由与 `features/terminal` 分层：配置校验、命令生成与Git文件解析、文件读写、独立SessionClient、xterm生命周期、每标签工作区和Repo面板。xterm仅浏览器动态加载。
- 保留原版所有主要入口：脱敏目标与确认连接、多标签PTY/复制粘贴/resize/断开重连；项目cd、分支stash fallback、配信号目录、一键checkout/pull；Git逐文件add/checkout/reset；配置信号默认全选/恢复未选；xls/dbc/mcu.h上传、脚本zip和清单下载、可拖拽/键盘调整侧栏。危险操作仍需界面确认。
- `domain/terminal/context.ts` 提供完整项目/目录/分支/repo签名；结构化协议新增可选requestId/contextKey并由Gateway回显。客户端串行关联、拒绝旧下载与旧上下文回复、上传完成前复核连接/项目；20秒连接、30秒操作超时关闭会话。
- 前端与Gateway需配套更新，旧Gateway没有关联字段时不把无归属响应当成功。没有自动重启任何现有Gateway或真实业务服务。
- Gateway修复先用隔离测试复现：普通多行输入逐行护栏、被拦截/审计失败时清除已发送PTY前缀、异步审计输入串行；浏览器关闭后晚到SSH与审计失败连接都释放。
- Git文件动作校验非空具体相对路径与仓库归属，统一`--literal-pathspecs`+`--`。审查复现`:/`/通配符会撤销全库，已在临时Git仓库红绿验证关闭缺口；不触用户Git仓库。
- 客户端只读审查通过，Gateway只读复查通过。定向3文件27测试通过；开发浏览器3场景通过，覆盖确认/多标签/输入剪贴板/resize、项目分支/Git配置/上传下载/面板宽度，以及配置/认证/动作失败重试、旧上下文与分析员禁用。375/768/1440px无横向溢出。
- 最新全量Vitest：58文件通过、6文件跳过；268测试通过、14浏览器场景默认跳过。最新全量ESLint、typecheck通过。
- 本轮构建在独立副本 `/tmp/ivacp-terminal-build-5gwl4v9_`，`npm run build -- --webpack`退出0。生产预览3024（exec39253），开发验收3021（exec59968）；未操作3017。生产6文件14浏览器场景完整回归通过，包含看板CRUD/刷新持久化、分析、数据管理、标注、Swagger与终端。
- 日志 `/tmp/ivacp-terminal-{all-tests,unit,browser,production-browser,build,lint-full,types}.log`；截图 `/tmp/ivacp-terminal-desktop.png`，中文字体限制仍存在，文本用DOM核验。
- 没有连接真实SSH、修改远程仓库或上传真实文件。测试WebSocket全部mock，只有Gateway pathspec用临时本地Git仓库验证实际语义。真实白名单目标认证与用户操作需业务环境验收。
- 本轮计划 `docs/superpowers/plans/2026-10-27-terminal-continuation.md`；指定Jira票号入口已在2026-10-28接通；后续核对统计、模板、聊天、知识库、笔记与记忆完整交互。不能因导航入口已齐就宣称完整迁移完成。

## 最新续接：数据标注工作台

- 新增 `/labeling` 薄路由，`src/features/labeling` 拆分请求服务、草稿转换/暂存、工作台、详情及编辑器。
- 列表支持来源、标注状态、原复核状态、问题场景、票号/标题查询；最多500条并提示截断。展示原结论、信号摘要、人工复核和AI建议。
- 建议只显式应用；保存前复用领域规则，非法组合不发请求。复核员/管理员可保存与确认撤销，分析员只读。显示版本、标注人，失败保留草稿及既有标注。
- JSONL下载保持文本，包含当前账号全部有效标注且不受列表筛选影响；错误响应不下载。不写原始分析、不自动回灌训练集。
- 草稿切换/筛选/刷新/普通站内链接离开确认；刷新beforeunload保护。历史前进后退不修改Next历史栈，通过sessionStorage按账号+itemId恢复未保存草稿（重新选原条目）；格式v1，服务器基线内容变化不自动恢复，保存/撤销/明确放弃后清除。
- 草稿恢复存在失败提示，浏览器禁用存储时仍可编辑，离开前应保存。该暂存仅界面状态，独立标注业务数据仍存既有MySQL。
- 只读质量审查发现并修复应用内链接与history导航丢失草稿，最终复查通过。
- 标注阶段全量Vitest：54文件通过、4文件跳过；236测试通过、10浏览器场景默认跳过（本轮最终计数见后续API段）。标注定向2文件13测试通过；开发浏览器4场景通过，覆盖错误重试/刷新、JSONL、过期详情、草稿、权限、375/768/1440px无溢出。
- 日志：`/tmp/ivacp-labeling-{tests,unit,browser,lint-full,types,build}.log`；标注生产浏览器4文件10场景全部通过。截图 `/tmp/ivacp-labeling-desktop.png`（宿主仍缺中文字体，中文用DOM核验）。
- 为不影响当前3017真实服务，本轮在独立副本 `/tmp/ivacp-labeling-build-2wakpkql` 运行 `npm run build -- --webpack`；该副本链接根目录node_modules和现有环境文件。新功能开发预览3021（exec10715），独立生产验收3022（exec25356）；**3017保留前轮构建，未停止或重启**。不要把3022当作已更新3017。
- 当前改动未提交，勿reset或清理。计划 `docs/superpowers/plans/2026-10-27-labeling-workbench.md`。

## 最新续接：OpenAPI 与本地 Swagger

- 已连接 `/api/docs`、`/api/openapi`、`/api/docs/assets/[file]`，新增 `swagger-ui-dist` 5.34.0 依赖；固定JS/CSS白名单，资源从安装的node_modules读取，不拼接用户输入，不访问CDN或外部规格校验器。
- `src/server/openapi/legacy-spec.ts` 保留参考系统基础描述，`spec.ts` 修订当前接口与鉴权，`contracts.ts` 定义当前标注、模板和飞书规则组结构。Cookie使用`ivacp_session`，移除误导性的浏览器Jira Basic Auth定义；文档不会授予业务权限。
- 规格覆盖当前52个API路由及全部导出方法；测试对照实际路由、引用、路径参数、operationId、角色。共享处理改用当前扁平请求/响应，列出统一镜像表名，补飞书、聊天、记忆和迁移预检/执行。
- 审查指出标注/模板/飞书规则组请求过于空泛，已补真实必填、枚举和示例，并使用实际validateAnnotation、parseTemplate验证；最终只读审查通过。
- 浏览器曾复现Webpack把createRequire.resolve改为(rsc)/虚拟路径导致资源500，已改为安装目录固定文件路径。开发浏览器验收通过（无登录公开文档、本地资源、完整规格、无外网和业务写请求、375px）。
- 最新全量Vitest：55文件通过、5文件跳过；241测试通过、11浏览器场景默认跳过。OpenAPI定向5测试通过；最新全量lint、typecheck通过。
- 最新独立生产构建副本 `/tmp/ivacp-openapi-build-ocj8oq_s`，`npm run build -- --webpack`退出码0；最终生产浏览器5文件11场景全部通过（含看板/分析/数据管理/标注/Swagger）。最新预览3023（exec2528），开发3021（exec10715），标注阶段验收3022（exec25356）。**3017未重启，仍是用户原先服务**。
- 日志 `/tmp/ivacp-final-{tests,build,browser}.log`、`/tmp/ivacp-openapi-{tests,browser,types,lint-full}.log`。计划 `docs/superpowers/plans/2026-10-27-openapi-continuation.md`。

以下保留前轮实施与真实工单中断记录供追踪。

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
2. 标注、API文档、终端、指定Jira票号入口已接通；继续完整功能对照。
3. 直接工单key分析/车型匹配已接通；复查统计、模板、聊天、知识库、笔记和记忆完整交互。
4. 检查真实运行最终产物与恢复；不得自行重复处理、回填、群通知或迁移用户数据。
5. 全部功能对照与真实业务验收完成前，不将当前绿色测试描述为全项目重构完成。
