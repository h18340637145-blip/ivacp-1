import type { AuthSession } from "@/domain/auth/permissions";
import type { QwenMessage } from "@/server/ai/qwen";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContextChunk {
  docName: string;
  text: string;
}

export interface ChatRequest {
  message: string;
  history: ChatTurn[];
  context: ChatContextChunk[];
  memories: string[];
  stream: boolean;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";

/**
 * 宽松解析 /api/chat 请求体（与旧版一致：非法条目直接丢弃而非报错，并截断长度）。
 * 返回 null 表示 message 为空。
 */
export function parseChatRequest(body: unknown): ChatRequest | null {
  const record = isRecord(body) ? body : {};
  const message = typeof record.message === "string" ? record.message.trim().slice(0, 8000) : "";
  if (!message) return null;

  const history = asArray(record.history)
    .filter(
      (m): m is ChatTurn =>
        isRecord(m) && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    )
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  const context = asArray(record.context)
    .filter((c): c is ChatContextChunk => isRecord(c) && typeof c.docName === "string" && typeof c.text === "string")
    .slice(0, 6)
    .map((c) => ({ docName: c.docName, text: c.text }));

  const memories = asArray(record.memories)
    .filter((m): m is string => typeof m === "string")
    .slice(0, 6)
    .map((m) => m.slice(0, 300));

  return { message, history, context, memories, stream: record.stream === true };
}

export function buildChatSystemPrompt(
  session: Pick<AuthSession, "username" | "displayName" | "role"> | null,
  memories: string[],
  context: ChatContextChunk[],
): string {
  return [
    "你是 IVACP 车辆问题智能分析平台（Jira / 飞书项目工单 AI 分析）的助手，请使用中文简洁回答。",
    session ? `当前用户：${session.displayName}（${session.username}，角色 ${session.role}）。` : "",
    memories.length
      ? `# 关于该用户的记忆（自然地利用，不要提及“记忆”一词；不相关时忽略）\n${memories.map((m) => `- ${m}`).join("\n")}`
      : "",
    context.length
      ? `# 知识库片段（信息相关时优先依据，不相关时忽略）\n${context
          .map((c) => `[${c.docName.slice(0, 100)}]\n${c.text.slice(0, 1200)}`)
          .join("\n---\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildChatMessages(
  request: ChatRequest,
  session: Pick<AuthSession, "username" | "displayName" | "role"> | null,
): QwenMessage[] {
  return [
    { role: "system", content: buildChatSystemPrompt(session, request.memories, request.context) },
    ...request.history,
    { role: "user", content: request.message },
  ];
}
