# 飞书分析停止与再次分析设计

## 背景与目标

飞书工作项 #7073862958 的历史分析在服务端中断后，IndexedDB 中仍保留 `processing`，卡片持续显示“处理中”。现有启动恢复能够恢复同一 runId 的完整成功产物，也能将超过两小时且没有完整产物的陈旧任务收敛为失败，但用户无法主动终止仍在执行或卡住的分析。

本设计为飞书工单卡片增加“停止分析”和“再次分析”操作，并建立前端、服务端流水线和持久化状态一致的取消协议。停止必须真实终止当前 run 的可取消工作，而不是只修改界面状态；再次分析必须创建全新的 runId。

## 范围

### 包含

- 飞书 `MeegleAssignment` 与 `MeegleProcessTask` 增加持久化状态 `stopped`。
- 处理中卡片提供“停止分析”，已停止和失败卡片提供“再次分析”。
- 服务端按 runId 即时取消模型请求、附件下载和已登记子进程。
- 每次停止保留已有日志，并在对应运行目录写入 `cancelled.json`。
- 停止与成功响应并发时，以已停止状态为准，旧响应不得生成当前结果。
- 历史卡死任务即使已无服务端执行实例，也可由取消接口确认停止并恢复操作。

### 不包含

- 不删除旧 snapshot、日志、结果或分析历史。
- 不复用旧 runId，不从旧阶段断点继续。
- 不新增 Jira 工单停止按钮。
- 不新增规则组批量停止。
- 不引入后端数据库、分布式任务队列或独立 Worker 服务。

## 用户界面

采用现有暗色工业指令台风格，在生产入口 `/analysis/{ruleGroupId}/meegle` 的筛票结果表格最右侧增加固定宽度“操作”列。当前没有生产入口的旧 `MeegleRuleGroupLane` / `MeegleIssueCard` 不在本轮修改范围。操作列提供两个完整文字按钮：

- `processing`：红色描边“停止分析”可用，“再次分析”禁用。
- 取消请求进行中：按钮文字为“正在停止…”，两个按钮均禁用。该状态只存在于当前页面内存，不写入 IndexedDB。
- `stopped`：显示蓝灰色“已停止”，停止按钮禁用，Amber 描边“再次分析”可用。
- `failed`：停止按钮禁用，“再次分析”可用。
- `completed`：沿用已完成区域现有结果入口和重新分析行为，不在本轮改变。

点击“停止分析”前显示二次确认，明确说明当前 run 将被终止、已有日志保留。操作错误直接显示在当前表格行操作区或现有错误反馈通道，不把失败的取消请求伪装成已停止。

桌面表格为操作列预留 205px；窄屏保留表格横向滚动，不把按钮压缩为难以识别的图标。状态列继续展示 assignment 生命周期，AI 状态列继续展示当前阶段或结果，操作列只承担停止与再次分析。

## 状态模型

持久化状态转换如下：

```text
processing --停止成功--> stopped --再次分析--> processing(new runId)
failed ------------------------------再次分析--> processing(new runId)
processing --自然完成--> completed
processing --真实异常--> failed
```

约束：

- 停止操作只接受 assignment 当前为 `processing` 且 `latestAttemptTaskId` 等于目标 runId。
- 重复停止同一 runId 返回相同的 `stopped` 结果，保持幂等。
- 已自然完成的 run 不允许被改为 `stopped`；客户端刷新并保留 completed 结果。
- 再次分析生成新的 snapshot、task 和 runId，旧 run 的 `cancelled.json` 与阶段产物不变。

## 服务端取消架构

新增服务端运行注册表，按安全 runId 保存：

- 当前 `AbortController`；
- issueKey、来源和运行目录等身份信息；
- 当前登记的子进程及其终止回调；
- 当前是否已收到停止请求。

注册表使用进程内单例，适配当前本地单 Next.js 服务部署。共享 `/api/issues/process` 在接受 Meegle runId 后注册运行，在 `finally` 中注销。Jira 无 runId 的既有调用保持不变。

新增取消接口，接收 runId、飞书工作项身份与规则组身份。接口执行：

1. 校验登录、来源、runId 和工作项身份。
2. 若运行仍在注册表中，校验身份后标记 stopped，触发 `AbortController.abort()`，并终止已登记子进程。
3. 在已知运行目录写入 `cancelled.json`，记录 runId、issueKey、stoppedAt 和已终止/未活跃状态；若运行实例已不存在，则使用与恢复接口一致的安全目录边界定位该 run 并写入标记。
4. 同一 runId 重复调用返回幂等成功。
5. 若产物已经完整成功，返回冲突，客户端不得覆盖 completed。

`/api/issues/process` 及其可阻塞依赖接受可选 `AbortSignal`：

