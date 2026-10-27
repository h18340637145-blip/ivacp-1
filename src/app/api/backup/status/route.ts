import { HttpError, json, requireSession, route } from "@/server/http/route";
import { isMysqlConfigured } from "@/server/db/mysql";
import { readMirrorStatus } from "@/server/db/mirror";

export const runtime = "nodejs";

export const GET = route(async (request) => {
  const session = requireSession(request);
  if (!isMysqlConfigured()) return json({ configured: false, owner: session.username });
  try {
    const status = await readMirrorStatus(session.username);
    return json({ configured: true, available: true, owner: session.username, ...status });
  } catch (error) {
    throw new HttpError(503, error instanceof Error ? error.message : "服务端数据库不可用");
  }
});
