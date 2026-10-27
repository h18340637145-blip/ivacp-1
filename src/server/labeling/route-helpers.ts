import type { AuthSession } from "@/domain/auth/permissions";
import { hasRole } from "@/domain/auth/permissions";
import { isMysqlConfigured } from "@/server/db/mysql";
import { HttpError, requireSession } from "@/server/http/route";

/** 标注接口：需要登录；写操作需要复核员及以上；未配置数据库返回 503 */
export function requireLabelingSession(request: Request, write = false): AuthSession {
  const session = requireSession(request);
  if (write && !hasRole(session, "reviewer")) throw new HttpError(403, "标注需要复核员及以上权限");
  if (!isMysqlConfigured()) throw new HttpError(503, "服务端未配置 MYSQL_URL，无法使用标注系统");
  return session;
}

/** 与旧版一致：标注业务错误（校验失败、条目不存在等）统一按 400 返回 */
export async function labelingAction<T>(fn: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error && error.message ? error.message : fallback);
  }
}
