import type { AuthSession } from "@/domain/auth/permissions";
import { HttpError, requireSession } from "@/server/http/route";
import { isMysqlConfigured } from "@/server/db/mysql";

/** 备份接口的数据归属账号：取当前登录用户；未配置数据库时返回 503 */
export function requireBackupOwner(request: Request): AuthSession {
  const session = requireSession(request);
  if (!isMysqlConfigured()) throw new HttpError(503, "服务端未配置 MYSQL_URL，无法使用服务器备份");
  return session;
}
