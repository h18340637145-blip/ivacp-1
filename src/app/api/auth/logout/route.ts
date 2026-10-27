import { buildExpiredSessionCookie } from "@/server/auth/session";
import { json } from "@/server/http/route";

export async function POST() {
  return json({ success: true }, { headers: { "Set-Cookie": buildExpiredSessionCookie() } });
}
