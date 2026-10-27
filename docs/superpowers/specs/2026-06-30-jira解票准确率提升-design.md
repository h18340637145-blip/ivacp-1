# Jira 解票准确率提升 — Phase 1 设计规格

> 版本：1.0
> 日期：2026-06-30
> 状态：待实现（已通过头脑风暴逐节确认）
> 推进策略：方案 C — 轻量评测脚手架 + 最高杠杆修复，分阶段

---

## 1. 背景与目标

### 1.1 问题

当前 Jira 智能票据分析系统的 AI 解票准确率存在系统性提升空间。经分析现有代码与人工复核历史，确认三大失败模式（按严重程度排序）：

1. **Step 2 信号/报文识别错** —— `buildSignalConfigMatches` 仅做大写归一化精确匹配，token 拼写/别名/缩写不一致即漏识别，且漏掉的 token 无任何记录。
2. **结论与证据不符（幻觉）** —— 结论中出现 CAN trace / 日志中并不存在的信号值或时间断言。
3. **方向对、细节错** —— 结论方向正确但版本号、数值、关键判断表述有误。

三者存在因果链：Step 2 错 → 证据不全 → 结论无依据。

### 1.2 关键约束（来自需求澄清）

- **评测数据稀疏**：仅有零星人工复核标注；且人工标注存于 IndexedDB（Node 脚本读不到）。→ 必须用文件化真值 + 免标注代理指标。
- **准确率优先，可加计算**：单票仍受产品约束 ≤ 10 分钟、只用内网 Qwen、不引入后端数据库。
- 没有可量化的准确率指标前，任何 B/C/D/E 改进都无法验证。→ 必须先建度量闭环。

### 1.3 目标

Phase 1 同时交付：① 可量化、可回放、随人工复核增长的**评测闭环**；② 直接打击前两大失败模式的**最高杠杆修复**。后续每个 Phase 加一个杠杆，均以本评测闭环度量 delta。

---

## 2. 整体架构

Phase 1 交付三个相互独立、接口清晰的单元，全部贴合现有 `app/api/issues/process/route.ts` + `lib/analysis/` 结构。

```
离线评测脚手架                         流水线内修复
  eval-set.json ─┐                      U2 Step2 信号提取加固
  log/组/车型/票/ ┼─> eval-accuracy.ts    （别名/模糊 + 1次受限自检）
                 │      │                 U3 Step5 后证据自批判闸门
                 │      v                  （未接地则重生成 1 次）
                 └─> eval-report.{json,md}
```

| 单元 | 职责 | 依赖 | 接口 |
|---|---|---|---|
| **U1 评测脚手架** | 离线回放 `log/` 产物，算两类指标：证据接地率（免标注、全量票）、标注一致率（对 `eval-set.json` 策展真值） | 复用 `structured-evidence-validation.ts` | `npm run eval:accuracy` → `docs/golden-baseline/eval-report.{json,md}` |
| **U2 Step 2 加固** | 精确匹配不动；对未命中 token 做模糊/别名补救 + 1 次受限 LLM 自检 | 现有 config / proto 解析 | 函数级；`signals.json` 增 `recovered`/`unmatched` |
| **U3 证据自批判闸门** | Step 5 出结论后内联查接地率，未接地则 1 次批判-修订 | 复用共享 `computeGrounding` | 落盘 `evidence-grounding.json` |

**全局约束：** 文件化评测真值；U2/U3 各至多 1 次额外 LLM 调用；所有失败均降级不中断。

---

## 3. U1 — 评测脚手架

**形态**：`scripts/eval-accuracy.ts`（`tsx` 运行，直接 import 现有 TS 逻辑，零重复实现），注册 `npm run eval:accuracy`。

### 3.1 指标①：证据接地率 EGR（免标注，全量历史票）

- 读 `final_reply.md` → 用 `extractEvidenceAssertions` 抽断言（signal_value / time_window / reproduction）。
- 证据语料 = `can_signal_summary.txt` + `can_trace_extracted_result.txt` + `signals_id.json` + `extract.md` 拼接。
- 每条断言：subject（及 expected 值）能否在证据语料中找到 → grounded / ungrounded。
- `EGR = grounded / total`，按票算后求均值；**未接地断言清单**单独列出（幻觉热点）。

