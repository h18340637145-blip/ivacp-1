import { z } from "zod";
import { HttpError, json, parseJson, requireSession, route } from "@/server/http/route";
import { decideMemory, extractMemories } from "@/server/chat/memory";

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("extract"),
    user: z.string().default(""),
    assistant: z.string().default(""),
  }),
  z.object({
    action: z.literal("decide"),
    candidate: z.string().default(""),
    neighbours: z.array(z.unknown()).default([]),
  }),
]);

/** 长期记忆：extract 从对话中抽取候选；decide 判断候选与近邻记忆的关系 */
export const POST = route(async (request) => {
  requireSession(request);
  const raw = (await request.clone().json().catch(() => null)) as { action?: unknown } | null;
  if (raw && raw.action !== "extract" && raw.action !== "decide") throw new HttpError(400, "未知操作");
  const body = await parseJson(request, bodySchema);
  try {
    if (body.action === "extract") {
      return json({ memories: await extractMemories(body.user, body.assistant) });
    }
    const neighbours = body.neighbours.filter((n): n is string => typeof n === "string");
    return json({ decision: await decideMemory(body.candidate, neighbours) });
  } catch (error) {
    throw new HttpError(502, error instanceof Error ? error.message : "记忆处理失败");
  }
}, "记忆处理失败");
