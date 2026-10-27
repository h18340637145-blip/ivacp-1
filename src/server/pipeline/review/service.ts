import fs from "node:fs/promises";
import path from "node:path";
import { chat, runQwenRequest } from "@/server/ai/qwen";
import { resolveArtifactRef } from "@/server/artifacts/analysis-artifacts";
import { badRequest } from "@/server/http/route";
import { parseReviewVerdict, type ReviewVerdict } from "./verdict";

interface ReviewAnalysisContext {
  issueDescription?: string;
  commentsText?: string;
  rawDataText?: string;
  signalSummary?: string;
}

export interface ReviewRequest {
  /** The AI-generated conclusion to review */
  conclusion: string;
  /** Original issue summary for context */
  issueSummary: string;
  /** Issue key for logging */
  issueKey: string;
  /** Rule group id for locating persisted analysis logs */
  ruleGroupId?: string;
  /** Human readable rule group name used by the process pipeline log path */
  ruleGroupName?: string;
  /** Full analysis inputs/results available on the client side */
  analysisContext?: ReviewAnalysisContext;
  /** Few-shot samples: past wrong conclusions with corrections */
  samples?: Array<{
    wrongConclusion: string;
    correctConclusion: string;
    errorReason: string;
  }>;
  artifactRef?: string;
}


const REVIEW_SYSTEM_PROMPT = `你是一个 Jira 车控问题分析结论的质量审核员。
你的任务是判断 AI 生成的分析结论是否正确、合理、完整。

评判标准：
1. 结论是否准确反映了问题的根因
2. 信号分析是否与 CAN trace 数据一致
3. 转单建议是否合理（指向正确的模块/团队）
4. 结论是否存在逻辑错误或自相矛盾

请以 JSON 格式回复：
{ "verdict": "PASS" 或 "FAIL", "reason": "判定理由" }

仅返回 JSON，不要额外文字。`;

const LOG_BASE = path.join(process.cwd(), "log");
const REVIEW_LOG_FILES = [
  "evidence-packet.json",
  "can_signal_summary.txt",
  "input_comments.txt",
  "step1_requirements.md",
  "step2_signals.md",
  "signals.json",
  "signals_id.json",
  "step3_upper_summary.md",
  "step4_android_qnx_input.md",
  "step4_android_qnx.md",
  "extract.md",
  "final_reply.md",
  "pipeline.log",
];

function sanitizeName(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80);
}

async function findAnalysisLogDir(req: ReviewRequest): Promise<string | null> {
  if (req.issueKey.startsWith("meegle-") && !req.artifactRef) throw badRequest("飞书复核必须指定当前分析运行的 artifactRef");
  if (req.artifactRef) {
    if (!req.issueKey.startsWith("meegle-")) throw badRequest("只有飞书复核支持 artifactRef");
    let resolved: ReturnType<typeof resolveArtifactRef>;
    try { resolved = resolveArtifactRef(req.artifactRef); }
    catch { throw badRequest("分析产物引用无效"); }
    if (resolved.identity.issueKey !== sanitizeName(req.issueKey)) throw badRequest("分析产物与工单不匹配");
    return resolved.directory;
  }
  const groupCandidates = [req.ruleGroupName, req.ruleGroupId]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => sanitizeName(value));

  for (const groupDir of [...new Set(groupCandidates)]) {
    const groupPath = path.join(LOG_BASE, groupDir);
    let carModelEntries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      carModelEntries = await fs.readdir(groupPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of carModelEntries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(groupPath, entry.name, sanitizeName(req.issueKey));
      try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) return candidate;
      } catch {
        // Try next model directory.
      }
    }
  }

  return null;
}

async function loadReviewAnalysisContext(req: ReviewRequest): Promise<string> {
  const logDir = await findAnalysisLogDir(req);
  if (!logDir) return "";

  const sections: string[] = [];
  for (const fileName of REVIEW_LOG_FILES) {
    try {
      const content = await fs.readFile(path.join(logDir, fileName), "utf-8");
      if (content.trim()) {
        sections.push(`### ${fileName}\n${content.slice(0, 30_000)}`);
      }
    } catch {
      // Not every issue has every stage file.
    }
  }

  return sections.join("\n\n");
}

function buildUserPrompt(req: ReviewRequest, analysisLogContext = ""): string {
  const parts: string[] = [];

  // Add Few-shot examples if available
  const samples = req.samples ?? [];
  if (samples.length > 0) {
    parts.push("以下是历史错误案例供参考：");
    for (const [i, s] of samples.slice(0, 20).entries()) {
      parts.push(`\n--- 错误案例 ${i + 1} ---`);
      parts.push(`错误结论：${s.wrongConclusion.slice(0, 500)}`);
      parts.push(`错误原因：${s.errorReason}`);
      parts.push(`正确结论：${s.correctConclusion.slice(0, 500)}`);
    }
    parts.push("\n---\n");
  }

  parts.push(`现在请审核以下结论：`);
  parts.push(`\n问题标题：${req.issueSummary}`);

  if (req.analysisContext) {
    const context = req.analysisContext;
    const contextParts = [
      context.issueDescription ? `<问题描述>\n${context.issueDescription}\n</问题描述>` : "",
      context.commentsText ? `<评论全文>\n${context.commentsText}\n</评论全文>` : "",
      context.signalSummary ? `<CAN Trace信号摘要>\n${context.signalSummary}\n</CAN Trace信号摘要>` : "",
      context.rawDataText ? `<Jira快照原始数据>\n${context.rawDataText}\n</Jira快照原始数据>` : "",
    ].filter(Boolean);
    if (contextParts.length > 0) {
      parts.push("\n<分析过程上下文>");
      parts.push(contextParts.join("\n\n"));
      parts.push("</分析过程上下文>");
    }
  }

  if (analysisLogContext.trim()) {
    parts.push(`\n<服务端分析日志>\n${analysisLogContext}\n</服务端分析日志>`);
  }

  parts.push(`\nAI 分析结论：\n${req.conclusion}`);

  return parts.join("\n");
}


export async function reviewConclusion(body: ReviewRequest, signal?: AbortSignal): Promise<ReviewVerdict> {
  const model = process.env.VALIDATE_QWEN_MODEL ?? process.env.QWEN_MODEL;
  const apiKey = process.env.VALIDATE_API_KEY ?? process.env.QWEN_API_KEY;
  if (!model || !apiKey) throw new Error("验证模型环境变量未配置（VALIDATE_QWEN_MODEL / VALIDATE_API_KEY）");
  signal?.throwIfAborted();
  const context = await loadReviewAnalysisContext(body);
  return runQwenRequest(async () => parseReviewVerdict(await chat(REVIEW_SYSTEM_PROMPT, buildUserPrompt(body, context), { model, apiKey })), signal);
}