### 3.2 指标②：标注一致率（需 `eval-set.json`）

`docs/golden-baseline/eval-set.json` 结构（人工增量策展，稀疏可用）：

```jsonc
[{
  "ruleGroupDir": "chery T1J_FL3-8255",
  "carModelDir": "T1J_FL3_8255",
  "issueKey": "FL3-490",
  "expectedSignals": ["CouplingFaultStatus_253h"],   // Step2 应命中的信号/prop
  "expectedKeywords": ["未复现", "信号正常"],          // 结论应包含的关键判断
  "notes": "人工复核：信号无异常"
}]
```

对每条策展票读 log 产物比对：
- **信号召回率** = expectedSignals 中被 `signals.json` 命中的比例（衡量 Step 2）。
- **结论关键判断命中率** = expectedKeywords 在 `final_reply.md` 中出现的比例（衡量细节准确性）。

### 3.3 数据流与报告

```
eval-set.json ─┐
               ├─> eval-accuracy.ts ─> 聚合 ─> docs/golden-baseline/eval-report.{json,md}
log/组/车型/票/*┘                                （基线快照，下次跑显示 delta）
```

报告：每票 EGR + 未接地断言清单 +（若在 eval-set）信号召回/结论命中；聚合均值 + 分布 + 票数 + 跳过列表。快照存盘供 delta 对比。

---

## 4. U2 — Step 2 信号提取加固

**精确匹配逻辑完全不动**（保持现有行为），只在"精确未命中"的 token 上补救。

### 4.1 U2a 模糊/别名补救（零额外 LLM 调用）

对每个精确未命中的 rawToken，依次尝试：
1. **别名**：若 config 条目带可选 `aliases` 字段则一并入索引（有就用，不强制改外部配置）。
2. **模糊匹配**：对全部索引 key 算归一化编辑距离，命中条件 `距离 ≤ 2 且 ≤ 15% 长度`；外加子串包含（缩写场景）；每 token 至多取 1 个最佳。

命中标 `matchedBy: "fuzzy"`，带 `similarity`，与精确 matches 分开存。

### 4.2 U2b 信号自检（至多 1 次受限 LLM 调用）

- 经 U2a 后仍未命中的 token，若存在 → 一次性调用：把"未命中 token 列表 + 候选 prop/signal 清单（必要时用模糊 top-K 预筛控制 prompt 大小）"交给模型。
- 要求**只能从候选里选或答"无对应"，禁止编造**，输出 JSON `[{token, matchedProp|null, reason}]`。
- 解析后把指向真实候选的映射作为 `matchedBy: "self_check"` 补入。因只能从真实候选选，不引入幻觉信号。

### 4.3 产物变更（`signals.json` 扩展，向后兼容）

```jsonc
{
  "rawTokens": [...],
  "matches": [...],              // 精确，保持不变
  "recovered": [                 // 新增：fuzzy + self_check
    { "sourceToken": "CouplFaultSts", "matchedBy": "fuzzy", "prop": "CouplingFaultStatus_253h", "similarity": 0.86 }
  ],
  "unmatched": ["..."]           // 新增：所有手段后仍未命中，供人工排查
}
```

- `recovered` 的 prop 与精确 matches 一样喂给 `buildSignalsIdRecords` 和 CAN 绘图。
- `metrics.counts` 增加 `recoveredMatches` / `unmatchedTokens`。

### 4.4 风险与兜底

模糊误配 → 阈值收紧 + 每 token 限 1 + 单独标记 + `unmatched` 全留痕；U1 信号召回率量化是否真改善。自检失败 → 静默跳过，回退仅精确+模糊。

---

## 5. U3 — 证据自批判闸门

**位置**：Step 5 产出 `finalReply` 之后、落盘 `final_reply.md` 之前内联插入。

**单一真值逻辑**：在 `lib/analysis/structured-evidence-validation.ts` 新增导出 `computeGrounding(replyText, evidenceText)`，返回 `{ ratio, grounded[], ungrounded[] }`。**U1 与 U3 共用**，保证离线评测与在线自检判定一致。

### 5.1 流程

