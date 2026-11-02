import { cosineSimilarity, EMBEDDING_SCORE_THRESHOLD } from "./few-shot-scoring";
import {
  FEW_SHOT_POOL_TEXT_LIMIT,
  fewShotTicketKey,
  type FewShotPoolMeta,
  type FewShotRetrievalAudit,
  type FewShotSample,
} from "./process-contracts";
import {
  RECALL_ROUTE_LIMIT,
  fuseRecallRoutes,
  recallByIdentifiers,
  recallByLexical,
  sampleQuestionText,
  type FusedCandidate,
} from "./few-shot-recall";
import { detectIssueScene, filterBySameScene } from "./issue-scene";
import type { EvidencePacket } from "./evidence-packet";
import {
  extractLegacyReviewEvidence,
  rankReviewSampleCandidates,
  reviewEvidenceFromEvidencePacket,
} from "./review-sample";

/** 证据后再次召回的策略版本，写入审计 */
export const POST_EVIDENCE_RECALL_VERSION = "p2-v1";

type PoolSample = FewShotSample & { id: string; ticketKey: string };

export type PostEvidenceRecallAudit = FewShotRetrievalAudit;

/** 证据后向量召回所需的最小向量化依赖；由服务端调用方注入真实实现，领域层不直接依赖服务端模块 */
export type FewShotEmbedFn = (texts: string[]) => Promise<{ embeddings: number[][] }>;

function limitText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.slice(0, FEW_SHOT_POOL_TEXT_LIMIT);
}

function toPoolSample(sample: FewShotSample): PoolSample {
  const ticketKey = fewShotTicketKey(sample);
  const kind = sample.sampleKind ?? "correction";
  return {
    ...sample,
    id: sample.sampleId ?? `${ticketKey}#${kind}`,
    ticketKey,
    issueSummary: limitText(sample.issueSummary) ?? "",
    approvedConclusion: limitText(sample.approvedConclusion),
    wrongConclusion: limitText(sample.wrongConclusion) ?? "",
    correctConclusion: limitText(sample.correctConclusion) ?? "",
    errorReason: limitText(sample.errorReason) ?? "",
    // 客户端分数不可信，最终排序只使用服务端召回分
    relevanceScore: 0,
  };
}

/**
 * 当前证据生成后，在请求内有界快照中再次召回，而不是只给初次入选的案例重排。
 * 快照缺失（旧客户端）时退回对初次案例按证据重排，并记录降级。
 */
