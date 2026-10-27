#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const os = require("node:os");
const chartTemplate = require("./can/chart-template.cjs");
const path = require("path");
const fs = require("fs").promises;

function parseCanTraceTimestampAsLocal(timestamp) {
  const match = String(timestamp).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|[+-]\d{2}:?\d{2})?$/
  );

  if (!match) {
    return new Date(timestamp).getTime();
  }

  const [, yearText, monthText, dayText, hoursText, minutesText, secondsText, millisecondsText = "0"] = match;
  return new Date(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    Number(hoursText),
    Number(minutesText),
    Number(secondsText),
    Number(millisecondsText.padEnd(3, "0")),
  ).getTime();
}

async function main() {
  const args = process.argv.slice(2);
  let traceFile = "";
  const dbcs = [];
  let signalsStr = "";
  let outputFile = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--trace") {
      traceFile = args[++i];
    } else if (args[i] === "--dbc") {
      dbcs.push(args[++i]);
    } else if (args[i] === "--signals") {
      signalsStr = args[++i];
    } else if (args[i] === "--output") {
      outputFile = args[++i];
    }
  }

  if (!traceFile || dbcs.length === 0 || !signalsStr || !outputFile) {
    console.log(JSON.stringify({ image: "", summary: "", error: "Missing required parameters" }));
    process.exit(0);
  }

  // Use a temporary path for the python output image since Node will overwrite it
  const tempOutputDir = path.join(os.tmpdir(), "ivacp-can");
  try {
    await fs.mkdir(tempOutputDir, { recursive: true });
  } catch {}
  const tempOutputFile = path.join(tempOutputDir, `temp_py_output_${randomUUID()}.png`);

  const pyArgs = [
    path.join(process.cwd(), "scripts", "plot_can_signals.py"),
    "--trace", traceFile,
    ...dbcs.flatMap(d => ["--dbc", d]),
    "--signals", signalsStr,
    "--output", tempOutputFile
  ];

  const pythonProcess = spawn(process.env.CAN_PYTHON_BIN || "python3", pyArgs);
  
  let stdout = "";
  let stderr = "";
  pythonProcess.stdout.on("data", data => { stdout += data.toString(); });
  pythonProcess.stderr.on("data", data => { stderr += data.toString(); });

  const exitCode = await new Promise(resolve => {
    pythonProcess.on("error", error => { stderr += error.message; resolve(-1); });
    pythonProcess.on("close", resolve);
  });

  if (exitCode !== 0) {
    try { await fs.unlink(tempOutputFile); } catch {}
    console.log(JSON.stringify({ image: "", summary: "", error: `Python exit ${exitCode}: ${stderr}` }));
    process.exit(0);
  }

  let resultData;
  try {
    resultData = JSON.parse(stdout.trim());
  } catch {
    console.log(JSON.stringify({ image: "", summary: "", error: `Failed to parse python output: ${stdout.slice(0, 300)}` }));
    process.exit(0);
  }

  const { trace_data, ticks, traceStartTime, traceEndTime } = resultData;
  if (!trace_data || Object.keys(trace_data).length === 0) {
    // If no signal data was decoded, return the result directly
    try { await fs.unlink(tempOutputFile); } catch {}
    console.log(JSON.stringify(resultData));
    process.exit(0);
  }

  // Draw chart using Playwright and Chart.js
  let browser;
  try {
    const { chromium } = require("playwright");
    browser = await chromium.launch({ headless: true, ...(process.env.IVACP_BROWSER_EXECUTABLE ? { executablePath: process.env.IVACP_BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage();
    const renderErrors = [];
    page.on("pageerror", error => renderErrors.push(error.message));

    const chartJsPath = path.join(process.cwd(), "node_modules", "chart.js", "dist", "chart.umd.js");
    const chartJsContent = await fs.readFile(chartJsPath, "utf8");

    const keys = Object.keys(trace_data);
    const n = keys.length;

    let minX = undefined;
    let maxX = undefined;

    if (traceStartTime) {
      const t = parseCanTraceTimestampAsLocal(traceStartTime);
      if (!isNaN(t)) minX = t;
    }
    if (traceEndTime) {
      const t = parseCanTraceTimestampAsLocal(traceEndTime);
      if (!isNaN(t)) maxX = t;
    }

    if (minX === undefined || maxX === undefined) {
      let dataMin = Infinity;
      let dataMax = -Infinity;
      keys.forEach(key => {
        const pts = trace_data[key].x;
        if (pts && pts.length > 0) {
          const t0 = parseCanTraceTimestampAsLocal(pts[0]);
          const tN = parseCanTraceTimestampAsLocal(pts[pts.length - 1]);
          if (!isNaN(t0) && t0 < dataMin) dataMin = t0;
          if (!isNaN(tN) && tN > dataMax) dataMax = tN;
        }
      });
      if (minX === undefined && dataMin !== Infinity) minX = dataMin;
      if (maxX === undefined && dataMax !== -Infinity) maxX = dataMax;
    }

    const minXVal = minX !== undefined ? minX : null;
    const maxXVal = maxX !== undefined ? maxX : null;

    const firstKey = keys[0];
    const startLabel = traceStartTime ? `Start: ${traceStartTime}` : `Start: ${trace_data[firstKey].x[0]}`;
    const colors = ["#e74c3c", "#2ecc71", "#3498db", "#9b59b6", "#f39c12", "#1abc9c", "#34495e"];

    const htmlContent = chartTemplate({ chartJsContent, traceFile, keys, trace_data, ticks, colors, startLabel, minXVal, maxXVal });

    const viewportHeight = Math.max(300 * n + 80, 500);
    await page.setViewportSize({ width: 1200, height: viewportHeight });
    await page.setContent(htmlContent);
    await page.waitForLoadState("networkidle");
    
    // Add small delay to ensure chart draws completely
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));

    const renderedChartCount = await page.evaluate(() =>
      Array.from(document.querySelectorAll("canvas"))
        .filter(canvas => Boolean(Chart.getChart(canvas)))
        .length
    );
    if (renderErrors.length > 0 || renderedChartCount !== n) {
      throw new Error(renderErrors[0] || `Expected ${n} charts, rendered ${renderedChartCount}`);
    }

    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await page.screenshot({
      path: outputFile,
      fullPage: true
    });

    resultData.image = outputFile;
  } catch (err) {
    resultData.error = `Playwright rendering error: ${err.message}; used Python fallback`;
    try {
      await fs.mkdir(path.dirname(outputFile), { recursive: true });
      await fs.copyFile(tempOutputFile, outputFile);
      resultData.image = outputFile;
    } catch (fallbackError) {
      resultData.error += `; fallback copy failed: ${fallbackError.message}`;
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    try { await fs.unlink(tempOutputFile); } catch {}
  }

  console.log(JSON.stringify(resultData));
}

main().catch(err => {
  console.log(JSON.stringify({ image: "", summary: "", error: `Unhandled script error: ${err.message}` }));
});
