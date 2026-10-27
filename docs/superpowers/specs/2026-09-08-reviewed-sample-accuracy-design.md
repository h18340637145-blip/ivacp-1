# 人工复核样本准确率提升设计

## 背景

当前系统已经把人工驳回时填写的错误原因和正确结论保存为 `IssueReviewSample`，并在后续分析前通过 Embedding 召回相似案例。服务端在 Step 5 前使用当前票的 Evidence Packet 对候选案例重排，再把纠错内容注入 Prompt。

现有链路有两个准确率缺口：

- 样本在人工复核时才创建，保存的 evidence fingerprint 通常只有标题和规则组，缺少本次分析已经得到的车型、`prop`、signal token 和 Property ID；
- 人工通过的正确结论不会进入生成阶段的 Few-shot 样本池，系统无法复用已经确认有效的分析模式。

本轮在不引入后端数据库、不训练模型参数、不改变人工回填门禁的前提下，建立统一的正负复核样本池，提高相似案例召回质量和 Step 5 结论稳定性。

## 目标

1. 人工驳回和人工通过都生成可检索的复核样本。
2. 样本保存真实处理证据，不再主要依赖标题相似度。
3. 召回同时考虑语义、车型和结构化证据重合。
4. 正确案例和纠错案例在 Prompt 中承担不同职责。
5. 兼容已有纠错样本和 IndexedDB 数据。
6. Jira 与飞书项目共享同一套样本语义和召回规则。

## 非目标

- 不对 Qwen 做参数微调或训练。
- 不引入服务端数据库、云同步或跨浏览器样本共享。
- 不允许历史案例覆盖当前票的 Evidence Packet。
- 不调整人工复核和回填权限边界。
- 不承诺未经离线回放验证的固定准确率提升比例。

## 方案选择

采用统一 `IssueReviewSample` 表，通过样本类型区分人工纠错和人工通过案例。相比新增正样本表，该方案复用现有 Dexie 表、Embedding 缓存和召回入口；相比运行时关联历史结果，该方案能保存复核发生时的不可变结论与证据指纹。

## 数据模型

`IssueReviewSample` 增加以下可选字段：

```ts
type ReviewSampleKind = "correction" | "approved";

interface IssueReviewSample {
  sampleKind?: ReviewSampleKind;
  approvedConclusion?: string;
  evidenceFingerprintText?: string;
  props?: string[];
  signalTokens?: string[];
  propertyIds?: string[];
  carModel?: string;
}
```

兼容规则：

- 历史记录没有 `sampleKind` 时按 `correction` 处理；
- `correction` 继续使用 `wrongConclusion`、`correctConclusion` 和 `errorReason`；
- `approved` 使用 `approvedConclusion` 保存人工确认的 AI 结论，纠错字段保存为空字符串；
- 同一 `ruleGroupId + issueKey` 只保留当前人工复核对应的一条样本。复核从通过改为驳回或从驳回改为通过时覆盖原样本，避免正负冲突；
- 新字段不作为 Dexie 索引，不需要清空或重建已有数据。

处理结果增加可选的 `reviewEvidence`，内容包括：

- `carModel`；
- 已匹配的 `props`；
- 已匹配的 `signalTokens`；
- 十进制和十六进制 `propertyIds`。

共享处理 API 从当前 run 已生成的匹配结果构造该字段，并随处理响应返回。Jira 与飞书项目分别将它保存在自己的结果表中，人工复核时直接用于生成样本。

## 样本写入流程

### 人工驳回

1. 读取当前结果的 `reviewEvidence`。
2. 保存 `sampleKind=correction`。
3. 保存 AI 原结论、人工错误原因和人工正确结论。
4. 使用标题、规则组、车型、`prop`、signal token 和 Property ID 构造 evidence fingerprint。
5. 清除旧 Embedding 缓存，确保样本内容变化后重新计算向量。

### 人工通过

1. 不再删除该票的 `IssueReviewSample`。
2. 保存 `sampleKind=approved` 和当前 AI 结论。
3. 使用与纠错样本相同的 evidence fingerprint。
4. 清除该样本的旧 Embedding 缓存。

