import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const logRoot = path.join(root, "log");
const outputDir = path.join(root, "docs", "golden-baseline");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findMetricsFiles(dir) {
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findMetricsFiles(fullPath));
    } else if (entry.isFile() && entry.name === "pipeline-metrics.json") {
      files.push(fullPath);
    }
  }
  return files;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeDurations(metrics) {
  const durations = metrics.map((item) => item.durationMs).filter((value) => Number.isFinite(value));
  return {
    count: durations.length,
    averageMs: Math.round(average(durations)),
    p50Ms: Math.round(percentile(durations, 50)),
    p90Ms: Math.round(percentile(durations, 90)),
    maxMs: Math.round(durations.length ? Math.max(...durations) : 0),
  };
}

function summarizeAccuracy(metrics) {
  const statuses = metrics.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  const evidenceScores = metrics
    .map((item) => item.evidenceScore)
    .filter((value) => Number.isFinite(value));
  return {
    statusCounts: statuses,
    averageEvidenceScore: Number(average(evidenceScores).toFixed(3)),
  };
}

function summarizeStageDurations(metrics) {
  const stages = new Map();
  for (const item of metrics) {
    for (const [stage, value] of Object.entries(item.stageDurationsMs ?? {})) {
      if (!Number.isFinite(value)) continue;
      const values = stages.get(stage) ?? [];
      values.push(value);
      stages.set(stage, values);
    }
  }
  return Object.fromEntries(
    [...stages.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([stage, values]) => [
      stage,
      {
        averageMs: Math.round(average(values)),
        p90Ms: Math.round(percentile(values, 90)),
        maxMs: Math.round(Math.max(...values)),
      },
    ]),
  );
}

function summarizeEvidenceCompleteness(metrics) {
  const keys = [
    "canTraceFound",
    "dbcMatched",
    "signalsExtracted",
    "propIdsResolved",
    "commentTimeWindowFound",
    "androidQnxLogLinesFound",
    "canSignalSummaryFound",
  ];
  return Object.fromEntries(keys.map((key) => {
    const total = metrics.length;
    const passed = metrics.filter((item) => item.evidenceCompleteness?.[key]).length;
    return [key, { passed, total, ratio: total === 0 ? 0 : Number((passed / total).toFixed(3)) }];
  }));
}

function buildMarkdown(report) {
  const lines = [
    "# Golden Baseline",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `Total samples: ${report.sampleCount}`,
    "",
    "## Duration",
    "",
    `- Average: ${report.duration.averageMs} ms`,
    `- P50: ${report.duration.p50Ms} ms`,
    `- P90: ${report.duration.p90Ms} ms`,
    `- Max: ${report.duration.maxMs} ms`,
    "",
    "## Accuracy",
    "",
    `- Average evidence score: ${report.accuracy.averageEvidenceScore}`,
    `- Status counts: ${JSON.stringify(report.accuracy.statusCounts)}`,
    "",
    "## Evidence Completeness",
    "",
  ];

  for (const [key, value] of Object.entries(report.evidenceCompleteness)) {
    lines.push(`- ${key}: ${value.passed}/${value.total} (${value.ratio})`);
  }

  lines.push("", "## Stage Duration P90", "");
  for (const [stage, value] of Object.entries(report.stageDurations)) {
    lines.push(`- ${stage}: p90=${value.p90Ms} ms, avg=${value.averageMs} ms, max=${value.maxMs} ms`);
  }

  lines.push("", "## Samples", "");
  for (const sample of report.samples) {
    lines.push(`- ${sample.issueKey} | ${sample.ruleGroupName} | ${sample.carModel} | ${sample.status} | ${sample.durationMs} ms | evidence=${sample.evidenceScore}`);
  }

  return lines.join("\n") + "\n";
}

async function main() {
  const files = await findMetricsFiles(logRoot);
  const metrics = [];
  for (const file of files) {
    try {
      const item = JSON.parse(await fs.readFile(file, "utf-8"));
      metrics.push({ ...item, metricsPath: path.relative(root, file) });
    } catch (error) {
      console.warn(`[baseline] 跳过无法解析的 metrics 文件: ${file} (${error.message})`);
    }
  }

  const samples = metrics
    .sort((a, b) => String(a.issueKey).localeCompare(String(b.issueKey)))
    .map((item) => ({
      issueKey: item.issueKey,
      summary: item.summary,
      ruleGroupName: item.ruleGroupName,
      carModel: item.carModel,
      mode: item.mode,
      status: item.status,
      durationMs: item.durationMs,
      evidenceScore: item.evidenceScore,
      metricsPath: item.metricsPath,
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    duration: summarizeDurations(metrics),
    accuracy: summarizeAccuracy(metrics),
    evidenceCompleteness: summarizeEvidenceCompleteness(metrics),
    stageDurations: summarizeStageDurations(metrics),
    samples,
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "golden-baseline.json"), JSON.stringify(report, null, 2), "utf-8");
  await fs.writeFile(path.join(outputDir, "golden-baseline.md"), buildMarkdown(report), "utf-8");

  console.log(`[baseline] samples=${report.sampleCount}`);
  console.log(`[baseline] wrote ${path.relative(root, path.join(outputDir, "golden-baseline.json"))}`);
  console.log(`[baseline] wrote ${path.relative(root, path.join(outputDir, "golden-baseline.md"))}`);
}

if (process.argv.includes("--help")) console.log("生成本地 log/ 的耗时、阶段、证据完整度基线：npm run baseline:golden");
else main().catch((error) => {
  console.error(error);
  process.exit(1);
});
