import { z } from "zod";
import { hasRole } from "@/domain/auth/permissions";
import { badRequest, json, parseQuery, requireSession, route } from "@/server/http/route";
import { loadRemoteShellTargets } from "@/server/terminal/config";
import { describeTerminalProjects } from "@/server/terminal/projects";

export const runtime = "nodejs";

const querySchema = z.object({ target: z.string().min(1).max(200).optional() });

/** 解析目标 id 为目标显示名（用于 named_first 配置文件）；未提供或无效时返回 undefined */
function resolveTargetName(targetId: string | undefined): string | undefined {
  if (!targetId) return undefined;
  const target = loadRemoteShellTargets().find((t) => t.id === targetId);
  if (!target) throw badRequest("终端目标不存在或已下线");
  return target.name;
}

/** 远程终端项目配置：按 named_first 返回当前生效配置，附带缺失与可写位置信息 */
export const GET = route(async (request) => {
  const session = requireSession(request);
  const { target } = parseQuery(request, querySchema);
  const result = await describeTerminalProjects(process.cwd(), {
    targetName: resolveTargetName(target),
    isAdmin: hasRole(session, "admin"),
  });
  return json({
    projects: result.projects,
    configMissing: result.configMissing,
    canImportCanonical: result.canImportCanonical,
  });
}, "项目配置读取失败");
