// 本轮分享内容：实现事实来自当前源码，运行结果来自注明日期的交接记录。
export const pages = [
{title:'IVACP 近期进展与 Loop 实战',sub:'团队技术分享 · 2026.11.02 · 约 30 分钟',minutes:1,kind:'cover',take:'接通业务来源，沉淀团队经验，让开发依据验证结果继续推进',refs:[['docs/PRODUCT.md','首页右侧对话'],['session-handoff.md','project.json 导入/导出']],notes:`今天分享近期九个方面的进展，核心是一条工作链：把 Jira 和飞书中的问题接进来，用同一套分析能力处理，把人工判断沉淀成可复用资产，再用更严格的工程方式继续开发系统。
前面约十九分钟讲业务能力：飞书与 Bosch Jira 如何接入，知识库、记忆、统计、模板、标注分别解决什么问题，以及最近新车型暴露出来的版本和配置问题。后面约十一分钟讲终端扩展和开发方法，包括 Harness 的约束、Loop 的反馈闭环，以及我们已经留下记录的一次自修复。
分享中的“已实现”主要依据当前源码；测试数字会明确引用交接记录，不表示今天重跑了真实业务。最后的留言板自动开发案例是我在其他项目中见到的做法，自己尚未尝试；它用于启发下一步，不算 IVACP 已经上线的能力。`},
{title:'飞书接入：先建立同一运行环境的登录态',sub:'参考 feishu_space_access.md；当前入口是飞书项目 Meegle CLI',minutes:2.5,kind:'auth',take:'应用登录与飞书 OAuth 独立；服务必须能读取执行 CLI 的系统用户登录态',refs:[['docs/feishu_space_access.md','前置条件'],['src/server/meegle/cli-command.ts','executeMeegle'],['src/server/meegle/cli.ts','AUTH_REQUIRED'],['docs/WORKFLOW.md','飞书项目 MQL 筛票流程']],notes:`先解释“接入”的第一层：我们接的是飞书项目工作项，也就是 Meegle，不是用一个群机器人替代项目 API。接入文档记录的路线是安装 meegle CLI，完成 OAuth 登录，再验证空间访问和当前待办。项目服务端通过 Node 的 spawn 启动 meegle，参数按数组传入，统一读取 JSON 响应，并处理超时和输出限制。
第一步执行 meegle auth status --format json，检查 authenticated 和 host。未登录时执行 meegle auth login --host project.feishu.cn，浏览器完成 OAuth。当前代码对失效登录给出的服务端排障提示是 meegle auth login --device-code --host project.feishu.cn，适合在服务运行环境中重新授权。关键是用运行 Next.js 的同一个系统用户和环境执行，而不是只在自己另一台电脑登录。
第二步用 meegle project search --project-key <空间Key> --format json 验证空间权限。文档中的 PROJECT_KEY、具体空间和“24 条待办”是当时的配置与查询快照，今天不把它当成实时数量。第三步用 meegle mywork todo --action todo --page-num 1 --format json 检查当前用户待办，区分 todo、done、overdue 和 this_week。
应用账号决定谁能进入 IVACP；CLI 的 OAuth 决定服务能访问哪个飞书空间，两套身份不能混同。文档还给出了直接调用 Open API 的备选路线，需要插件安装授权、插件 Token 和用户 Key；当前主路径沿用已登录 CLI，所以不能说浏览器在持有插件 Token 直接调飞书。认证失败必须报错，不能当作成功查到了零条。`},
{title:'飞书工作流：MQL 定范围，人工决定回填',sub:'当前完整 MQL 从 FROM 解析空间；“我的待办”仅是接入验证与旧查询兼容',minutes:2.5,kind:'feishu',take:'来源适配后复用共享分析；完整身份、原 run 恢复和独立回填记账防止串票与重复写入',refs:[['src/server/meegle/mql-filter-run.ts','workitem'],['src/server/meegle/cli.ts','buildMeegleWorkItemGetArgs'],['src/server/meegle/comment.ts','buildMeegleCommentAddArgs'],['src/server/meegle/workflow.ts','list-state-transitions'],['src/features/tickets/services/process.ts',''],['docs/WORKFLOW.md','IVACP 已接通的分析流程']],notes:`接入验证通过以后，真正的生产范围由规则组 MQL 决定。完整语句在 FROM 中明确 project_key 与工作项类型，服务端调用 meegle workitem query --project-key <空间Key> --mql <完整MQL> --format json。当前用户待办为空，也不能因此阻断完整 MQL。一个工作项命中多个规则组时，按排序再按 ID 决定唯一归属。
请沿着图读一次：筛选，获取工作项上下文，建立独立任务与输入快照，调用共享分析，保存结果与证据，人工复核后回填。读取详情用 workitem get，并请求全部字段和 envelope；评论、评论附件与附件插件资料补成分析输入。身份要保留项目、工作项类型和 ID，不能只靠一个数字。每次分析还有单独 runId，防止新旧运行相互覆盖。
共享分析入口是 POST /api/issues/process，后面与 Jira 共用信号、CAN、日志、版本检查和结论处理。刷新后只从同一 run 的完整成功产物恢复，不是任意阶段都能断点续跑。成功空 MQL 会解除未再命中的当前归属，保留结果与历史；查询失败则保留原归属并展示失败，不能把旧成功快照伪装成本次命中。HTTP 200 还需要看内部成功组和审计。
最后是外部写入：评论通过 comment add --params <JSON>，有图时先 attachment +upload；状态先用 workflow list-state-transitions 查询，再按授权 transition-state。评论和状态分别保存，评论成功但流转失败时只重试流转。人工复核门禁、目标绑定授权及防重仍然存在；模型建议本身不会触发对外回填。`},
{title:'Bosch Jira：连接适配不同，分析内核共用',sub:'项目通过 TypeScript 调用 REST API；“bosch-jira”是来源配置，不是同名 CLI',minutes:3,kind:'bosch',take:'把差异留在连接、分页、身份和回写适配层，让证据分析只维护一套',refs:[['src/server/jira/connection.ts','getJiraConnection'],['src/server/jira/filter.ts','MAX_TOKEN_PAGES'],['src/server/jira/comment.ts',''],['src/server/jira/transition.ts','accountId'],['src/features/tickets/services/process.ts',''],['src/server/pipeline/process/orchestrator.ts','processIssue'],['docs/ARCHITECTURE.md','Bosch 筛票']],notes:`Bosch Jira 接入的关键是来源适配，不是复制整套平台。管理员创建 Bosch Jira 规则组，保存 jiraProvider: bosch、JQL、车型文件和提示词；该组不配置飞书 MQL。getJiraConnection 根据 provider 选择服务地址、认证和分页方式。服务端从 BOSCH_JIRA_URL、BOSCH_JIRA_USERNAME 与 API Token 读取连接，组成 Basic Auth；代码兼容小写 bosch_jira_api_token、大写 BOSCH_JIRA_API_TOKEN，并保留密码兜底，实际分享不要展示任何真实凭据。
这里“使用了哪些指令”要分清：当前项目没有执行名为 bosch-jira 的命令，它是发 HTTP 请求。Bosch 筛票使用 POST /rest/api/2/search/jql，每页最多一百条，通过 nextPageToken 最多读取二十页。默认 Jira 用另一个搜索路径和分页口径，不应该把两者机械套用。
查到工单后，适配层把字段整理成统一的标题、描述、评论与附件结构。浏览器用同一 processTicket 生命周期建立快照和任务，再进入 POST /api/issues/process。服务端 orchestrator 组织附件下载、需求与信号提取、CAN 解码、Android/QNX 日志、版本检查和结论；复核、历史与证据展示也尽量共用。某条附件路径提前结束，不表示所有阶段都执行了。
回写仍按来源处理：评论调用 POST /rest/api/2/issue/{key}/comment，附件走 attachments；状态走 transitions，经办人走 assignee，Cloud 指派使用 accountId。工单快照保留原 Jira 站点，规则组后来删除或改变也不能把 Bosch 结果写去默认 Jira。
共用工作流的价值是，一处修复信号映射、版本判断或证据保存，三个来源都能受益。边界同样清楚：共享的是分析内核与生命周期；外部凭据、分页、完整身份和回写 API 仍要各自准确处理。`},
{title:'知识库与记忆：让资料和经验在需要时被找回',sub:'对话知识、个人长期记忆、分析纠错样本承担不同职责',minutes:3,kind:'knowledge',take:'当前主要增强检索与上下文，不会因为导入文档或标注就自动训练模型',refs:[['src/features/chat/lib/knowledge-service.ts','MAX_FILE_BYTES'],['src/features/chat/lib/conversation.ts','retrieveChunks'],['src/features/chat/lib/memory-service.ts','rememberExchange'],['src/server/chat/memory.ts','EXTRACT_PROMPT'],['src/domain/knowledge/memory-core.ts','HALF_LIFE_DAYS'],['src/features/tickets/services/few-shot.ts',''],['src/domain/analysis/few-shot-rerecall.ts',''],['docs/PRODUCT.md','首页右侧对话']],notes:`这部分最容易把几种“记忆”混在一起。第一条是知识库：上传 txt、md、json、csv、log 等文本，单文件不超过两 MB，切分成段并生成向量，提问时检索最多四段进入 Qwen 上下文，回答标明参考文档。向量服务不可用时降级为关键词检索；笔记也可参与检索。可按票导入当前浏览器的已处理结果、历史与人工复核样本，不导入曲线；服务器标注工作台的数据尚未自动回灌。
第二条是用户长期记忆。每轮对话后，模型抽取稳定事实、偏好、目标或重要事件，例如“用户负责某车型的 Vehicle 模块”“习惯先看 CAN 再核对 Android 日志”“某次配套版本问题已经确认”。这些是适合记忆的示例，并不表示系统已经记住了这些具体事实。它会找相似旧记忆，再决定新增、更新或忽略；查询时综合相似度、重要度和时间衰减，最多召回五条。可以手动添加、置顶或删除。衰减半衰期九十天，长期不用且重要度低的非置顶记忆才可能遗忘，不是所有记忆九十天就被删除。
第三条是分析纠错样本，它直接服务工单分析：保留错误结论、人工正确结论、错误类型，并按规则组、场景及相关性召回 few-shot。当前已经加入标识符、中文词法和向量召回，并能在证据形成后再次检索和留审计；这是另一条受业务边界约束的 RAG，不等于侧栏聊天拿到所有样本。
这些内容以按用户隔离的 IndexedDB 为主，经现有备份镜像进入 MySQL，不是新增云知识平台。下一步建议先补来源、版本、确认人、失效时间和冲突处理，给记忆抽取增加敏感信息策略与用户确认，再用冻结的人工真值集检查召回率、引用正确率、错误记忆率和拒答行为。检索机制已经接通，不代表已经量化证明准确率提升。`},
{title:'统计与团队模板：看清工作量，复用经过整理的方法',sub:'统计用于观察运行；模板用于共享规则配置；知识共享范围还需继续细化',minutes:2,kind:'team',take:'共享经过选择的模板与知识，是后续治理方向；当前模板库不提供“防蒸馏”保证',refs:[['docs/PRODUCT.md','本年度票据统计'],['src/features/statistics/load-local-statistics.ts',''],['src/server/statistics/team-statistics.ts',''],['src/server/templates/team-templates.ts',''],['src/features/templates/services.ts',''],['docs/PRODUCT.md','团队模板库']],notes:`统计先回答团队做了多少、目前复核覆盖怎样、一次分析消耗怎样。可以按年份和月份查看处理票数、成功分析次数、复核状态、流转时间、Token 和接手时段；本地模式读当前浏览器数据，团队模式只汇总已经镜像到服务器的数据。重跑增加分析次数，不增加同一人的票数。团队合计按成员相加，同票被多人处理可能分别计数，所以不能把它当成团队唯一缺陷数。
准确率口径尤其要解释：Jira 展示含 AI 判断的复核通过率；飞书只对可以确认人工复核的记录计算人工复核准确率。没有真值不进分母，两来源不能直接揉成一个准确率。流转时间缺失时使用默认四小时，恰为四小时的票不进入平均值；Token 也只覆盖记录到的分析范围。这些数字用于改进流程，不直接等于员工绩效。
模板库共享规则组的方法配置：JQL、MQL、车型映射、路径、提示词和元数据，支持版本、发布、应用与下载。相同内容不重复升版；应用创建新规则组，避免覆盖现有配置。普通登录成员能发布和浏览，创建规则组仍需管理员。模板不含凭据与票据，但含提示词和本机路径，所以共享前要检查。
针对“不希望员工经验被无差别蒸馏”的目标，建议逐步允许作者选择指定模板、指定知识、指定接收范围，增加预览、审批、撤回和访问审计。当前个人知识并没有默认变成全员知识；也不能承诺访问控制能绝对阻止已授权用户复制内容。我们要实现的是可选择、可追溯的经验共享，而不是把个人全部历史自动公开。`},
{title:'数据标注工作台：把人工判断变成可用样本',sub:'读取 MySQL 镜像；标注独立保存，保留原始 AI 分析结果',minutes:2,kind:'labeling',take:'形成更干净的正例、负例和评测真值；导出后仍需受控回灌与独立评测',refs:[['src/server/labeling/labeling.ts',''],['src/features/labeling/components/annotation-editor.tsx',''],['src/app/api/labeling/export/route.ts',''],['docs/PRODUCT.md','数据标注工作台']],notes:`人工复核通常回答“这次结果能不能用”，标注工作台进一步回答“这条数据以后拿来做什么”。工作台读取 MySQL 镜像中的 Jira 和飞书分析结果，提供已有复核和文本特征生成的预填建议，最终由人工确认。原始 AI 分析不被改写，标注单独保存，包含标注人和版本。
一次标注分五类内容：结论是完全正确、部分正确、错误还是无法标注；错误属于信号漏提、时序误判、结论过度、缺日志、模块转错还是其他；数据用于正例 few-shot、负例 few-shot、评测真值还是排除；再补正确结论、难度和备注。六类错误类型可以多选，“其他”必须解释。
用一个例子说明：AI 把上层没有消费信号直接写成 Vehicle 故障，人工认定是模块转错。应保存原错误结论，填写正确结论，再决定它适合作为负例纠错还是评测真值。完全正确才能作正例；错误或部分正确作为负例必须有正确答案。“排除”不能和其他用途混选，无法标注与排除样本不进入 JSONL 导出。
登录者可以查看，保存和撤销要求复核员及以上，标注按登录用户隔离。带来的直接好处是把数据质量、错误分布和用途显式化，使后续 RAG 和评测可追溯。但目前导出不自动回灌 few-shot 和评测集。下一步应加双人复核与分歧仲裁，按时间和工单隔离检索样本与评测集，防止把同一票答案放入上下文后再声称评测准确率提高。`},
{title:'新车型版本问题：先确认配套，再分析信号',sub:'SOC / SCC 配对检查与历史 VHAL 追溯分两条证据链',minutes:3,kind:'vhal',take:'明确不一致或全部信号确认缺配置才提前停止；未知、歧义和部分缺少要留证据继续',refs:[['src/server/pipeline/process/version-vhal-stage.ts','runVersionVhalCheck'],['src/server/pipeline/log-versions.ts',''],['src/server/pipeline/version-vhal/resolution.ts',''],['src/server/pipeline/version-vhal/signals.ts',''],['src/server/pipeline/process/effective-configuration.ts',''],['docs/SEQUENCE_DIAGRAMS.md','Pipeline 版本与 VHAL 检查']],notes:`近期新车型的问题提醒我们：如果日志中的软件与分析使用的配置不是一套，再精细的信号分析也可能从错误前提出发。因此新增的是两条互补的证据链，不是看到一个 hash 就直接证明车辆版本正确。
第一条检查 SOC 与 SCC 是否配套。系统递归读取 Buildinfo 中 MAIN_VERSION，同时从同目录的 Scc DLT 日志解码版本原文，不跨目录随意配对。把原始字符串交给 AI 比较有效版本号，再用结构校验约束 matched、mismatched、unknown。明确不一致就保存结论并停止后续分析，建议配合刷入；缺字段或判断失败为 unknown，保留原因继续。AI 的字符串判定不等于已经验证真实刷机状态。
第二条定位日志对应的历史 VHAL：收集 BoschVehicleHalHash 及编译日期，按最新编译日期选择候选，使用短 hash 查 project.json 中来源提交；在同项目、同一分支组内，用来源 RTC 完整匹配唯一 VS 提交，再从配置根目录和 bak 归档定位版本及 Excel。一个示例是 82552235 对应 V2.2.35。不能把任意仓库提交直接当 VS 提交，也不能冲突时随便挑一个。
拿到表后，检查 Vehicle property ID、MCU UP、IVI DOWN 等列，同时用 Project 核对完整车型，区分大小写。非空待查列表全部明确缺配置且没有豁免才提前停止；部分缺少、仅大小写不同、表缺失、hash 冲突都保留独立提示，不能标成通过。
另外，自动基础配置选择发生在 Step2 之前：用 SOC、完整车型别名和可用 hash 选已同步的分支当前 JSON、DBC、Proto，验证清单后冻结进本 run。失败整套回退用户配置。它保证本次分析输入一致，历史 VHAL 追溯用于核对问题版本，两者用途不同，不能宣称已自动重建全部历史配套。`},
{title:'终端工作台：配置同步与每服务器导入导出',sub:'浏览器 → 独立终端网关 → 允许的 SSH 目标；配置缺失时明确禁用依赖操作',minutes:2.5,kind:'terminal',take:'按目标解析生效配置，导入先校验和备份；终端专属配置不会自动替换分析默认 project.json',refs:[['src/server/terminal/project-file.ts','resolveProjectReadFile'],['src/server/terminal/projects.ts','validateProjects'],['src/server/terminal/sync/remote.ts','createGitSyncReader'],['src/server/terminal/sync/runner.ts','resolveProjectReadFile'],['terminal-gateway/session-manager.ts',''],['session-handoff.md','project.json 导入/导出']],notes:`版本追溯依赖可靠的配置来源，因此终端工作台也扩展了同步能力。浏览器连接独立网关，网关再连允许的 SSH 目标，按项目和分支组读取远端已提交文件。关键命令包括 git rev-parse --verify 固定提交，git log -10 取得近期提交与 RTC，git ls-tree 枚举配置，git cat-file blob 读取内容。读取提交快照能避免把远端工作区未提交修改当作正式配置。
同步将 JSON、DBC 或 SDB、type.h、Excel，以及 api-public 的根 Proto 等约定文件落到本地 configuration，并保存 Git blob 校验、来源清单、版本和备份；分阶段发布，失败时保留恢复信息。同步是显式终端操作，分析不会自行连接远端抓配置。
这次进一步加入 project.json 导入导出和每服务器配置。按目标显示名生成安全文件名，优先读取 project_<目标名>.json，不存在再回退 docs/project.json。管理员导入写默认文件，非管理员导入写目标专属文件，覆盖前备份到 docs/bak；导出下载当前真正生效的文件，包括同步写回的 commit 和 RTC 映射。缺配置时可导入，但分支切换和同步应禁用并说明原因。
一个容易忽略的边界是：这些专属文件按“目标”区分，不按用户私有；同一目标的其他用户也可能读到它。管理员即使导入了默认文件，只要该目标已有专属文件，读取仍优先专属文件。分析侧没有传 targetName 时继续读默认 project.json，所以不能说终端导入的专属文件已自动对分析生效。
非管理员终端连接与同步已按明确授权开放，登录、命令守卫和审计保留。当前这轮只完成自动检查，浏览器交互及真实 SSH 验证仍是待办，下一页的 Loop 实战会把这个限制一并保留。`},
{title:'Harness 守边界，Loop 用验证反馈驱动下一步',sub:'AI 可以执行检查并修复可复现问题；完整性仍取决于验收设计与真实证据',minutes:3,kind:'loop',take:'有界目标 + 固定验收 + 外部记录 + 停止规则，才构成可审阅的开发闭环',refs:[['AGENTS.md','最小开发循环'],['AGENTS.md','停止与交接'],['docs/loop-engineering/minimal-loop-agents-review.md',''],['package.json','typecheck'],['README.md','IVACP_BROWSER_BASE_URL']],notes:`Harness Engineering 在这里指我们给开发 Agent 准备的工程环境：产品和架构文档、分层规则、工具、测试、权限门禁与交接。它让 AI 知道能改什么、不能改什么、怎样算通过。当前不足并不是这些规则没有用，而是如果执行停在“代码写好了”或只做了局部检查，仍然可能把缺失的交互和真实环境问题留给人发现。
Loop 加的是反馈控制：目标与验收先固定，调查当前实现，做最小改动，执行检查，根据结果决定交付、修复或交接。失败日志是下一次行动的输入，而不是一句“应该好了”。外部记录放在 session-handoff，保留目标、命令、通过、失败、跳过、未验证和下一步，避免换上下文后忘掉原来的约束。
适合的目标必须有边界。例如“为终端配置导入导出；按角色写指定文件；缺配置禁用相关操作；导出当前生效文件”，比“把终端做完善”更容易验收。预先写明正常、错误、权限和持久化四类条件。测试先跑相关逻辑，再按影响范围跑 typecheck、lint、全量测试和独立副本构建；页面和持久化要实际做浏览器操作，必要时刷新确认。真实网关验收需要对应环境，不能拿 mock 顶替。
何时继续 Loop？相关测试失败、类型或架构规则不通过、页面行为不符合清单时，若目标仍清楚且有证据支持新假设，就修复并复跑受影响检查。默认最多两轮；一轮是一项有依据的修复及对应验证，不是一次工具调用。重复同一失败两次且无新证据、环境缺失、验收歧义或需越权时，记录并交接。
AI 能自行执行已有验收，也能发现部分遗漏，但不能证明所有未知需求已覆盖。禁止删测试、放宽断言或把跳过写成通过。测试全绿只能证明已执行检查通过；Loop 也不保证两轮内必然完成。`},
{title:'Loop 实战：首次检查失败，修复后复跑通过',sub:'案例：project.json 导入/导出 + 每服务器配置 + 非管理员终端',minutes:3,kind:'case',take:'修复轮次 1/2：证明有界自修复发生过；真实使用验收仍需补齐',refs:[['session-handoff.md','修复轮次：1/2；一轮内修复 eslint'],['test/terminal-project-file.test.ts',''],['test/terminal-client-service.test.ts',''],['src/features/terminal/components/terminal-workspace.tsx','']],notes:`把前面概念落到这次真实开发记录。目标包含三项：project.json 导入导出、按服务器目标选择配置，以及在保留登录与命令守卫下开放非管理员终端。验收不是“按钮出现”，而是写入路径、读取优先级、旧文件备份、缺失降级、角色访问和 API 文档都要覆盖。
实施后第一次检查发现 ESLint 的 React Hooks 问题：状态在声明前被使用，以及 effect 内同步 setState。它们属于静态规则检查失败，不能把这句话改写成“第一次 539 个单元测试都失败了”。交接没有保留原始完整错误日志，所以分享展示交接明确写下的问题类型，不伪造终端截图或逐字报错。
AI 根据检查结果调整状态声明顺序，并修正 effect 内同步更新状态的写法，随后复跑相关 ESLint。交接记录的结果是改动文件零错误，typecheck 零错误；Vitest 一百零一个文件通过、十六个跳过，五百三十九个用例通过、四十一个跳过，包含新配置解析器六个用例。修复轮次记为“已用一轮、最多两轮”，也就是只用了一轮修复预算。
这就是 Loop 实战的最小证据链：清楚的目标，固定检查，检查暴露问题，AI 在授权范围内修改，再用检查确认原问题消失。它比模型自己说“完成了”多了一层可检查的证据，但不能据此推广出“AI 已证明所有功能完整”。
同一记录明确写着没有构建、没有浏览器回归、没有连真实 Terminal Gateway 或 SSH。因此我们的结论是代码层自动检查通过，交接将任务标为完成；按完整使用验收还需要补三组：普通分析员能进入并连接、导入导出及缺失禁用态可操作、真实目标同步会读写正确专属文件。这里保留交接的原状态，同时指出证据覆盖的边界，不把历史记录改写成今天全链路复验。`},
{title:'外部观察：定时筛建议，再运行受控开发 Loop',sub:'本人尚未尝试；案例来自他人项目观察，Loopy 用于整理和审查循环提示词',minutes:2.5,kind:'external',take:'先借鉴“筛选—验收—反馈”，再评估自动发布；定时触发与发布授权要单独配置',refs:[['AGENTS.md','外部评论'],['docs/loop-engineering/project-adoption-review.md','']],web:'https://github.com/Forward-Future/loopy',notes:`最后介绍一个自己没有做过的外部案例：有人用 Codex 设置定时触发，隔一段时间读取项目留言板，筛出改进建议，再让 AI 根据建议开发、部署和上线。我只是见过这类项目的使用方式，没有它的可核验运行记录，也没有实测成功率，所以这里分享机制，不展示它已经稳定无人值守的结论。
可以分成两个循环。第一个是需求筛选：去重，判断是否属于当前项目，检查是否已有实现、是否足够清楚、是否有权限和可验证的目标；不满足就无操作或转人工。第二个是开发 Loop：拿到明确任务后，在隔离环境中修改、测试、复跑，满足验收再形成可审阅版本。部署之后还要健康检查，失败回退并暂停。
我查阅了 Forward-Future/loopy 官方仓库。它提供可安装的 skill，能发现、查找、审查、修复、改写或运行有界循环，并把目标、检查、下一步和停止条件整理清楚。它本身不会默默创建定时任务，也不自动授予生产变更、发布或发消息的权限。因此“Codex 定时器”“留言板接入”“Loopy 提示词”“部署流水线”是需要组合的能力，不能把整个案例归功于安装一个 skill。
若以后借鉴到 IVACP，建议先做只读筛选和候选任务，保留现有登录、数据架构和外部操作门禁；再在明确授权的小范围任务里试点开发与验证。自动发布必须另有授权、版本记录、健康检查和回退条件。留言内容只能当需求资料，不能直接当作执行指令；定时触发也要防止重复领取同一建议。
今天希望大家带走三件事：来源接通以后维护一套分析内核；团队知识要经过选择、标注和评测；AI 开发应把失败和未验证项公开留在证据里。讨论时可以优先对齐下一批真实样本和终端验收场景，再决定哪些改动适合放进有界 Loop。`}
];

