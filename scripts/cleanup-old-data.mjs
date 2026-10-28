import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const days = Number(process.env.DATA_RETENTION_DAYS ?? 90);
async function cleanup(dir, cutoff) {
  let count = 0;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return 0; throw error; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (full === path.join(root, "log/docupedia-upload-stats")) continue;
    if (entry.isDirectory()) {
      count += await cleanup(full, cutoff);
      if (!dryRun && !(await fs.readdir(full)).length) await fs.rmdir(full);
    } else if (entry.isFile() && (await fs.stat(full)).mtimeMs < cutoff) {
      if (!dryRun) await fs.rm(full);
      count++;
    }
  }
  return count;
}
async function main() {
  if (!Number.isFinite(days) || days <= 0) throw new Error("DATA_RETENTION_DAYS 必须为大于0的有限天数");
  const cutoff = Date.now() - days * 86400_000;
  console.log(`${dryRun ? "只读预览" : "清理"}：保留最近 ${days} 天`);
  for (const name of ["jira-issues", "log"]) console.log(`${name}：${await cleanup(path.join(root, name), cutoff)} 个过期文件`);
}
if (process.argv.includes("--help")) console.log("npm run cleanup:data -- [--dry-run]；DATA_RETENTION_DAYS默认90天，保留Docupedia月度统计。");
else main().catch(error => { console.error(error.message); process.exitCode = 1; });
