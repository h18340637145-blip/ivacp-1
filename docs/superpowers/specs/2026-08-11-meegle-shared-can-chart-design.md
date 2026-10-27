# 飞书项目共享 CAN 时序图设计

## 背景

飞书工单分析已经持久化 `traceData`、`ticks` 和 `chartImage`，但详情页只显示静态 PNG。静态绘图脚本还会无条件把 DBC choices 当作 Y 轴范围；当 choices 不覆盖真实信号值时，所有散点都会被裁出画布。

## 目标

- Jira 与飞书详情页复用同一套 Chart.js CAN 时序图。
- 两端具备共享 X 轴缩放/平移、重置缩放、锁定当前视口为回填图。
- 静态 PNG 仅在离散刻度覆盖真实数据范围时应用 DBC choices。
- `traceData` 缺失时继续使用静态 PNG 降级展示。

## 设计

新增 `components/analysis/CanSignalChart.tsx`，接收信号数据、离散刻度、图片路径、摘要和回填标识。组件拥有 Chart.js 注册、时间解析、离散刻度范围校验、多个图表 X 轴同步、截图合成及保存逻辑。Jira 和飞书详情页只负责构造各自的图片路径并传入数据。

静态脚本 `scripts/plot_can_signals.js` 增加与浏览器组件一致的 `shouldUseDiscreteTickAxis` 判定。没有有效 choices、choices 少于两个值、数据为空，或者真实数据超出 choices 范围时，Y 轴交给 Chart.js 根据数据自动计算。

## 数据与降级

- 有 `traceData`：渲染交互式散点图。
- 无 `traceData`、有 `chartImagePath`：显示静态 PNG。
- 两者均无：不渲染图表区域。
- 锁定视口继续覆盖 `/api/charts/log/.../can_signals.png`，供 Jira/飞书回填附件使用。

## 验证

- 源码回归检查确认两端复用共享组件。
- 静态绘图测试加入 choices 与真实值不匹配的信号，并对 PNG 像素做非空数据颜色检查。
- 运行共享坐标轴、浏览器截图、Meegle 生命周期、类型检查和生产构建。

