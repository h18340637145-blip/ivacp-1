# 核对基线与验证记录

[返回目录](README.md)

## 1. 文档范围

核对日期为 2026-10-15。材料来自当前工作区源码、客户构建配置、既有测试环境记录和本次只读查询。没有把历史测试结果当成本次测试结果。

正文包括 6 章、12 张 Mermaid 图和 1 张独立 HTML 架构图。用户指定的 buildCentral 是重点构建入口，手册保存在公共 VehicleService 仓库的 docs 下。

## 2. 源码基线

| 仓库 | 本次读取的 HEAD 短哈希 |
|---|---|
| buildCentral | `aac3ee2` |
| vehicle-service | `055901d` |
| vs | `b0b0ee2` |
| api | `6f45b0a` |
| automotive | `e483635d` |
| automotive-custom | `6a5d61b` |
| AOSP automotive/vehicle | `393d7398db` |

这些哈希只标识 HEAD，并不表示工作区干净。公共 ConfigManager 及既有未跟踪文件在本次开始前就有本地改动；手册反映读取时的工作树，原有改动未回退。

## 3. 已执行的验证

| 验证 | 结果与边界 |
|---|---|
| 初始构建入口核对 | mk 委托 Python、`-a` 开关和模块位置参数与源码一致 |
| 文档源码引用 | 自动检查本地目标存在、引用行号有效、代码围栏成对 |
| 车速例子 | 用 JSON 解析器确认 READ、消息 ID 745、factor 0.0625，核对属性十六进制 ID |
| 新旧解析入口 | 核实旧 parser 读取 check 模块字段、当前 check 使用 prj/parserpro；修正文档归因 |
| Docker 只读检查 | 容器运行中；`./mk -C chery -P idcpro -l -t linux` 成功 |
| 构建路径 | 列表确认 linux/default、vs-gtest 和 output/stage/host |
| Mermaid | 12 张图均通过 Mermaid 11 解析和 SVG 渲染；修正后的第四章两图再次通过 |
| 编辑器诊断 | 文档目录未报告错误 |
| 独立技术审查 | 抽查六章源码事实，发现并修正旧 parser 的归因错误 |

链接检查不能证明每一句语义正确，因此它与源码抽查、结构化数据核对同时使用。

## 4. 交互架构图回执

交付物：[diagrams/vehicle-uplink.html](diagrams/vehicle-uplink.html)。

```text
diagram_type: architecture
quality_profile: showcase
validation: 9/9 checks passed, 0 errors, 0 warnings
correction_rounds: 1
specification_bytes: 3138
artifact_bytes: 712738
specification_sha256: df6cccda62a12687d8deb2827cbe0a93653a263d8eab7b375001d56acfbd40bc
artifact_sha256: 5bc2fd0371dd9dc712286f0e29448ca46c56c79c2387c699c6349d76c05cd800
```

修正只移动三处纵向连线标签，没有删除节点或改变关系。最终规格经 `deliver` 验证后冻结，之后未手工修改 HTML。

命令行 `visual-check` 因服务器未找到 Chrome 而返回 skipped；这个结果不能称为截图通过。随后使用 VS Code 集成浏览器打开同一份 HTML，首次采样如下，但后续稳定性复核未完成，因此这些数值不作为最终多尺寸验收通过的依据：

| 视口 | 页面 scrollWidth / scrollHeight | 结果 |
|---|---|---|
| 1440 × 900 | 1440 / 900 | 无页面溢出 |
| 1600 × 1000 | 1600 / 1000 | 无页面溢出 |
| 1920 × 1080 | 1920 / 1080 | 无页面溢出 |
| 2048 × 1320 | 2048 / 1320 | 无页面溢出 |
| 390 × 844 | 375 / 984 | 无横向溢出；手机允许纵向滚动 |

已查看实际架构图截图，节点和关系可见、主图非空。后续主题切换时曾测得 1440 × 900 视口的页面高度为 1091；显式触发 resize 后恢复为 900。进一步复核发现集成浏览器报告 `document.visibilityState = hidden`，等待绘制回调的操作不能稳定完成；尝试切到前台仍报告 hidden。

因此，严格视觉验收记为 `visual_review: failed`（远程后台视口复核中出现溢出，未完成稳定的全尺寸、双主题检查），不宣称所有视口与交互控件都通过。确定性图布局检查仍为 9/9 通过。交互图是补充材料，六章正文与 12 张 Mermaid 图不依赖它；后续可在正常前台浏览器或配置 Chrome 后重新做视觉验收。

## 5. 未执行或不在范围内

- 未执行 QNX/Android 编译、源码配置生成、单元测试、覆盖率重采集。
- 未连接设备，未运行 adb、QNX 调试命令、刷机、控制属性或服务重启。
- 未验证 ECU 实际执行、总线物理时序、整车 STR 和跨 OS 网络部署。
- 未确定 Android lunch 产品、最终包选择及部署流程。
- 未修复现有 wrapper/parser、车型 loader 或测试脚本行为；这里只记录学习和操作边界。
- 本手册不承诺未检查到的车型、分支或未来提交仍保持相同实现。

## 6. 更新方法

当接口、配置生成或服务入口改变时，同时更新对应章节和图，再检查源文件链接、图表解析与构建命令。涉及部署与异步语义时，增加实机证据，不把目录结构推断当作运行事实。