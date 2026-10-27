import { db } from "@/shared/db/database";
import type { KnowledgeDoc, ReviewStatus, TicketSource } from "@/domain/entities";
import { chunkText } from "@/domain/knowledge/retrieval";
import { embedTexts } from "./embed";

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: "待人工复核",
  approved: "人工确认通过",
  rejected: "人工驳回（已纠错）",
};
const SOURCE_LABEL: Record<TicketSource, string> = { jira: "Jira票", meegle: "飞书项目" };
const SOURCE_TEXT: Record<TicketSource, string> = { jira: "Jira 票", meegle: "飞书项目工作项" };

const fmt = (d?: Date | string) => (d ? new Date(d).toLocaleString("zh-CN") : "");
const line = (k: string, v?: string | number | string[]) => {
  const t = Array.isArray(v) ? v.join("、") : v;
  return t === undefined || t === "" ? "" : `${k}：${t}\n`;
};

export interface ImportSummary {
  total: number;
  jira: number;
  meegle: number;
  samples: number;
  histories: number;
  withVectors: boolean;
}

interface Draft {
  id: string;
  name: string;
  text: string;
}

async function collect(userId: string) {
  const [results, samples, histories] = await Promise.all([
    db.processResults.toArray(),
    db.reviewSamples.toArray(),
    db.analysisHistories.toArray(),
  ]);
  const drafts: Draft[] = [];

  for (const r of results) {
    const ev = r.reviewEvidence;
    const aiReview =
      r.source === "meegle" && r.aiReviewVerdict && r.aiReviewVerdict !== "unknown"
        ? `${r.aiReviewVerdict} ${r.aiReviewReason ?? ""}`
        : "";
    drafts.push({
      id: `import:${userId}:${r.source}:${r.id}`,
      name: `[${SOURCE_LABEL[r.source]}] ${r.ticketKey}`,
      text:
        `${SOURCE_TEXT[r.source]} ${r.ticketKey} 的 AI 分析结果\n` +
        line("复核状态", REVIEW_LABEL[r.reviewStatus]) +
        line("AI 结论时间", r.aiConclusionTime) +
        line("AI 复核", aiReview) +
        line("车型", ev?.carModel) +
        line("信号", ev?.signalTokens) +
        line("属性", ev?.props) +
        line("信号摘要", r.signalSummary) +
        `\nAI 结论：\n${r.replyText}\n` +
        (r.manualCorrectResult ? `\n人工正确结论：\n${r.manualCorrectResult}\n` : "") +
        (r.errorReason ? `\n人工驳回原因：\n${r.errorReason}\n` : "") +
        line("处理时间", fmt(r.createdAt)),
    });
  }

  for (const h of histories) {
    drafts.push({
      id: `import:${userId}:history:${h.id}`,
      name: `[历史·${SOURCE_LABEL[h.source]}] ${h.ticketKey}`,
      text:
        `${SOURCE_TEXT[h.source]} ${h.ticketKey} 的历史 AI 分析结果（已被重新分析归档）\n` +
        line("复核状态", REVIEW_LABEL[h.reviewStatus]) +
        line("AI 结论时间", h.aiConclusionTime) +
        `\nAI 结论：\n${h.replyText}\n` +
        (h.manualCorrectResult ? `\n人工正确结论：\n${h.manualCorrectResult}\n` : "") +
        (h.errorReason ? `\n人工驳回原因：\n${h.errorReason}\n` : "") +
        line("处理时间", fmt(h.resultCreatedAt)) +
        line("归档时间", fmt(h.archivedAt)),
    });
  }

  for (const s of samples) {
    const positive = s.sampleKind === "approved";
    drafts.push({
      id: `import:${userId}:sample:${s.id}`,
      name: `[人工标注${positive ? "·正确" : "·纠错"}] ${s.ticketKey}`,
      text:
        `人工标注样本 ${s.ticketKey}（${positive ? "AI 结论经人工确认正确" : "AI 结论被人工纠正"}）\n` +
        line("来源", SOURCE_LABEL[s.source]) +
        line("标题", s.issueSummary) +
        line("车型", s.carModel) +
        line("信号", s.signalTokens) +
        line("属性", s.props) +
        line("属性 ID", s.propertyIds) +
        (positive
          ? `\n确认正确的结论：\n${s.approvedConclusion ?? s.correctConclusion}\n`
          : `\n原 AI 错误结论：\n${s.wrongConclusion}\n\n人工正确结论：\n${s.correctConclusion}\n\n错误原因：\n${s.errorReason}\n`) +
        line("标注时间", fmt(s.createdAt)),
    });
  }

  return {
    drafts,
    jira: results.filter((r) => r.source === "jira").length,
    meegle: results.filter((r) => r.source === "meegle").length,
    samples: samples.length,
    histories: histories.length,
  };
}

/**
 * 把本浏览器 IndexedDB 中的已处理票（Jira + 飞书）、历史分析与人工标注导入当前用户知识库；
 * 按 id 覆盖，可重复执行。
 */
export async function importProcessedHistory(
  userId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  const { drafts, ...counts } = await collect(userId);
  let withVectors = true;
  let done = 0;
  onProgress?.(0, drafts.length);
  for (let i = 0; i < drafts.length; i += 5) {
    const batch = drafts.slice(i, i + 5).map((d) => ({ d, pieces: chunkText(d.text) }));
    const all = batch.flatMap((b) => b.pieces);
    const vectors = all.length ? await embedTexts(all) : [];
    if (!vectors) withVectors = false;
    let offset = 0;
    const docs: KnowledgeDoc[] = batch.map(({ d, pieces }) => {
      const chunks = pieces.map((text, k) => ({ text, embedding: vectors?.[offset + k] }));
      offset += pieces.length;
      return { id: d.id, userId, source: "import", name: d.name, size: d.text.length, chunks, createdAt: new Date().toISOString() };
    });
    await db.knowledgeDocs.bulkPut(docs.filter((x) => x.chunks.length));
    done += batch.length;
    onProgress?.(done, drafts.length);
  }
  return { ...counts, total: drafts.length, withVectors };
}