- Qwen 文本与图像请求传递 signal。
- Jira/飞书附件下载传递 signal。
- 7za、Python/CAN 解析和绘图等子进程创建后登记到当前 run；停止时先发送正常终止信号，必要时执行有界强制终止。
- 长阶段前后调用统一的取消断言，停止后不再进入下一阶段。

流水线识别取消异常后写入 `pipeline-metrics.json` 的 `cancelled` 状态、刷新 `stages.json` 并落盘日志，不发送失败通知，不触发成功归档，也不返回可持久化的成功结果。

## 客户端数据流与竞态保护

`meegleProcessStore` 增加按 assignment 记录的活动 run 信息、取消控制器和 `stoppingIds`，并提供 `stopAssignment` 与显式再次分析入口。

停止流程：

1. 从 IndexedDB 读取 assignment 与 `latestAttemptTaskId`，拒绝无当前 run 的请求。
2. 先将该 run 标记为本地 stopping，调用服务端取消接口。
3. 服务端确认后，在一个 Dexie 事务中重新读取 assignment；仅当它仍为 `processing` 且 `latestAttemptTaskId` 未变化时，将对应 task 与 assignment 一并更新为 `stopped`，写入 completedAt 和停止原因。
4. 中止客户端仍在等待的处理响应，并重新加载 assignments。

原处理请求的异常分支若发现该 run 已被请求停止，不得再写入 `failed` 或发送失败通知。成功分支提交前也必须重新读取 assignment；只有 status 仍为 `processing` 且 runId 仍为当前 `latestAttemptTaskId` 时，才允许写入 completed task、result 和 assignment。旧 run 的迟到响应因此不能覆盖 stopped 或新的再次分析任务。

活动运行状态由 runId 而不是单纯 assignmentId 识别。旧 run 的 `finally` 只能清理与自身 runId 匹配的活动记录，不能误删新一轮分析的运行状态。

## 历史卡死任务

对已经没有活动服务端实例、但 IndexedDB 仍为 processing 的历史任务：

- 取消接口确认注册表中无活动实例，并检查该 run 是否已有完整成功产物。
- 无完整成功产物时写入或确认 `cancelled.json`，返回幂等停止成功。
- 客户端按同一事务规则将任务和 assignment 更新为 stopped。

这使 #7073862958 无需等待自动超时即可恢复为“已停止”，随后可使用“再次分析”创建新 run。

## 错误处理

- 取消接口网络失败：保持 processing，退出 stopping，展示错误并允许重试。
- 取消时任务已完成：返回冲突，客户端重新加载 assignment/result，不写 stopped。
- 身份或 runId 不匹配：返回 400/409，不修改服务端或 IndexedDB。
- 子进程终止失败：取消标记仍生效，流水线阶段边界禁止继续；接口返回终止详情供日志审计。
- 多标签页重复停止：服务端幂等；Dexie 事务以 status 和 latestAttemptTaskId 条件防止旧页面覆盖新状态。
- 再次分析失败：新 task/assignment 进入 failed；若旧 run 曾有历史结果则继续保留。

## 测试与验收

### 自动化测试

- 状态：processing 到 stopped、重复停止幂等、completed 拒绝停止、stopped/failed 再次分析生成新 runId。
- 服务端：取消接口触发目标 run 的 AbortController、终止登记子进程并写入 cancelled.json。
- 流水线：模型请求、下载和子进程接收取消信号；取消后指标为 cancelled，且不归档、不发送失败通知。
- 竞态：停止后的迟到成功响应不能写 result 或恢复 completed；旧 run 的 finally 不能清理新 run。
- UI：飞书分析表格包含独立操作列；处理中固定显示停止按钮；已停止/失败显示再次分析；stopping 期间按钮禁用；停止前二次确认；窄屏不压缩按钮文字。
- 持久化：刷新后仍显示已停止，旧 snapshot、日志和历史结果保留。
- 隔离：只停止指定 Meegle runId，不影响同组其他飞书任务或 Jira 流水线。

### 端到端验收

1. 筛选并定位 #7073862958。
2. 对当前卡死 run 点击“停止分析”并确认。
3. 验证服务端返回停止确认、运行日志存在 `cancelled.json`、卡片变为“已停止”。
4. 刷新页面，状态仍为“已停止”。
5. 点击“再次分析”，验证生成不同的新 runId，卡片进入处理中。
6. 确认旧 run 的任何迟到响应都不能覆盖新 run 或 stopped 历史。

## 文档同步

实现时同步更新：

- `docs/PRODUCT.md`：飞书停止与再次分析的产品行为。
- `docs/ARCHITECTURE.md`：运行注册表、取消接口和竞态边界。
- `docs/WORKFLOW.md`：状态转换、取消与再次分析流程。
- `docs/SEQUENCE_DIAGRAMS.md`：客户端、取消 API、流水线、子进程和 IndexedDB 时序。
- `session-handoff.md`：根因、实现范围和验证证据。
