# VHAL 信号精确配置门禁设计

## 背景

Step 2 可能提取出 DBC 中存在、但车型 `config_*.json` 未配置的 CAN 信号。现有受限自检会把此类信号映射到名称相近的 `prop`，导致流水线错误地继续读取 CAN trace、绘图并执行一致性分析。

`meegle-7104027428` 中，`CEM_IPM_FRSeatHeatVentSwSts` 未在 `config_T1L_FL1.json` 的 `prop`、`getSignals` 或 `setSignals` 中精确配置，却被自检映射到 `CEM_IPM__FRSEATHEATVENTSWSTS_5C4`，从而绕过 VHAL 配置边界。

## 行为设计

1. Step 2 完成信号提取后，先使用车型 JSON 的 `prop`、`getSignals` 和 `setSignals` 做精确匹配。
2. 任一 Step 2 信号未精确命中时，立即结束后续分析，不执行模糊补救、自检补救、CAN trace 读取、CAN 绘图、日志摘要或 Step 5。
3. 本次处理仍作为成功结果保存，供人工复核与回填；结论格式为：`vhal并没有配置信号<信号列表>，需要上层释放vhal`。
4. `signals.json` 保留 Step 2 原始信号、精确匹配和未配置列表，便于审计。
5. 所有 Step 2 信号均精确配置时，保持现有候选补救与完整分析流程不变。

## 验证

- 回归覆盖单下划线信号不能匹配 JSON 中双下划线信号或相近 `prop`。
- 验证 VHAL 门禁位于补救映射和 CAN trace 读取之前。
- 验证短路结论包含所有未配置的 Step 2 信号。
- 运行 Phase 2 准确率检查、TypeScript 检查和相关分析回归。