import { z } from "zod";
import { authenticateUser, buildSessionCookie, createSessionToken } from "@/server/auth/session";
import { HttpError, json, parseJson, route } from "@/server/http/route";

const LoginBody = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

export const POST = route(async (request) => {
  const { username, password } = await parseJson(request, LoginBody);
  const user = authenticateUser(username, password);
  if (!user) throw new HttpError(401, "用户名或密码错误");
  const token = createSessionToken(user);
  return json({ token, user }, { headers: { "Set-Cookie": buildSessionCookie(token) } });
}, "登录失败");
