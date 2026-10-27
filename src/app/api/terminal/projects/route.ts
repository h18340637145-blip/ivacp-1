import { json, requireSession, route } from "@/server/http/route";
import { loadTerminalProjects } from "@/server/terminal/projects";

export const runtime = "nodejs";

/** 远程终端项目配置（docs/project.json），仅管理员 */
export const GET = route(async (request) => {
  requireSession(request, "admin");
  return json({ projects: await loadTerminalProjects() });
}, "项目配置读取失败");
