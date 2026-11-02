import { json, requireSession, route } from "@/server/http/route";
import { loadRemoteShellTargets, toPublicTarget } from "@/server/terminal/config";

export const runtime = "nodejs";

/** 可连接的远程终端目标（不含主机与认证信息），任意已登录用户可读 */
export const GET = route(async (request) => {
  requireSession(request);
  return json({ targets: loadRemoteShellTargets().map(toPublicTarget) });
}, "远程终端目标配置无效");
