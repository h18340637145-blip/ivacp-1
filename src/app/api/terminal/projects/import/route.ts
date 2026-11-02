import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hasRole } from "@/domain/auth/permissions";
import { badRequest, json, parseJson, requireSession, route } from "@/server/http/route";
import { loadRemoteShellTargets } from "@/server/terminal/config";
import { resolveImportWriteFile } from "@/server/terminal/project-file";
import { validateProjects, atomicJson, exists } from "@/server/terminal/sync/storage";

export const runtime = "nodejs";

const bodySchema = z.object({
  targetId: z.string().min(1).max(200).optional(),
  projects: z.array(z.unknown()),
});

/** 导入 project.json：管理员覆盖 docs/project.json，其它登录用户写入 docs/project_<目标名>.json；覆盖前备份到 docs/bak/ */
export const POST = route(async (request) => {
  const session = requireSession(request);
  const isAdmin = hasRole(session, "admin");
  const body = await parseJson(request, bodySchema);

  let targetName: string | undefined;
  if (body.targetId) {
    const target = loadRemoteShellTargets().find((t) => t.id === body.targetId);
    if (!target) throw badRequest("终端目标不存在或已下线");
    targetName = target.name;
  }
  if (!isAdmin && !targetName) throw badRequest("非管理员导入需指定终端目标");

  let projects;
  try {
    projects = validateProjects(body.projects);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "project.json 内容无效");
  }

  const root = process.cwd();
  const file = resolveImportWriteFile(root, targetName ?? "", isAdmin);
  if (await exists(file)) {
    if ((await fs.lstat(file)).isSymbolicLink()) throw badRequest("配置文件不能是符号链接");
  }

  let backupPath: string | undefined;
  if (await exists(file)) {
    const backupDir = path.join(root, "docs/bak");
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = path.join(backupDir, `${path.basename(file, ".json")}-${stamp}.json`);
    await fs.copyFile(file, backupPath);
    await fs.rm(file, { force: true });
  }
  await atomicJson(file, projects);

  return json({
    file: path.relative(root, file),
    backup: backupPath ? path.relative(root, backupPath) : null,
    scope: isAdmin ? "canonical" : "named",
    projectCount: projects.length,
  });
}, "项目配置导入失败");
