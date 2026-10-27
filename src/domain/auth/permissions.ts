/** 角色与路径权限（纯逻辑，供 proxy 与服务端路由共用） */
export type AuthRole = "analyst" | "reviewer" | "admin";

export interface AuthUser {
  username: string;
  displayName: string;
  role: AuthRole;
}

export interface AuthSession extends AuthUser {
  /** 过期时间（Unix 秒） */
  exp: number;
}

export const AUTH_SESSION_COOKIE = "ivacp_session";

export const ROLE_LABEL: Record<AuthRole, string> = {
  analyst: "分析员",
  reviewer: "复核员",
  admin: "管理员",
};

const ROLE_RANK: Record<AuthRole, number> = { analyst: 1, reviewer: 2, admin: 3 };

export function hasRole(session: Pick<AuthSession, "role"> | null | undefined, role: AuthRole): boolean {
  return Boolean(session && ROLE_RANK[session.role] >= ROLE_RANK[role]);
}

export const PUBLIC_PATH_PREFIXES = ["/login", "/api/auth", "/api/openapi", "/api/docs", "/_next"] as const;

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    pathname === "/favicon.ico" ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  );
}

/** 写回外部系统（评论 / 流转 / 复核）需要复核员及以上 */
const REVIEWER_WRITE_PATHS = ["/api/meegle/authorize", "/api/meegle/comment", "/api/meegle/workflow"];

export function requiredRoleForPath(pathname: string, method: string): AuthRole {
  if (pathname.startsWith("/terminal") || pathname.startsWith("/api/terminal")) return "admin";
  const isRead = method === "GET" || method === "HEAD";
  if (
    pathname === "/api/jira/comment" ||
    pathname.includes("/transition") ||
    pathname === "/api/issues/review" ||
    (method === "POST" && REVIEWER_WRITE_PATHS.includes(pathname))
  ) {
    return isRead ? "analyst" : "reviewer";
  }
  if (pathname.startsWith("/api/rule-groups")) return isRead ? "analyst" : "admin";
  if (pathname.startsWith("/api/migration")) return "admin";
  return "analyst";
}

export function canAccessPath(pathname: string, method: string, session: AuthSession | null): boolean {
  if (!session) return false;
  return hasRole(session, requiredRoleForPath(pathname, method));
}
