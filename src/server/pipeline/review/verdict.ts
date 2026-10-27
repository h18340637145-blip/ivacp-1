import { HttpError } from "@/server/http/route";

export interface ReviewVerdict { verdict: "PASS" | "FAIL"; reason: string }

/** 缺少明确判定就是服务错误，不能默认为复核通过。 */
export function parseReviewVerdict(raw: string): ReviewVerdict {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  try {
    const parsed: unknown = JSON.parse(match?.[0] ?? "");
    if (parsed && typeof parsed === "object" && "verdict" in parsed && "reason" in parsed && (parsed.verdict === "PASS" || parsed.verdict === "FAIL") && typeof parsed.reason === "string" && parsed.reason.trim()) {
      return { verdict: parsed.verdict, reason: parsed.reason };
    }
  } catch { /* 统一返回上游格式错误 */ }
  throw new HttpError(502, "复核模型未返回有效判定，请重试");
}
