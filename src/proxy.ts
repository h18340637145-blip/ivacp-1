import { NextResponse, type NextRequest } from "next/server";
import { AUTH_SESSION_COOKIE, canAccessPath, isPublicPath, type AuthSession } from "@/domain/auth/permissions";

function secret(): string {
  return process.env.AUTH_SECRET?.trim() || "ivacp-local-session-secret";
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function verify(token: string | undefined): Promise<AuthSession | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sig = base64UrlToBytes(signature);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer,
      new TextEncoder().encode(payload),
    );
    if (!ok) return null;
    const session = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as AuthSession;
    if (!session.username || !session.role || !session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verify(request.cookies.get(AUTH_SESSION_COOKIE)?.value);

  if (pathname === "/login" && session) return NextResponse.redirect(new URL("/", request.url));
  if (isPublicPath(pathname)) return NextResponse.next();

  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (!canAccessPath(pathname, request.method, session)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "当前角色无权执行该操作" }, { status: 403 });
    return NextResponse.redirect(new URL("/?forbidden=1", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
