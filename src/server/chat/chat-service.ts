import { callQwen, type QwenMessage } from "@/server/ai/qwen";
import { streamQwen } from "./qwen-stream";
import { createThinkFilter, stripThink } from "./stream-text";

/** /api/chat 流式协议（NDJSON，每行一个事件） */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reply: string }
  | { type: "error"; error: string };

export async function completeChat(messages: QwenMessage[]): Promise<string> {
  return stripThink(await callQwen(messages));
}

export function chatStreamResponse(messages: QwenMessage[], signal?: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const filter = createThinkFilter();
      let reply = "";
      try {
        for await (const raw of streamQwen(messages, signal)) {
          const text = filter.push(raw);
          if (text) {
            reply += text;
            send({ type: "delta", text });
          }
        }
        const rest = filter.flush();
        if (rest) {
          reply += rest;
          send({ type: "delta", text: rest });
        }
        send({ type: "done", reply: reply.trim() });
      } catch (error) {
        if (!signal?.aborted) send({ type: "error", error: error instanceof Error ? error.message : "对话失败" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
