import type { FewShotRetrievalAudit } from "@/domain/analysis/process-contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";

const modeLabel = { pool: "证据后在快照内再次召回", fallback: "无快照，仅对初次入选案例重排" };

/** P2：证据后再次召回审计（docs/requirements/issue-rag-optimization.md 第 7.3 节） */
export function FewShotRetrievalPanel({ audit }: { audit?: FewShotRetrievalAudit }) {
  if (!audit) return null;
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>历史案例召回审计</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-2 sm:grid-cols-3">
          <div><dt className="text-muted-foreground">策略</dt><dd>{modeLabel[audit.mode]}（{audit.strategyVersion}）</dd></div>
          <div><dt className="text-muted-foreground">候选数</dt><dd>{audit.candidateCount}</dd></div>
          <div><dt className="text-muted-foreground">快照覆盖</dt><dd>{audit.poolMeta ? `${audit.poolMeta.sent} / ${audit.poolMeta.eligible}${audit.poolMeta.truncated ? "（已截断）" : ""}` : "无快照"}</dd></div>
        </dl>
        {audit.degradations.length ? <ul className="list-disc space-y-1 break-words pl-5 text-muted-foreground">{audit.degradations.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
        {audit.selected.length ? (
          <div className="space-y-1">
            <p className="text-muted-foreground">注入案例（命中路径与分数，不代表最终结论来自该票）</p>
            <ul className="space-y-1">
              {audit.selected.map((item, index) => (
                <li key={`${item.ticketKey}:${item.sampleKind}:${index}`} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.ticketKey}</span>
                  <span className="text-muted-foreground">{item.sampleKind === "approved" ? "人工确认" : "纠错"} · {item.routes.join("+") || "重排"} · 召回 {item.recallScore} · 最终 {item.finalScore}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="text-muted-foreground">本次未注入历史案例。</p>}
        <details>
          <summary className="cursor-pointer text-primary">排除统计与原始审计</summary>
          <dl className="mt-2 grid gap-2 sm:grid-cols-3 text-xs text-muted-foreground">
            <div><dt>自身票排除</dt><dd>{audit.excluded.self}</dd></div>
            <div><dt>场景不符排除</dt><dd>{audit.excluded.scene}</dd></div>
            <div><dt>去重排除</dt><dd>{audit.excluded.duplicate}</dd></div>
          </dl>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(audit, null, 2)}</pre>
        </details>
      </CardContent>
    </Card>
  );
}
