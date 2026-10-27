import type { AuthSession } from "@/domain/auth/permissions";
import { isMysqlConfigured } from "@/server/db/mysql";
import { HttpError, requireSession } from "@/server/http/route";

export function requireTemplateSession(request: Request): AuthSession {
  const session = requireSession(request);
  if (!isMysqlConfigured()) throw new HttpError(503, "服务端未配置 MYSQL_URL，无法使用团队模板库");
  return session;
}

/** 数据库异常默认按 503 返回（与旧版一致）；发布校验失败由调用方传 400 */
export async function templateAction<T>(fn: () => Promise<T>, fallback = "服务端数据库不可用", status = 503): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(status, error instanceof Error && error.message ? error.message : fallback);
  }
}
