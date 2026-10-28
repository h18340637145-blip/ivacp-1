import { exportReviewTruth } from "../src/server/evaluation/export-truth";
import { closePools } from "../src/server/db/mysql";
const args = process.argv.slice(2);
const ownerIndex = args.indexOf("--owner");
const owner = args.find(arg => arg.startsWith("--owner="))?.slice(8) ?? (ownerIndex >= 0 ? args[ownerIndex + 1] : "admin");
if (args.includes("--help")) console.log("npm run eval:export-truth -- [--owner admin] [--dry-run]；只读sync_records，合并本地评测真值，保留手写条目。");
else if (!owner || owner.startsWith("--")) { console.error("--owner需要账号名称"); process.exitCode = 1; }
else exportReviewTruth({ owner, dryRun: args.includes("--dry-run") })
  .then(report => console.log(JSON.stringify(report, null, 2)))
  .catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(closePools);
