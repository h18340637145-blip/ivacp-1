"use client";
import { useState } from "react";
import { apiFetch } from "@/shared/lib/api";
import { useAction } from "@/shared/hooks/use-action";
import { Button, EmptyState, Select } from "@/shared/ui";

export function ArtifactsPanel({ artifactRef }: { artifactRef?: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [file, setFile] = useState<string>();
  const [content, setContent] = useState("");
  const [truncated, setTruncated] = useState(false);
  const load = useAction(async () => { setFiles((await apiFetch<{ files: string[] }>(`/api/meegle/artifacts?${new URLSearchParams({ artifactRef: artifactRef! })}`)).files); });
  const read = useAction(async (name: string) => {
    setFile(name);
    const data = await apiFetch<{ content: string; truncated: boolean }>(`/api/meegle/artifacts?${new URLSearchParams({ artifactRef: artifactRef!, file: name })}`);
    setContent(data.content); setTruncated(data.truncated);
  });
  if (!artifactRef) return <EmptyState title="暂无可读取的过程产物" description="此结果未保存签名运行引用，已持久化结论仍可查看。" />;
  return <div className="space-y-4"><Button variant="outline" loading={load.pending} onClick={() => void load()}>读取过程文件列表</Button>{files.length ? <Select aria-label="过程文件" value={file} onValueChange={(name) => void read(name)} disabled={read.pending} options={files.map((name) => ({ value: name, label: name }))} /> : null}{truncated ? <p className="text-xs text-warning">文件较大，仅展示前 512 KB。</p> : null}<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-4 font-mono text-xs">{content || "选择文件后查看分析步骤、证据与终端日志。"}</pre></div>;
}