### 旧结果兼容

旧结果没有 `reviewEvidence` 时，使用标题、结论、信号摘要和人工纠正文本提取有限的 signal token 与 Property ID。该回退只补充可明确识别的 token，不推测 `prop` 映射。

## 召回与排序

召回限定在同一规则组，排除当前工单，并最多返回 3 条样本。

第一阶段使用现有 Embedding 语义相似度；Embedding 服务失败时回退标题 Token 相似度。随后进行混合排序：

1. 语义相似度作为基础分；
2. 相同车型优先；
3. `prop`、signal token 或 Property ID 精确重合时加权；
4. 无结构化证据的历史纠错样本仍可依靠标题通过现有阈值；
5. 正样本至少需要车型相同或存在一个结构化证据重合，否则不进入 Step 5；
6. 相同分数时保持原始相关度顺序，保证结果稳定。

传给服务端的 Few-shot DTO 同步携带 `sampleKind`、车型和结构化证据字段。服务端使用当前 Evidence Packet 再次重排，并保留最多 3 条最终案例。

## Prompt 约束

Step 5 将样本分成两个区块：

- `<历史纠错案例>`：包含错误结论、错误原因和正确结论，用于避免重复错误；
- `<历史正确案例>`：包含人工确认结论及其证据指纹，只用于参考分析结构和决策模式。

两个区块都明确要求：

- 不得复制历史票的信号值、时间、报文状态或责任结论；
- 当前票不存在对应证据时，忽略历史案例中的事实；
- 最终断言必须由当前票 Evidence Packet、CAN 摘要或日志摘录支持。

Prompt 超预算时继续优先保护当前票结构化证据。历史正确案例和历史纠错案例使用相同裁剪优先级，且优先裁剪案例正文而不是当前票证据。

## 错误处理

- Embedding 调用失败：回退标题相似度，不阻断分析。
- 样本缺少类型：按历史纠错样本处理。
- 样本缺少结构化证据：纠错样本可按旧规则参与召回，正样本被更严格过滤。
- 结果缺少 `reviewEvidence`：使用保守文本提取回退。
- 样本保存失败：人工复核结果不得伪装为成功；界面沿用现有错误反馈。

## 测试策略

严格按 TDD 实施：

1. 先添加失败测试，证明人工通过当前会删除样本、结果未保存真实证据、正负样本未分区。
2. 验证 `correction` 与 `approved` 覆盖同票旧样本且清除旧 Embedding。
3. 验证旧样本默认按 `correction` 兼容。
4. 验证正样本没有车型或结构化证据重合时被过滤。
5. 验证车型、`prop`、signal token 和 Property ID 会影响稳定排序。
6. 验证 Step 5 分区注入，且包含当前证据优先约束。
7. 验证 Jira 与飞书项目都保存同一结构的复核样本。
8. 运行 `test:signal-rag`、`test:accuracy-tuning`、`test:accuracy-phase3`、`test:meegle-results`、`test:meegle-lifecycle`、TypeScript、ESLint、生产构建和 `git diff --check`。

## 文档同步

实现完成后更新：

- `docs/PRODUCT.md`：人工通过案例也进入学习记忆，并说明证据门槛；
- `docs/ARCHITECTURE.md`：统一正负样本池和处理结果 evidence fingerprint 数据流；
- `docs/WORKFLOW.md`：人工通过、人工驳回和后续召回流程；
- `docs/SEQUENCE_DIAGRAMS.md`：复核样本写入、混合召回和 Step 5 分区注入；
- `session-handoff.md`：本轮实现、验证结果和剩余风险。

## 验收标准

- 新人工通过案例可作为受证据门槛约束的正向 Few-shot 样本。
- 新人工驳回案例包含当前 run 的车型、`prop`、signal token 和 Property ID。
- 同票复核修改后不存在相互冲突的正负样本。
- 历史无类型样本仍正常参与纠错召回。
- 不相关正样本不会仅因标题模糊相似而进入 Step 5。
- Step 5 的历史事实不能绕过当前票证据约束。
- Jira 与飞书项目行为一致，现有人工复核和回填门禁不变。