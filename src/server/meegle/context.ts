import type { MeegleContextRequest, MeegleContextResponse } from "@/domain/meegle/contracts";
import { getMeegleWorkItem, listMeegleComments } from "@/server/meegle/cli";
import { mergeMeegleAttachments, normalizeMeegleCommentAttachments } from "@/server/meegle/comment-attachments";
import { fetchMeeglePluginAttachments } from "@/server/meegle/plugin-attachments";

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readField(data: Record<string, unknown>, key: string): unknown {
  const fields = Array.isArray(data.work_item_fields) ? data.work_item_fields : [];
  return (fields as Array<{ key?: string; value?: unknown }>).find((field) => field.key === key)?.value;
}

/** 抓取飞书工单完整上下文（详情、评论、评论附件 + 附件插件），作为处理快照 rawData */
export async function fetchMeegleContext({ projectKey, workItemTypeKey, workItemId }: MeegleContextRequest): Promise<MeegleContextResponse> {
  const [detail, comments] = await Promise.all([
    getMeegleWorkItem(projectKey, workItemId),
    listMeegleComments(projectKey, workItemId),
  ]);
  const commentAttachments = normalizeMeegleCommentAttachments(comments);
  const pluginAttachments = await fetchMeeglePluginAttachments({ projectKey, workItemTypeKey, workItemId })
    .catch((error) => {
      console.warn(`[Meegle] 附件插件读取失败，继续使用评论内容: ${String(error)}`);
      return [];
    });
  const attributes = (detail.work_item_attribute ?? {}) as Record<string, unknown>;
  const descriptionValue = readField(detail, "description");

  return {
    rawData: {
      source: "meegle",
      projectKey,
      workItemTypeKey,
      workItemId,
      description: stripHtml(typeof descriptionValue === "string" ? descriptionValue : ""),
      descriptionRich: typeof descriptionValue === "string" ? descriptionValue : "",
      priority: readField(detail, "priority") ?? null,
      detail: attributes,
      comments: comments.map((comment) => ({
        id: comment.comment_id,
        author: comment.creator,
        body: stripHtml(comment.content),
        richBody: comment.content,
        created: comment.created_at,
      })),
      attachments: mergeMeegleAttachments(commentAttachments, pluginAttachments),
    },
  };
}
