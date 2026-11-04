/**
 * 手动上传指定文件到 Docupedia，用于排查上传失败。
 * 用法：npm run docupedia:upload -- <文件...> [--parent <父页面ID>] [--prefix <标题前缀>] [--max-chars <N>] [--no-limit] [--retries <N>] [--timeout <秒>]
 * 配置沿用 .env 中的 DOCUPEDIA_*、HTTPS_PROXY 等；每个文件一个页面，标题为 前缀+文件名（默认前缀带时间戳；Docupedia 标题在空间内唯一，重名会失败）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { uploadDocupediaPage } from "../src/server/docupedia/client";

const args = process.argv.slice(2);
const files: string[] = [];
let parentId: string | undefined;
// 标题在同一空间内必须唯一，默认带时间戳避免与已有页面重名
let prefix = `manual_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}_`;
let maxChars: number | undefined;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--parent") parentId = args[++i];
  else if (arg === "--prefix") prefix = args[++i] ?? "";
  else if (arg === "--max-chars") maxChars = Number(args[++i]);
  else if (arg === "--retries") process.env.DOCUPEDIA_REQUEST_RETRIES = String(Math.max(1, Number(args[++i]) || 1));
  else if (arg === "--timeout") process.env.DOCUPEDIA_REQUEST_TIMEOUT_MS = String(Math.max(1, Number(args[++i]) || 1) * 1000);
  else if (arg === "--no-limit") maxChars = Number.MAX_SAFE_INTEGER;
  else if (arg === "--") continue;
  else if (arg.startsWith("--")) { console.error(`未知选项：${arg}`); process.exit(1); }
  else files.push(arg);
}
if (parentId !== undefined && !/^\d+$/.test(parentId)) { console.error("--parent 需要数字页面ID"); process.exit(1); }
if (!files.length) {
  console.error("用法：npm run docupedia:upload -- <文件...> [--parent <ID>] [--prefix <前缀>] [--max-chars <N>] [--no-limit] [--retries <N>] [--timeout <秒>]");
  process.exit(1);
}
if (process.env.ENABLE_DOCUPEDIA === "0") console.warn("提示：ENABLE_DOCUPEDIA=0 仅影响自动归档，本脚本仍会上传。");

async function main(): Promise<number> {
  let failed = 0;
  for (const file of files) {
    const absolute = path.resolve(file);
    if (!existsSync(absolute)) { console.error(`✗ 文件不存在：${file}`); failed += 1; continue; }
    const text = readFileSync(absolute, "utf8");
    const title = `${prefix}${path.basename(absolute).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]+/g, "_")}`;
    console.log(`… 上传 ${title}（${text.length} 字符，重试=${process.env.DOCUPEDIA_REQUEST_RETRIES ?? "默认6"}，超时=${process.env.DOCUPEDIA_REQUEST_TIMEOUT_MS ?? "默认180000"}ms）`);
    const started = Date.now();
    try {
      const result = await uploadDocupediaPage({ title, text, parentId, maxChars });
      console.log(`✓ ${title} (${text.length} 字符, ${Date.now() - started}ms) ${result.action} ${result.url ?? result.id ?? ""}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${title} (${text.length} 字符)：${String(error).slice(0, 400)}`);
    }
  }
  return failed;
}

main().then((failed) => process.exit(failed ? 1 : 0));