```
Step5 finalReply
  -> computeGrounding(结论, 证据语料)
  -> 存在未接地断言?
       否: 保留原结论
       是: 1 次 批判-修订 LLM 调用 (temperature=0.1)
           -> 重算 grounding
           -> 采用修订版为 finalReply
```

1. **证据语料** = `can_signal_summary` + `can_trace_extracted_result` + `signals_id.json` + `extract.md`（与 U1 一致）。
2. **接地检查**：列出 ungrounded 断言。
3. **触发**：存在 ungrounded 硬 fail → 一次修订调用。System：「删除/弱化无证据支撑断言、无法确认改写为"证据不足"、不得新增证据外结论、保持原【现象/证据/根因/结论/置信度】结构。」复用 Step 5 token 预算与截断。
4. **重算 grounding**，采用修订版为最终 `final_reply.md`。
5. **落盘** `evidence-grounding.json`（前后 ratio + 两版 ungrounded 清单）；`groundingBefore/After` 写入 `pipeline-metrics.json`。

### 5.2 边界与定位

- 至多 1 次修订；无 CAN 证据 / finalReply 空则跳过；修订失败回退原结论 + 记日志。
- **自愈，非卡回填**：符合产品 3.6.5——结构化校验为辅助性质，Jira 回填仍以人工复核 PASS 为前置。U3 只让进入人工复核的结论更干净，不自动拒绝、不阻断流程。

---

## 6. 错误处理

| 单元 | 失败场景 | 处理 |
|---|---|---|
| U1 | 某票产物缺失/损坏 | 跳过该票计入"跳过列表"，不中断；`eval-set.json` 缺失则只跑 EGR |
| U2a | 无候选/距离超阈值 | 不补救，token 进 `unmatched`，等同现状 |
| U2b | 调用失败/JSON 解析失败/选了候选外的值 | 丢弃结果，回退仅精确+模糊；非候选值一律拒绝 |
| U3 | 无证据语料/finalReply 空/修订调用失败 | 整段跳过，保留原结论 + 记日志 |

---

## 7. 测试

- 新增 `scripts/check-accuracy-phase1.mjs` → `npm run test:accuracy-phase1`，静态断言：U2 的 `recovered`/`unmatched` 字段、`computeGrounding` 导出且被 U1/U3 共用、U3 的 1 次修订上限、`eval:accuracy` / `eval-set.json` 注册存在。
- `computeGrounding` 纯函数单测（已接地 / 未接地 / 部分接地三类）。
- `npm run eval:accuracy` 在现有上百张历史票上跑一次产出**改动前基线快照**；U2/U3 落地后重跑看 EGR / 信号召回 delta。
- 全程 `tsc --noEmit` + `lint` 绿灯。

---

## 8. 落盘 / 改动清单

| 类型 | 文件 |
|---|---|
| 新增 | `scripts/eval-accuracy.ts`、`docs/golden-baseline/eval-set.json`、`scripts/check-accuracy-phase1.mjs` |
| 改 | `lib/analysis/structured-evidence-validation.ts`（+`computeGrounding`）、`app/api/issues/process/route.ts`（U2a/U2b/U3 + 落盘）、`package.json`（2 个 npm script） |
| 产物 | `signals.json`(+recovered/unmatched)、`evidence-grounding.json`、`pipeline-metrics.json`(+grounding)、`docs/golden-baseline/eval-report.{json,md}` |
| 文档 | `docs/PRODUCT.md`、`docs/ARCHITECTURE.md`、`docs/WORKFLOW.md`、`session-handoff.md` 同步 |

---

## 9. 显式不做（YAGNI）

不建后端 DB、不引入向量库、不做跨规则组学习、不阻断 Jira 回填、不重写 Step 2 精确匹配、U2/U3 各自不超过 1 次额外 LLM 调用。

---

## 10. 验收标准

- `npm run eval:accuracy` 可在现有历史票上产出 EGR 报告与基线快照。
- U2 落地后，`signals.json` 含 `recovered`/`unmatched`，eval-set 票的信号召回率较基线不降低（目标提升）。
- U3 落地后，`pipeline-metrics.json` 含 grounding 字段，聚合 EGR 较基线不降低（目标提升）。
- `npm run test:accuracy-phase1`、`tsc --noEmit`、`lint` 全绿。
- 相关文档与 `session-handoff.md` 已同步。
