/**
 * 旧系统一键迁移（命令行入口）。
 *   npm run migrate:legacy -- [--overwrite] [--owner=admin] [--legacy-app-dir=/path/to/old/app]
 * - 迁移旧 MySQL（LEGACY_MYSQL_URL，缺省为 MYSQL_URL 同实例的 jira_analyzer_next 库）到新库 ivacp。
 * - 指定 --legacy-app-dir 时同时复制旧应用的 data/rule-groups.json（新系统缺失时）与 log/ 下缺失的分析产物，
 *   保证旧结果中的图表 / 产物链接继续可用。jira-issues/ 为附件下载缓存，不复制。
 * 浏览器 IndexedDB 的旧数据请在「数据管理」页点击“从旧系统迁移”。
 */
import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { closePools } from "@/server/db/mysql";
import { migrateLegacyMysql } from "@/server/migration/legacy-mysql";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function copyLegacyFiles(legacyAppDir: string) {
  const ruleGroupsSource = path.join(legacyAppDir, "data/rule-groups.json");
  const ruleGroupsTarget = path.join(process.cwd(), "data/rule-groups.json");
  if ((await exists(ruleGroupsSource)) && !(await exists(ruleGroupsTarget))) {
    await mkdir(path.dirname(ruleGroupsTarget), { recursive: true });
    await cp(ruleGroupsSource, ruleGroupsTarget);
    console.log("已复制 data/rule-groups.json");
  }
  const logSource = path.join(legacyAppDir, "log");
  if (await exists(logSource)) {
    await cp(logSource, path.join(process.cwd(), "log"), { recursive: true, force: false, errorOnExist: false });
    console.log("已补齐 log/ 分析产物");
  }
}

async function main() {
  const overwrite = process.argv.includes("--overwrite");
  const owner = arg("owner");
  const legacyAppDir = arg("legacy-app-dir");
  if (legacyAppDir) await copyLegacyFiles(path.resolve(legacyAppDir));
  const report = await migrateLegacyMysql({
    overwrite,
    owners: owner ? [owner] : undefined,
    operator: "cli",
    onProgress: (message) => console.log(message),
  });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error("迁移失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePools());
