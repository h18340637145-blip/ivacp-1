import type { VersionVhalCheck } from "@/domain/analysis/version-vhal";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
const stateLabel = { matched: "一致，属于配合刷入", mismatched: "不一致，停止分析", unknown: "未知，提示后继续", ok: "已完成", ambiguous: "存在冲突，提示后继续", skipped: "未执行" };
export function VersionVhalPanel({ check }: {
    check?: VersionVhalCheck;
}) {
    if (!check)
        return null;
    return <Card className="mt-4"><CardHeader><CardTitle>版本与 VHAL 配置检查</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <dl className="grid gap-2 sm:grid-cols-3">
      <div><dt className="text-muted-foreground">SOC / SCC</dt><dd>{stateLabel[check.socScc.result]}</dd></div>
      <div><dt className="text-muted-foreground">问题所属 VHAL 版本</dt><dd>{check.resolution.version ?? stateLabel[check.resolution.status]}</dd></div>
      <div><dt className="text-muted-foreground">信号配置</dt><dd>{check.config.stop ? "全部缺少配置，停止分析" : stateLabel[check.config.status]}</dd></div>
    </dl>
    {check.warnings.length ? <ul className="list-disc space-y-1 break-words pl-5 text-muted-foreground">{check.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
    <details><summary className="cursor-pointer text-primary">查看检查证据与逐信号结果</summary><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs leading-6">{check.summary}</pre><details className="mt-3"><summary className="cursor-pointer">完整来源与候选记录</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ ...check, summary: undefined }, null, 2)}</pre></details></details>
  </CardContent></Card>;
}
