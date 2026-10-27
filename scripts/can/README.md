# CAN 解析运行依赖

入口 `scripts/plot_can_signals.js` 调用 Python 解码 ASC / BLF，并用 Playwright + Chart.js 渲染共享时间轴图片；浏览器渲染失败时保留 Python 图像作为兜底。支持 CAN FD、DBC 枚举标签、信号区间摘要及报文周期特性。

Python 3 环境需安装 `requirements.txt`。可用 `CAN_PYTHON_BIN=/path/to/python3` 指定解释器，否则使用 PATH 中的 `python3`。

```bash
python3 -m pip install -r scripts/can/requirements.txt
npx playwright install chromium
```

可用 `IVACP_BROWSER_EXECUTABLE` 指定 Chromium 路径。日志压缩包解压还需系统安装 `7za`。不需要新增 Node 依赖。

离线真实解码验证（生成临时 ASC / DBC，完成后清理）：

```bash
CAN_PYTHON_BIN=/path/to/python3 npx vitest run test/pipeline-can-runtime.test.ts
```

没有显式设置 `CAN_PYTHON_BIN` 时，该集成测试跳过，常规单测不要求系统 Python 依赖。