export async function recallFewShotAfterEvidence(args: {
  initial: FewShotSample[] | undefined;
  pool: FewShotSample[] | undefined;
  poolMeta?: FewShotPoolMeta;
  summary: string;
  description?: string;
  /** 优先用于向量检索的证据文本；缺省时退回标题 + 描述 */
  evidenceText?: string;
  /** 当前票自身标识（含平台前缀的变体），用于排除自身答案 */
  selfKeys: string[];
  evidencePacket: EvidencePacket;
  maxSamples?: number;
  /** 服务端注入的向量化函数；未提供时跳过证据后向量召回这一路，仅记录降级原因 */
  embed?: FewShotEmbedFn;
}): Promise<{ samples: Array<FewShotSample & { ticketKey: string }>; audit: PostEvidenceRecallAudit }> {
  const maxSamples = args.maxSamples ?? 3;
  const packetEvidence = reviewEvidenceFromEvidencePacket(args.evidencePacket);
  const hinted = extractLegacyReviewEvidence([args.summary, args.description]);
  const currentEvidence = {
    carModel: packetEvidence.carModel,
    props: packetEvidence.props,
    signalTokens: [...new Set([...packetEvidence.signalTokens, ...(hinted.signalTokens ?? [])])],
    propertyIds: [...new Set([...packetEvidence.propertyIds, ...(hinted.propertyIds ?? [])])],
  };
  const degradations: string[] = [];
  const excluded = { self: 0, scene: 0, duplicate: 0 };

  const initial = (args.initial ?? []).map(toPoolSample);
  const hasPool = Boolean(args.pool?.length);
  if (!hasPool) degradations.push("请求未携带样本快照，仅对初次入选案例按当前证据重排");
  if (args.poolMeta?.truncated) degradations.push(`样本快照被截断：${args.poolMeta.sent}/${args.poolMeta.eligible}，覆盖范围不是完整样本库`);

  const selfKeys = new Set(args.selfKeys);
  const merged = new Map<string, PoolSample>();
  for (const sample of [...initial, ...(args.pool ?? []).map(toPoolSample)]) {
    if (selfKeys.has(sample.ticketKey)) { excluded.self += 1; continue; }
    if (merged.has(sample.id)) { excluded.duplicate += 1; continue; }
    merged.set(sample.id, sample);
  }
  const sceneFiltered = filterBySameScene(detectIssueScene(args.summary), Array.from(merged.values()), (sample) => sample.issueSummary);
  excluded.scene = merged.size - sceneFiltered.length;
  const candidates = sceneFiltered;
  const initialIds = new Set(initial.map((sample) => sample.id));
  const initialCandidates = candidates
    .filter((sample) => initialIds.has(sample.id))
    // 初次排序即向量 / 词法 / 标识符融合后的顺序，保留为一路
    .sort((a, b) => initial.findIndex((item) => item.id === a.id) - initial.findIndex((item) => item.id === b.id))
    .map((sample) => ({ sample, score: 1 }));

  const queryText = [args.summary, args.description].filter(Boolean).join("\n");
  const identifierRoute = recallByIdentifiers(currentEvidence, candidates);
  const lexicalRoute = recallByLexical(queryText, candidates);

  // 证据后在快照候选内重新计算向量相似度，而不是只沿用客户端初次向量召回的结果
  let vectorRoute: Array<{ sample: PoolSample; score: number }> = [];
  if (!args.embed) {
    degradations.push("未注入服务端向量化依赖，跳过证据后向量召回这一路，仅使用标识符、词法与初次结果三路");
  } else {
    try {
      const vectorQueryText = args.evidenceText || queryText;
      if (vectorQueryText.trim() && candidates.length > 0) {
        const { embeddings } = await args.embed([vectorQueryText, ...candidates.map(sampleQuestionText)]);
        const [queryVector, ...candidateVectors] = embeddings;
        vectorRoute = candidates
          .map((sample, index) => ({ sample, score: cosineSimilarity(queryVector, candidateVectors[index] ?? []) }))
          .filter((item) => item.score > EMBEDDING_SCORE_THRESHOLD)
          .sort((a, b) => b.score - a.score)
          .slice(0, RECALL_ROUTE_LIMIT);
      }
    } catch (error) {
      degradations.push(`服务端证据后向量召回不可用，仅使用标识符、词法与初次结果三路：${String(error).slice(0, 160)}`);
    }
  }

  const fused: Array<FusedCandidate<PoolSample>> = fuseRecallRoutes<PoolSample>([
    { name: "initial", candidates: initialCandidates },
    { name: "identifier", candidates: identifierRoute },
    { name: "lexical", candidates: lexicalRoute },
    { name: "vector", candidates: vectorRoute },
  ]);

  const ranked = rankReviewSampleCandidates({
    currentEvidence,
    candidates: fused.map(({ sample, score }) => ({ sample, relevanceScore: score })),
    maxSamples,
  });
  const fusedById = new Map(fused.map((item) => [item.sample.id, item]));
  const samples = ranked.map(({ sample }) => sample);
  return {
    samples,
    audit: {
      strategyVersion: POST_EVIDENCE_RECALL_VERSION,
      mode: hasPool ? "pool" : "fallback",
      poolMeta: args.poolMeta,
      candidateCount: candidates.length,
      excluded,
      routeCounts: { identifier: identifierRoute.length, lexical: lexicalRoute.length, initial: initialCandidates.length, vector: vectorRoute.length },
      degradations,
      selected: ranked.map(({ sample, score }) => ({
        ticketKey: sample.ticketKey,
        sampleKind: sample.sampleKind ?? "correction",
        routes: fusedById.get(sample.id)?.routes ?? [],
        recallScore: Number((fusedById.get(sample.id)?.score ?? 0).toFixed(4)),
        finalScore: Number(score.toFixed(4)),
      })),
    },
  };
}
