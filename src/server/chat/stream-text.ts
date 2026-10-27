/** 流式文本处理（纯函数，便于单测）：剔除 <think> 推理片段、解析 OpenAI 兼容 SSE */

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

/** text 末尾与 tag 前缀重合的最大长度（标签可能被切分在两个分片里） */
function partialTagSuffix(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n -= 1) {
    if (tag.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

/** 逐片过滤 `<think>…</think>`，并去掉回复开头的空白 */
export function createThinkFilter() {
  let buffer = "";
  let inThink = false;
  let started = false;

  const emit = (text: string) => {
    if (started) return text;
    const trimmed = text.replace(/^\s+/, "");
    if (trimmed) started = true;
    return trimmed;
  };

  return {
    push(chunk: string): string {
      buffer += chunk;
      let out = "";
      while (buffer) {
        if (inThink) {
          const end = buffer.indexOf(CLOSE_TAG);
          if (end === -1) {
            buffer = buffer.slice(buffer.length - partialTagSuffix(buffer, CLOSE_TAG));
            break;
          }
          buffer = buffer.slice(end + CLOSE_TAG.length);
          inThink = false;
        } else {
          const start = buffer.indexOf(OPEN_TAG);
          if (start === -1) {
            const hold = partialTagSuffix(buffer, OPEN_TAG);
            out += buffer.slice(0, buffer.length - hold);
            buffer = buffer.slice(buffer.length - hold);
            break;
          }
          out += buffer.slice(0, start);
          buffer = buffer.slice(start + OPEN_TAG.length);
          inThink = true;
        }
      }
      return emit(out);
    },
    flush(): string {
      const rest = inThink ? "" : buffer;
      buffer = "";
      return emit(rest);
    },
  };
}

/** 非流式回复的 think 剔除 */
export function stripThink(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export type SseEvent = { done: true } | { done: false; text: string };

/** 解析 `data: {...}` 行（OpenAI 兼容 chat/completions stream），按行缓冲 */
export function createSseDecoder() {
  let buffer = "";
  const parseLine = (line: string): SseEvent | null => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return null;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return { done: true };
    try {
      const data = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string | null } }>;
        error?: { message?: string };
      };
      if (data.error) throw new Error(`Qwen error: ${data.error.message ?? "未知错误"}`);
      const text = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? "";
      return text ? { done: false, text } : null;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Qwen error")) throw error;
      return null;
    }
  };
  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      return lines.map(parseLine).filter((event): event is SseEvent => event !== null);
    },
    flush(): SseEvent[] {
      const line = buffer;
      buffer = "";
      const event = parseLine(line);
      return event ? [event] : [];
    },
  };
}
