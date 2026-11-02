import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { badRequest, notFound, parseQuery, requireSession, route } from "@/server/http/route";
import { loadRemoteShellTargets } from "@/server/terminal/config";
import { resolveProjectReadFile } from "@/server/terminal/project-file";
import { exists } from "@/server/terminal/sync/storage";

export const runtime = "nodejs";

const querySchema = z.object({ target: z.string().min(1).max(200).optional() });

/** 导出当前生效的 project.json（named_first，含同步写回的 commit/RTC 映射） */
export const GET = route(async (request) => {
  requireSession(request);
  const { target } = parseQuery(request, querySchema);
  let targetName: string | undefined;
  if (target) {
    const found = loadRemoteShellTargets().find((t) => t.id === target);
    if (!found) throw badRequest("终端目标不存在或已下线");
    targetName = found.name;
  }
  const root = process.cwd();
  const file = await resolveProjectReadFile(root, targetName);
  if (!(await exists(file))) throw notFound("服务端尚无 project.json，可先导入后再导出");
  if ((await fs.lstat(file)).isSymbolicLink()) throw badRequest("配置文件不能是符号链接");
  const content = await fs.readFile(file, "utf8");
  return new Response(content, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${path.basename(file)}"`,
    },
  });
}, "项目配置导出失败");
