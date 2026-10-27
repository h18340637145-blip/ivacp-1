import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { AUTH_SESSION_COOKIE, type AuthRole, type AuthSession, type AuthUser } from "@/domain/auth/permissions";

export { AUTH_SESSION_COOKIE };
export type { AuthRole, AuthSession, AuthUser };

interface LoginJsonUser {
  username?: unknown;
  password?: unknown;
}

function sessionTtlSeconds(): number {
  const raw = Number(process.env.AUTH_SESSION_TTL_SECONDS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 8;
}

export function authSecret(): string {
  return process.env.AUTH_SECRET?.trim() || "ivacp-local-session-secret";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function roleForUsername(username: string): AuthRole {
  return username.toLowerCase() === "admin" ? "admin" : "analyst";
}

function displayNameForUsername(username: string): string {
  return username.toLowerCase() === "admin" ? "管理员" : username;
}

/** 用户清单来自 docs/login.json */
export function loadLoginUsers(): Array<AuthUser & { password: string }> {
  const file = path.join(process.cwd(), "docs/login.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, LoginJsonUser>;
  return Object.values(parsed).map((entry) => {
    if (typeof entry.username !== "string" || typeof entry.password !== "string") {
      throw new Error("docs/login.json 用户项必须包含 username/password 字符串");
    }
    return {
      username: entry.username,
      password: entry.password,
      displayName: displayNameForUsername(entry.username),
      role: roleForUsername(entry.username),
    };
  });
}

export function authenticateUser(username: string, password: string): AuthUser | null {
  const matched = loadLoginUsers().find((user) => user.username === username && user.password === password);
  return matched ? { username: matched.username, displayName: matched.displayName, role: matched.role } : null;
}

export function createSessionToken(user: AuthUser): string {
  const payload = Buffer.from(
    JSON.stringify({
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds(),
    }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): AuthSession | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthSession;
    if (!session.username || !session.role || !session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export function readSessionFromRequest(request: NextRequest | Request): AuthSession | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_SESSION_COOKIE}=`));
  return verifySessionToken(match ? decodeURIComponent(match.slice(AUTH_SESSION_COOKIE.length + 1)) : null);
}

export function buildSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" && process.env.AUTH_COOKIE_SECURE !== "false" ? "; Secure" : "";
  return `${AUTH_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionTtlSeconds()}${secure}`;
}

export function buildExpiredSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" && process.env.AUTH_COOKIE_SECURE !== "false" ? "; Secure" : "";
  return `${AUTH_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
