/**
 * Qwen AI client for Next.js API routes.
 * Uses node:http directly (no proxy — Qwen is on 10.x.x.x internal network).
 * Resolves hostname to IP first to bypass slow DNS-inside-http.request in WSL.
 */
import http from "node:http";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";

const BASE_URL = process.env.BASE_URL ?? "";
const API_KEY = process.env.QWEN_API_KEY ?? "";
const MODEL = process.env.QWEN_MODEL ?? "Qwen3-32B-FP16";
const execFileAsync = promisify(execFile);
const IPV4_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;

/**
 * Rough token count: ~1.5 chars per token for mixed Chinese/English.
 * This is intentionally conservative (may over-estimate) to stay safe.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}

const tokenUsageStorage = new AsyncLocalStorage<{ totalTokens: number }>();

/** 为当前异步调用链开始累计 Qwen token 用量（每个请求调用一次） */
export function startQwenTokenUsage(): void {
  tokenUsageStorage.enterWith({ totalTokens: 0 });
}

/** 当前调用链已累计的 token 数；未开始累计或为 0 时返回 undefined */
export function currentQwenTokenUsage(): number | undefined {
  const total = tokenUsageStorage.getStore()?.totalTokens ?? 0;
  return total > 0 ? total : undefined;
}

/** Resolve hostname once and cache the IP to avoid repeated DNS lookups; invalidated on connection failure so a stale IP doesn't stick for the process lifetime. */
let _cachedIp: string | null = null;
let _cachedHostname: string | null = null;
let _lastInvalidatedAt = 0;

export function invalidateQwenHostCache(hostname?: string): void {
  if (!hostname || _cachedHostname === hostname) {
    _cachedIp = null;
    _cachedHostname = null;
    _lastInvalidatedAt = Date.now();
  }
}

async function resolveIpWithWindows(hostname: string): Promise<string | null> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[System.Net.Dns]::GetHostAddresses($env:QWEN_DNS_HOSTNAME) | ForEach-Object { $_.IPAddressToString }",
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      env: { ...process.env, QWEN_DNS_HOSTNAME: hostname },
    },
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => IPV4_PATTERN.test(line)) ?? null;
}

export async function resolveQwenHost(
  hostname: string,
  dependencies: {
    lookup?: (hostname: string) => Promise<{ address: string }>;
    windowsLookup?: (hostname: string) => Promise<string | null>;
  } = {},
): Promise<string> {
  if (IPV4_PATTERN.test(hostname)) return hostname;
  if (_cachedIp && _cachedHostname === hostname) return _cachedIp;

  // If we just invalidated due to a connection error, flush Windows' own DNS
  // cache too — otherwise the PowerShell lookup below can keep returning the
  // stale address it had cached before the server's IP changed.
  if (Date.now() - _lastInvalidatedAt < 10_000) {
    try {
      await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "ipconfig /flushdns | Out-Null"], { timeout: 5_000 });
    } catch { /* best-effort */ }
  }

  const lookup = dependencies.lookup ?? ((value: string) => dns.lookup(value));
  const windowsLookup = dependencies.windowsLookup ?? resolveIpWithWindows;
  try {
    const { address } = await lookup(hostname);
    _cachedIp = address;
    _cachedHostname = hostname;
    return address;
  } catch (linuxDnsError) {
    try {
      const address = await windowsLookup(hostname);
      if (address) {
        _cachedIp = address;
        _cachedHostname = hostname;
        console.warn(`[Qwen] WSL DNS 解析失败，已通过 Windows DNS 解析 ${hostname}`);
        return address;
      }
    } catch {
      // Preserve the original DNS error so retry classification sees EAI_AGAIN.
    }
    throw linuxDnsError;
  }
}

function isConnectionQwenError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  return new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]).has(code);
}

export function isRetryableQwenError(error: unknown): boolean {
  const retryableCodes = new Set([
    "EAI_AGAIN",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENETUNREACH",
  ]);
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return retryableCodes.has(code)
    || message.includes("Qwen API 超时")
    || message.includes("Qwen HTTP 5")
    || [...retryableCodes].some((retryableCode) => message.includes(retryableCode));
}

function httpPost(
  ip: string,
  port: number,
  path: string,
  headers: Record<string, string>,
  bodyBuf: Buffer
): Promise<{ statusCode: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: ip,
        port,
        path,
        method: "POST",
        agent: new http.Agent({ keepAlive: false }),
        headers: { ...headers, "Content-Length": bodyBuf.byteLength },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ statusCode: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf-8") })
        );
      }
    );
    req.on("error", reject);
    // 5 minutes timeout — large prompts with thinking can take 2-3 min
    req.setTimeout(300_000, () => req.destroy(new Error("Qwen API 超时（300s）")));
    req.write(bodyBuf);
    req.end();
  });
}

