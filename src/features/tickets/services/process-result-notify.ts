import type { TicketSource } from "@/domain/entities";
import { apiFetch } from "@/shared/lib/api";

/** 处理结果飞书群通知（Jira 与飞书项目共用）；调用方应捕获异常，通知失败不影响主流程 */
export interface FeishuProcessResultNotification {
  source: TicketSource;
  ruleGroupName: string;
  issueKey: string;
  issueUrl?: string;
  issueSummary: string;
  issueDescription?: string;
  status: "success" | "failed";
  replyText?: string;
  failureReason?: string;
  chartImagePath?: string;
}

export async function notifyFeishuProcessResult(payload: FeishuProcessResultNotification): Promise<void> {
  await apiFetch("/api/feishu/process-result", {
    method: "POST",
    json: { ...payload, origin: window.location.origin, processedAt: new Date().toISOString() },
  });
}

/** 发送通知并吞掉异常（仅告警） */
export async function notifyFeishuProcessResultSafely(payload: FeishuProcessResultNotification): Promise<void> {
  try {
    await notifyFeishuProcessResult(payload);
  } catch (error) {
    console.warn(`[Feishu Notify] ${payload.issueKey} ${payload.status === "success" ? "成功" : "失败"}通知发送失败: ${String(error).slice(0, 200)}`);
  }
}
