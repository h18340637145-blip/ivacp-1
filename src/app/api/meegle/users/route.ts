import { requireSession, route } from "@/server/http/route";
import { createGetMeegleUsersHandler } from "@/server/meegle/users";

export const runtime = "nodejs";

const searchUsers = createGetMeegleUsersHandler();

/** 搜索飞书空间人员目录：?projectKey=&q= */
export const GET = route(async (request) => {
  requireSession(request);
  return searchUsers(request);
}, "获取飞书人员目录失败");
