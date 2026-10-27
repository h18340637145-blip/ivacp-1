"use client";

import { useState } from "react";
import { parseRuleGroupImport } from "@/domain/rule-groups/import";
import type { RuleGroup } from "@/domain/entities";
import { errorMessage } from "@/shared/lib/errors";
import {
  Button, Callout, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, Field, Input, Select, toast,
} from "@/shared/ui";
import { useRuleGroupStore } from "../store";

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RuleGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"merge" | "overwrite">("merge");
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);

  async function selectFile(next: File | null) {
    setFile(null); setPreview(null); setError(null);
    if (!next) return;
    setReading(true);
    try {
      const rows = parseRuleGroupImport(JSON.parse(await next.text()));
      setFile(next); setPreview(rows);
    } catch (error) {
      setError(errorMessage(error));
    } finally { setReading(false); }
  }

  async function apply() {
    if (!file || pending || reading) return;
    setPending(true); setError(null);
    try {
      const result = await useRuleGroupStore.getState().importFile(file, mode);
      toast.success(`导入完成：新增 ${result.added} 个，更新 ${result.updated} 个`);
      onClose();
    } catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending && !reading) onClose(); }}>
      <DialogContent size="md" hideClose={pending || reading}>
        <DialogHeader><DialogTitle>导入规则组</DialogTitle><DialogDescription>支持旧版与新版规则组 JSON 导出文件，先预览再确认。</DialogDescription></DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="规则组文件" htmlFor="rg-import-file"><Input id="rg-import-file" type="file" accept=".json,application/json" disabled={pending || reading} onChange={(event) => void selectFile(event.target.files?.[0] ?? null)} /></Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          {preview ? <div className="space-y-2"><p className="text-sm">已校验 {preview.length} 个规则组</p><ul className="max-h-40 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">{preview.map((row) => <li key={row.id} className="break-words">{row.name}</li>)}</ul></div> : null}
          <Field label="导入方式" htmlFor="rg-import-mode">
            <Select id="rg-import-mode" value={mode} disabled={pending || reading} onValueChange={(value) => setMode(value as "merge" | "overwrite")} options={[{ value: "merge", label: "合并：相同 ID 更新配置，保留排序" }, { value: "overwrite", label: "覆盖：替换全部规则组配置" }]} />
          </Field>
          {mode === "overwrite" ? <Callout tone="warning" title="确认替换全部规则组">本浏览器现有规则组配置将被文件内容替换。已有分析结果和历史保留。请先导出备份。</Callout> : null}
        </DialogBody>
        <DialogFooter><Button variant="ghost" disabled={pending || reading} onClick={onClose}>取消</Button><Button variant={mode === "overwrite" ? "destructive" : "primary"} loading={pending || reading} disabled={!file} onClick={() => void apply()}>{mode === "overwrite" ? "确认覆盖导入" : "确认合并导入"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