export interface QwenMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

export async function callQwen(
  messages: QwenMessage[],
  options?: { maxTokens?: number; temperature?: number; model?: string; apiKey?: string }
): Promise<string> {
  const model = options?.model ?? MODEL;
  const apiKey = options?.apiKey ?? API_KEY;
  if (!BASE_URL || !apiKey) throw new Error("Qwen 环境变量未配置（BASE_URL / QWEN_API_KEY）");

  const parsed = new URL(BASE_URL);
  const port = Number(parsed.port) || 80;

  // Log payload size for debugging (mirrors Python _post)
  const msgs: QwenMessage[] = messages.map((m) => ({ ...m }));
  const estimatedInput = estimateTokens(
    msgs.map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((item) => (item.type === "text" ? item.text : ""))
          .join(" ");
      }
      return "";
    }).join(" ")
  );
  console.debug(`[Qwen] estimated_input_tokens=${estimatedInput}`);

  // Build payload exactly like the Python version:
  // - No max_tokens by default (let the server decide)
  // - No temperature unless explicitly set
  // - stream: false
  const payload: Record<string, unknown> = {
    model,
    messages: msgs,
    stream: false,
  };

  // Only attach max_tokens when the caller explicitly requests it
  // AND it won't push us over the context limit
  if (options?.maxTokens !== undefined) {
    payload.max_tokens = options.maxTokens;
  }

  if (options?.temperature !== undefined) {
    payload.temperature = options.temperature;
  }

  const body = JSON.stringify(payload);
  const bodyBuf = Buffer.from(body, "utf-8");
  console.debug(`[Qwen] payload size = ${bodyBuf.byteLength} bytes`);

  const reqHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // Retry with exponential backoff (mirrors Python _post)
  const MAX_RETRIES = 3;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ip = await resolveQwenHost(parsed.hostname);
      const { statusCode, text } = await httpPost(ip, port, "/llm/model/v1/chat/completions", reqHeaders, bodyBuf);

      if (statusCode < 200 || statusCode >= 300) {
        let msg = text.slice(0, 300);
        try {
          const p = JSON.parse(text) as { msg?: string; code?: string; error?: { message?: string } };
          if (p.error?.message) msg = p.error.message;
          else if (p.msg) msg = `${p.code ?? ""} ${p.msg}`.trim();
        } catch { /* ignore */ }
        // 4xx errors are not retryable (bad request, auth, etc.)
        if (statusCode >= 400 && statusCode < 500) {
          throw new Error(`Qwen HTTP ${statusCode}: ${msg}`);
        }
        // 5xx: retryable
        throw new Error(`Qwen HTTP ${statusCode}: ${msg}`);
      }

      const data = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      if (data.error) throw new Error(`Qwen error: ${data.error.message}`);
      const counter = tokenUsageStorage.getStore();
      if (counter) {
        const usage = data.usage;
        const reported = usage?.total_tokens ?? ((usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0));
        // 服务端未返回 usage 时退回字符估算
        counter.totalTokens += reported > 0
          ? reported
          : estimatedInput + estimateTokens(data.choices?.[0]?.message?.content ?? "");
      }
      return data.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));

      if (isRetryableQwenError(lastErr) && attempt < MAX_RETRIES) {
        if (isConnectionQwenError(lastErr)) invalidateQwenHostCache(parsed.hostname);
        const wait = Math.min(2 ** attempt, 8);
        console.warn(`[Qwen] 请求失败(${lastErr.message.slice(0, 60)}) 第${attempt}/${MAX_RETRIES}次，${wait}s后重试…`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr!;
}

/** Convenience: single system + user turn */
export async function chat(
  systemPrompt: string,
  userContent: string,
  options?: { maxTokens?: number; temperature?: number; model?: string; apiKey?: string }
): Promise<string> {
  return callQwen(
    [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
    options
  );
}

export async function recognizeImageText(
  imagePath: string,
  mimeType: string,
  options?: { model?: string; apiKey?: string }
): Promise<string> {
  const model = options?.model ?? process.env.IMAGE_MODEL ?? "Qwen3-VL-8B";
  const apiKey = options?.apiKey ?? API_KEY;

  // 1. Read file and convert to base64
  const data = await fs.readFile(imagePath);
  const base64 = data.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  // 2. Build multi-modal Qwen message payload
  const messages: QwenMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "请提取并识别出这张图片/截图中的所有文本内容（如果是日志截图，请逐字还原日志；如果是表格或数据，请用清晰的文本排版格式化输出）。不需要给出任何解释、推导或前言，只输出识别提取出的文字内容。"
        },
        {
          type: "image_url",
          image_url: {
            url: dataUrl
          }
        }
      ]
    }
  ];

  return callQwen(messages, { model, apiKey });
}
