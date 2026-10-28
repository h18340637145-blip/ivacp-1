import { buildEvalSetCoverageReport } from "../src/server/evaluation/coverage";

if (process.argv.includes("--help")) console.log("读取当前目录 log/ 与 docs/golden-baseline/eval-set.json，生成离线报告，不调用模型。");
else buildEvalSetCoverageReport().catch(error => { console.error(error); process.exitCode = 1; });
