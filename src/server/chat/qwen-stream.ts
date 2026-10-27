import http from "node:http";
import { callQwen, invalidateQwenHostCache, resolveQwenHost, type QwenMessage } from "@/server/ai/qwen";
import { createSseDecoder } from "./stream-text";

const COMPLETIONS_PATH = "/llm/model/v1/chat/completions";

function qwenConfig() {
  const baseUrl = process.env.BASE_URL ?? "";
  const apiKey = process.env.QWEN_API_KEY ?? "";
  const model = process.env.QWEN_MODEL ?? "Qwen3-32B-FP16";
  if (!baseUrl || !apiKey) throw new Error("Qwen 环境变量未配置（BASE_URL / QWEN_API_KEY）");
  const url = new URL(baseUrl);
  return { hostname: url.hostname, port: Number(url.port) || 80, apiKey, model };
}

function openStream(messages: QwenMessage[], signal?: AbortSignal): Promise<http.IncomingMessage> {
  const { hostname, port, apiKey, model } = qwenConfig();
  const body = Buffer.from(JSON.stringify({ model, messages, stream: true }), "utf-8");
  return resolveQwenHost(hostname).then(
    (ip) =>
      new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          {
            hostname: ip,
            port,
            path: COMPLETIONS_PATH,
            method: "POST",
            agent: new http.Agent({ keepAlive: false }),
            signal,
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              Authorization: `Bearer ${apiKey}`,
              "Content-Length": body.byteLength,
            },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) {
              resolve(res);
              return;
            }
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => reject(new Error(`Qwen HTTP ${status}: ${Buffer.concat(chunks).toString("utf-8").slice(0, 300)}`)));
          },
        );
        req.on("error", (error) => {
          invalidateQwenHostCache(hostname);
          reject(error);
        });
        req.setTimeout(300_000, () => req.destroy(new Error("Qwen API 超时（300s）")));
        req.end(body);
      }),
  );
}

/**
 * 流式调用 Qwen（stream: true），逐片产出原始文本（含可能的 <think> 片段）。
 * 建立流失败且尚未产出内容时回退到非流式 callQwen，整段产出一次。
 */
export async function* streamQwen(messages: QwenMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  let response: http.IncomingMessage;
  try {
    response = await openStream(messages, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[chat] Qwen 流式请求失败，回退为非流式：", error instanceof Error ? error.message : error);
    yield await callQwen(messages);
    return;
  }
  const decoder = createSseDecoder();
  // 多字节字符可能跨分片，用流式 TextDecoder 解码
  const utf8 = new TextDecoder();
  for await (const chunk of response as AsyncIterable<Buffer>) {
    for (const event of decoder.push(utf8.decode(chunk, { stream: true }))) {
      if (event.done) return;
      yield event.text;
    }
  }
  for (const event of decoder.flush()) {
    if (event.done) return;
    yield event.text;
  }
}
