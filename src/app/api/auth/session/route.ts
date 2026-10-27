import type { NextRequest } from "next/server";
import { readSessionFromRequest } from "@/server/auth/session";
import { json } from "@/server/http/route";

export async function GET(request: NextRequest) {
  const session = readSessionFromRequest(request);
  if (!session) return json({ authenticated: false }, { status: 401 });
  return json({
    authenticated: true,
    user: { username: session.username, displayName: session.displayName, role: session.role },
  });
}
