import type { ModelFileConfig, RuleGroupPrompts } from "@/domain/entities";
import type { MeegleAnalyzeResponse } from "@/domain/meegle/contracts";
import { HttpError } from "@/server/http/route";
import { fetchMeegleHandoverAt } from "@/server/handover/handover";
import { listMeegleComments, type MeegleComment } from "@/server/meegle/cli";
import { mergeMeegleAttachments, normalizeMeegleCommentAttachments } from "@/server/meegle/comment-attachments";
import { meegleDefaultProjectKey } from "@/server/meegle/config";
import { fetchMeeglePluginAttachments } from "@/server/meegle/plugin-attachments";
import { meeglePipelineIssueKey, type IssueAttachment } from "@/server/meegle/types";

export interface MeegleAnalyzeRequest {
  workItemId: string;
  workItemName: string;
  description?: string;
  projectName?: string;
  stateName?: string;
  /** 规则组配置（前端选择规则组后透传） */
  prompts?: Partial<RuleGroupPrompts>;
  basePaths?: { json_dir: string; dbc_dir: string; proto_dir: string };
  modelToFiles?: Record<string, ModelFileConfig>;
  ruleGroupId?: string;
  ruleGroupName?: string;
  runId?: string;
  projectKey?: string;
  workItemTypeKey?: string;
  /** /api/meegle/context 返回的完整上下文；缺省时由本接口补抓评论与附件（兼容旧调用方） */
  rawData?: Record<string, unknown>;
}

interface ForwardContext {
  /** 调用本服务 /api/issues/process 的源地址 */
  origin: string;
  cookie: string;
}

type CommentLike = { author: string; body: string; created: string };

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** 由请求头推断内部转发地址 */
export function internalOrigin(headers: Headers): string {
  const proto = headers.get("x-forwarded-proto");
  const host = headers.get("host");
  return proto && host ? `${proto}://${host}` : `http://localhost:${process.env.PORT || 3000}`;
}

/** 无 rawData 的旧调用方：补抓评论、评论附件与插件附件 */
async function legacyContext(projectKey: string, workItemTypeKey: string, workItemId: string) {
  let comments: MeegleComment[] = [];
  try {
    comments = await listMeegleComments(projectKey, workItemId);
  } catch {
    // 评论读取失败时继续分析
  }
  let attachments: IssueAttachment[] = normalizeMeegleCommentAttachments(comments);
  try {
    const pluginAttachments = await fetchMeeglePluginAttachments({ projectKey, workItemTypeKey, workItemId });
    attachments = mergeMeegleAttachments(attachments, pluginAttachments);
  } catch (error) {
    console.warn(`[Meegle] 附件插件读取失败，继续使用评论附件: ${String(error)}`);
  }
  const jiraComments: CommentLike[] = comments.map((comment) => ({
    author: comment.creator,
    body: stripHtml(comment.content),
    created: comment.created_at,
  }));
  return { comments: jiraComments, attachments };
}

/**
 * 飞书工单分析：组装与 Jira 一致的 rawData 后转交完整处理流水线（/api/issues/process），
 * 再补充经办人接手时间。返回体与旧版 /api/meegle/analyze 一致。
 */
export async function analyzeMeegleWorkItem(
  body: MeegleAnalyzeRequest,
  forward: ForwardContext,
): Promise<MeegleAnalyzeResponse & { conclusion: string }> {
  const { workItemId, workItemName, description, projectName, stateName, prompts, basePaths, modelToFiles, ruleGroupId, ruleGroupName, runId } = body;
  const projectKey = body.projectKey || meegleDefaultProjectKey();
  const workItemTypeKey = body.workItemTypeKey || "issue";

  const context = body.rawData
    ? {
      comments: (body.rawData.comments as CommentLike[] | undefined) ?? [],
      attachments: [...((body.rawData.attachments as IssueAttachment[] | undefined) ?? [])],
    }
    : await legacyContext(projectKey, workItemTypeKey, workItemId);

  const processBody = {
    issueKey: meeglePipelineIssueKey(workItemId),
    summary: workItemName,
    rawData: {
      ...body.rawData,
      source: "meegle",
      projectKey,
      workItemTypeKey,
      workItemId,
      description: body.rawData?.description ?? stripHtml(description || ""),
      comments: context.comments,
      attachments: context.attachments,
      status: stateName || "",
      project: projectName,
    },
    prompts: prompts || {},
    basePaths: basePaths || undefined,
    modelToFiles: modelToFiles || undefined,
    ruleGroupId: ruleGroupId || "meegle",
    ruleGroupName: ruleGroupName || projectName || "meegle",
    source: "meegle" as const,
    runId,
  };

  const processResponse = await fetch(`${forward.origin}/api/issues/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: forward.cookie },
    body: JSON.stringify(processBody),
  });
  const result = await processResponse.json() as Partial<MeegleAnalyzeResponse> & Record<string, unknown>;
  if (!processResponse.ok) {
    const { error, ...extra } = result;
    throw new HttpError(processResponse.status, typeof error === "string" && error ? error : "飞书工单分析失败", extra);
  }

  const handoverAt = await fetchMeegleHandoverAt(projectKey, String(workItemId));
  return {
    handoverAt: handoverAt?.toISOString(),
    replyText: result.replyText || "",
    conclusion: result.replyText || "",
    model: result.model || "",
    workItemId,
    stages: result.stages || {},
    mode: result.mode || "no_attachments",
    elapsedMs: result.elapsedMs || 0,
    chartImage: result.chartImage,
    signalSummary: result.signalSummary,
    traceData: result.traceData,
    ticks: result.ticks,
    artifactRef: result.artifactRef,
    analysisReceipt: result.analysisReceipt,
    tokenUsage: result.tokenUsage,
  };
}
