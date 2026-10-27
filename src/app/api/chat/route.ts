import { HttpError, badRequest, json, requireSession, route } from "@/server/http/route";
import { buildChatMessages, parseChatRequest } from "@/server/chat/prompt";
import { chatStreamResponse, completeChat } from "@/server/chat/chat-service";

export const runtime = "nodejs";

/**
 * 智能助手对话。
 * - 默认返回 `{ reply }`（与旧版兼容）；
 * - body.stream === true 时返回 NDJSON 流：`{type:"delta",text}` / `{type:"done",reply}` / `{type:"error",error}`。
 */
export const POST = route(async (request) => {
  const session = requireSession(request);
  const body = await request.json().catch(() => null);
  const chat = parseChatRequest(body);
  if (!chat) throw badRequest("消息不能为空");

  const messages = buildChatMessages(chat, session);
  if (chat.stream) return chatStreamResponse(messages, request.signal);

  try {
    return json({ reply: await completeChat(messages) });
  } catch (error) {
    throw new HttpError(502, error instanceof Error ? error.message : "对话失败");
  }
}, "对话失败");