export const commandAppendix = `## 附录：分享后可查的命令与接口

以下是文档和源码中出现的调用形式，本轮没有执行任何真实飞书、Jira 或 SSH 操作。尖括号均为占位符。写接口只用于解释实现，不代表获得执行授权。

### 飞书：登录和读取

\`\`\`bash
meegle auth status --format json
meegle auth login --host project.feishu.cn
# 当前代码针对服务端认证失效给出的重新授权方式
meegle auth login --device-code --host project.feishu.cn
meegle project search --project-key '<空间Key>' --format json
meegle mywork todo --action todo --page-num 1 --format json
meegle workitem query --project-key '<空间Key>' --mql '<完整MQL>' --format json
meegle workitem get --project-key '<空间Key>' --work-item-id '<ID>' --fields '["_all"]' --params '{"page_size":200}' --envelope --format json
\`\`\`

完整 MQL 的数据源形式如下，不会依赖当前待办非空；具体字段与条件沿用已验证的规则组配置：

\`\`\`sql
FROM \u0060<空间Key>\u0060.\u0060<工作项类型>\u0060
\`\`\`

### 飞书：项目中使用的写入形式

\`\`\`text
meegle attachment +upload <图片路径> --resource-type 14 --project-key <空间Key> --work-item-id <ID> --format json
meegle comment add --params <含project_key/work_item_id/content的JSON> --format json
meegle workflow list-state-transitions --project-key <空间Key> --work-item-id <ID> --work-item-type <类型> --user-key <操作者Key> --format json
meegle workflow transition-state --project-key <空间Key> --work-item-id <ID> --transition-id <流转ID> --format json
meegle workitem update --project-key <空间Key> --work-item-id <ID> --role-operate <角色变更JSON> --format json
\`\`\`

### Bosch Jira：服务端 REST 调用

\`\`\`http
POST /rest/api/2/search/jql
GET /rest/api/2/issue/{key}?fields=*all
POST /rest/api/2/issue/{key}/comment
POST /rest/api/2/issue/{key}/attachments
GET /rest/api/2/issue/{key}/transitions
POST /rest/api/2/issue/{key}/transitions
PUT /rest/api/2/issue/{key}/assignee
\`\`\`

筛票体包含 \`jql/maxResults/fields/nextPageToken\`，最多 20 页 × 100 条；规则组使用 \`jiraProvider: "bosch"\`。连接变量为 \`BOSCH_JIRA_URL\`、\`BOSCH_JIRA_USERNAME\`、\`bosch_jira_api_token\`（兼容 \`BOSCH_JIRA_API_TOKEN\`，密码仅兜底）。不提供带真实密钥的命令。

### 配置同步的关键 Git 命令

\`\`\`text
git check-ref-format refs/heads/<分支>
git rev-parse --verify refs/heads/<分支>^{commit}
git log -10 -z --format=%H%x00%B <commit>
git ls-tree -r -z <commit> -- tools/json tools/sdb tools/scripts <可选根Proto>
git cat-file blob <oid>
\`\`\`

同步实现会处理参数引用、Git blob 标识、传输编码、备份、暂存发布与恢复，不能用上述命令列表代替完整同步协议。

### Loop 验证命令与分层验收

\`\`\`bash
source ~/.bashrc
npx vitest run test/terminal-project-file.test.ts test/terminal-client-service.test.ts
npm run typecheck
npm run lint
npx vitest run
# 有用户服务时在独立副本中构建
npm run build
\`\`\`

本机 ~/.bashrc 不存在，本轮文档构建使用 Codex bundled runtime；不要把它写成已成功加载。浏览器测试须按 README 显式设置 \`IVACP_BROWSER_BASE_URL\`，必要时设置 \`IVACP_BROWSER_EXECUTABLE\`。关键用例：analyst 访问、配置缺失、错误导入不覆盖、角色写入位置、备份、named_first、导出当前文件、同步正确目标、刷新后状态。只有执行且有结果才记为通过；真实 SSH 和业务验证单列。

### Loopy：仅供后续研究，不在本轮安装

官方安装示例：\`npx skills add Forward-Future/loopy --skill loopy --agent codex -g -y\`；Codex 可通过 \`/skills\` 选择或显式提及 \`$loopy\`。安装、定时任务和执行都未在本轮操作。

### 一个可继续细化的有界 Loop 提示词

\`\`\`text
只完成已授权目标：<明确功能>。允许改动：<文件/模块>。
验收固定为：<正常/异常/权限/持久化/真实业务条件>。
先核对当前实现与交接，再做最小改动，运行相关检查。
检查失败时记录命令、退出码、证据和根因假设；在范围内修复并复跑。
不得删有效测试、放宽断言或把跳过与未执行记作通过。
最多2个修复轮次；同一失败连续2次且无新证据、缺权限或环境、需扩大范围时交接。
只有所有必需验收满足才交付完成；否则明确自动检查已通过与真实验收未完成的部分。
每轮更新session-handoff.md，不执行未授权回填、同步、部署或通知。
\`\`\`
`;
