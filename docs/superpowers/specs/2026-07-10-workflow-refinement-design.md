# Jira 解票工作流细化 — 在线多轮自愈与回滚保护设计规格

> 版本：1.0
> 日期：2026-07-10
> 状态：已批准
> 优先级：高

---

## 1. 背景

在 Phase 3 完成后，虽然引入了 `runEvidenceSelfCritique` 作为在线自校验逻辑，但目前面临以下局限：
1. **单次尝试限制**：自批判重写仅进行一轮。如果大模型在重写阶段因为遵循度问题引入了全新的幻觉或未接地描述，系统没有二次重置与校验能力。
2. **缺乏回退保护**：直接接受单次修改后的文案。在少数极端情况下，模型修订版本的接地率可能低于原版本，导致准确率指标退化。
3. **不可观测性**：`evidence-grounding.json` 中仅保留了修改前后的单次对比，缺乏迭代轨迹，不利于研发离线归因。

---

## 2. 目标

### 2.1 产品与准确率目标
- **拦截幻觉**：尽可能拦截 Step 5 最终结论中未被证据包或日志支撑的断言，降低 `ungrounded_conclusion` 类型错误。
- **正向增益保证**：通过回滚校验机制，确保经工作流细化重构后的最终结论接地率（EGR）只升不降。

### 2.2 工程与开发目标
- 将 `runEvidenceSelfCritique` 扩展为多轮迭代校验，最多运行 3 轮。
- 引入接地率最大值回滚门限（Rollback Guard），选取接地率最高的版本输出。
- 将多轮迭代的 grounding 历史记录写入 `evidence-grounding.json` 中以提供完整的调试轨迹。
- 所有校验逻辑均以非阻塞形式实现，若 API 调用或解析失败，降级回退到初始结论。

---

## 3. 详细设计

### 3.1 核心数据结构与逻辑

#### `evidence-grounding.json` 扩展输出格式
```json
{
  "ratioBefore": 0.575,
  "ratioAfter": 1.0,
  "revised": true,
  "bestRoundIndex": 1,
  "totalRoundsRun": 1,
  "ungroundedBefore": [
    "13:40:13.416",
    "13:40:25.908"
  ],
  "ungroundedAfter": [],
  "history": [
    {
      "round": 0,
      "ratio": 0.575,
      "ungrounded": ["13:40:13.416", "13:40:25.908"]
    },
    {
      "round": 1,
      "ratio": 1.0,
      "ungrounded": []
    }
  ]
}
```

#### 工作流算法时序
```mermaid
graph TD
    Start[开始 Step 5 结论生成] --> Reply[生成初始结论 finalReply]
    Reply --> Init[计算初始接地率 before]
    Init --> CheckZero{未接地断言数为 0?}
    CheckZero -- 是 --> ReturnReply[直接返回 finalReply]
    CheckZero -- 否 --> LoopInit[初始化历史数组 history=[before] / 轮次=0]
    LoopInit --> LoopStart{轮次 < 3 且 接地率 < 1.0?}
    LoopStart -- 否 --> Rollback[计算最大 ratio 的 index = bestIndex]
    LoopStart -- 是 --> InvokeAPI[调用 Qwen 自批判修正]
    InvokeAPI --> CheckEmpty{返回是否为空?}
    CheckEmpty -- 是 --> Rollback
    CheckEmpty -- 否 --> CalcGrounding[计算本轮接地率 after]
    CalcGrounding --> PushHistory[加入 history 记录并更新当前状态]
    PushHistory --> LoopStart
    Rollback --> Output[返回 history[bestIndex].reply 结论]
```

### 3.2 性能与预算控制
- **温度参数**：自批判重写阶段一律采用低温度（`temperature: 0.1`）以维持输出稳定性。
- **Token 限制**：重写 API 请求的 User Content 仅包含当前结论、证据包提取内容和未接地断言列表，大小处于可控范围，不会对单票处理耗时（上限 10 分钟）造成显著影响。

---

## 4. 验证与降级

- **API 异常降级**：当 Qwen 批判接口出现超时或瞬时网络异常时，捕获 error，终止循环，回滚至历史接地率最高的可用版本。
- **自动化测试**：
  - 运行 `npm run test:accuracy-phase3`，确保静态一致性。
  - 重新跑离线评测 `npm run eval:accuracy` 重新计算 EGR，指标不可出现负增长退化。
