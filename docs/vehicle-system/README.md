# VehicleService 与 BoschVehicleHal 开发学习手册

本文面向首次接触本项目的开发者，依据当前本地工作区说明 QNX VehicleService、Android BoschVehicleHal、车型配置和 buildCentral 的关系。

## 从哪里开始

先读第一章建立全局视图，再按顺序学习。六章正文涵盖基础概念、主要项目结构、运行机制、属性开发、构建测试、部署边界和排障；不是逐个枚举全部生成文件的 API 字典。

| 章节 | 主要内容 |
|---|---|
| [01-foundations.md](01-foundations.md) | 零基础术语、跨 OS 分层、六仓库与 buildCentral 地图、学习路线 |
| [02-qnx-service.md](02-qnx-service.md) | QNX 启动、核心类、协议收发、dispatcher、缓存、过滤、线程与 STR |
| [03-android-hal.md](03-android-hal.md) | HIDL/AIDL 分支、启动、get/set、订阅、FDBus、错误与车型选择 |
| [04-property-development.md](04-property-development.md) | 输入与生成物、真实车速实例、协议契约、属性开发和脚本风险 |
| [05-build-test.md](05-build-test.md) | buildCentral 参数、Docker 环境、QNX/Android 构建、测试和部署验收 |
| [06-debugging.md](06-debugging.md) | 调试命令、分段排障、边界测试、交付清单和当前待确认事项 |
| [validation.md](validation.md) | 版本基线、验证结果、图表交付回执与未执行项 |

## 按任务阅读

- **理解整个项目：** 第一章 → 第二章 → 第三章。
- **新增或修改属性：** 第四章 → 第五章 → 第六章；先定义单位、权限和反馈，不从生成 C++ 下手。
- **学习当前 TestBusHandler：** 第二章的 Bus 链路 → 第五章定向测试 → 第六章边界测试。
- **处理 get 旧值、set 无效果或缺回调：** 第三章缓存与异步语义 → 第六章分段诊断。
- **接手构建环境：** 第五章先做只读查询，再确认工具链、生成副作用和工作区修改。

## 图解索引

正文包含 12 张 Mermaid 图，可在支持 Mermaid 的 Markdown 预览器中阅读。另有一张自包含交互 HTML 架构图，可直接在浏览器打开，无需长期运行服务。

| 图 | 位置 | 表达视角 |
|---|---|---|
| 系统分层图、开发者用例视图 | 第一章 | 职责、OS 边界、开发角色 |
| 核心类关系、上行顺序、下行流程、生命周期 | 第二章 | QNX 协作和执行路径 |
| HIDL 写入顺序、AIDL 类关系 | 第三章 | 异步返回与接口分层 |
| 配置生成协作、属性开发活动 | 第四章 | 源文件到产物、开发步骤 |
| 构建流程 | 第五章 | buildCentral 到安装和打包 |
| 分段排障活动 | 第六章 | 按证据缩小问题范围 |
| [diagrams/vehicle-uplink.html](diagrams/vehicle-uplink.html) | 独立交互图 | 普通信号上行及双侧缓存 |

交互图规格保存在 [diagrams/vehicle-uplink.architecture.json](diagrams/vehicle-uplink.architecture.json)。其「数据库」形状用于表现内存状态存储，不表示系统新增了持久数据库。用例、生命周期和类图是已标明范围的简化视图，不是全量 UML 模型。

## 阅读边界

- 核对日期：2026-10-15。内容反映本地源码快照，不代表所有量产车型的运行状态。
- QNX 构建入口为 `/home/huo2wx/workspace/qnx/buildCentral`，文档统一保存在 VehicleService 仓库中。
- 已核对：`mk` 定位项目根目录后调用 `tools/buildCentral/build_central.py`；后者解析客户、项目、目标架构、模块和依赖构建参数。
- `-a` 是启用依赖构建的开关，模块名是位置参数。实际可用模块与目标以项目配置为准。
- 本次为说明书整理，不修改生产代码，不运行刷机、服务重启或共享产物编译。
- 文中的操作示例不等于本次执行记录。源码事实、教学简化和实机待确认项分别标注。
- Markdown 源码链接按当前目录布局使用相对路径；移动整份手册到其他位置后，需要保持仓库相对关系或更新链接。
- 已知操作风险：配置生成可能删除车型产物并替换公共 ConfigManager；旧 wrapper/parser 接口不匹配；测试脚本可能吞掉测试失败退出码。详见第四、五章。

## 学习目标

1. 分清 QNX VehicleService 与 Android Vehicle HAL 的职责。
2. 从一个车辆属性出发，追踪配置、协议、读写、订阅和回报。
3. 找到构建入口、生成工具、测试入口和故障定位路径。
4. 理解 HIDL 与 AIDL 两条实现分支，避免把并存源码误认为同一套运行服务。

## 文档维护约定

源码引用应指向实际存在的文件；调用顺序以函数实现为依据。图示用于解释特定视角，不把缓存写入、消息发送成功或接口返回成功等同于车辆执行成功。