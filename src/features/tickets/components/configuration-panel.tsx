import type { ConfigurationResolution } from "@/domain/analysis/effective-configuration";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
export function ConfigurationPanel({ resolution }: {
    resolution?: ConfigurationResolution;
}) {
    if (!resolution)
        return null;
    return <Card className="mt-4"><CardHeader><CardTitle>本次基础配置</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
 <p>{resolution.mode === "auto" ? "日志自动匹配 · 分支当前配置" : "用户默认配置 · 自动匹配后回退"}</p>
 <p className="break-words text-muted-foreground">{resolution.reason}</p>
 <dl className="grid gap-2 sm:grid-cols-3"><div><dt className="text-muted-foreground">实际配置车型</dt><dd>{resolution.actual.carModel || "未识别，沿用原有分析能力"}</dd></div><div><dt className="text-muted-foreground">项目 / 分支组</dt><dd>{resolution.actual.projectName ? `${resolution.actual.projectName} / ${resolution.actual.branchGroupName}` : "用户配置"}</dd></div><div><dt className="text-muted-foreground">版本口径</dt><dd>{resolution.mode === "auto" ? "分支当前配置；历史整套配套未验证" : "用户默认配置快照"}</dd></div></dl>
 <details><summary className="cursor-pointer text-primary">查看配置来源与回退证据</summary><pre className="mt-3 whitespace-pre-wrap break-all font-sans text-xs leading-6">{resolution.summary}</pre><details className="mt-3"><summary className="cursor-pointer">完整匹配记录</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ ...resolution, summary: undefined }, null, 2)}</pre></details></details>
 </CardContent></Card>;
}
