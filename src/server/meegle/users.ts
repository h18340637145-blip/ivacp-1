import { NextResponse } from "next/server";
import { searchMeegleUserDirectory, type MeegleDirectoryUser } from "@/server/meegle/user-directory";

type SearchUsers = (projectKey: string, query: string) => Promise<MeegleDirectoryUser[]>;

/** GET /api/meegle/users?projectKey=&q= —— 按姓名/邮箱搜索飞书空间人员目录 */
export function createGetMeegleUsersHandler(searchUsers: SearchUsers = searchMeegleUserDirectory) {
  return async function GET(request: Request): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const projectKey = searchParams.get("projectKey")?.trim() ?? "";
    const query = searchParams.get("q")?.trim() ?? "";
    if (!projectKey || !query) {
      return NextResponse.json({ error: "projectKey 和非空 q 为必填项" }, { status: 400 });
    }
    try {
      const users = await searchUsers(projectKey, query);
      return NextResponse.json({ users, complete: true });
    } catch {
      return NextResponse.json({ error: "获取飞书人员目录失败" }, { status: 502 });
    }
  };
}
