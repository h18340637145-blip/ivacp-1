"use client";
import { useCallback, useRef, useState } from 'react';
import type { ParsedBackup } from '@/domain/storage/backup-format';
import { writeTables } from '@/shared/db/sync';
import { useLiveData } from '@/shared/hooks/use-live-data';
import { errorMessage } from '@/shared/lib/errors';
import { Button, Card, CardContent, CardHeader, CardTitle, Callout, ConfirmDialog, EmptyState, ErrorState, Field, Input, Select, Spinner, Stat, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui';
import { localTableCounts, previewBackup } from '../service';
import type { DataOperation } from '../use-data-operation';
import { MigrationSummary } from './data-report';

export function LocalData({ operation }: { operation: DataOperation }) {
  const local = useLiveData(useCallback(() => localTableCounts(), []));
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{name: string; backup: ParsedBackup} | null>(null);
  const [mode, setMode] = useState('merge');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = local.data?.reduce((sum, item) => sum + item.total, 0) ?? 0;
  async function readFile(file: File | undefined) {
    if (!file) return;
    setReading(true); setError(null);
    try { setPreview({name: file.name, backup: previewBackup(await file.text())}); setMode('merge'); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setReading(false); if (input.current) input.current.value = ''; }
  }
  return <Card>
    <CardHeader><div><CardTitle>浏览器本地数据</CardTitle><p className="mt-1 text-xs text-muted-foreground">IvacpDB 是当前浏览器的主存储；JSON 文件可用于离线备份和换机。</p></div><Button disabled={operation.pending || reading} onClick={() => input.current?.click()}>导入 JSON 备份</Button></CardHeader>
    <CardContent className="space-y-4">
      <Input ref={input} type="file" accept=".json,application/json" aria-label="选择 JSON 数据备份" className="hidden" onChange={event => void readFile(event.target.files?.[0])}/>
      {reading && <Spinner label="正在校验和转换备份文件"/>}
      {error && <ErrorState title="备份文件无法导入" error={error} onRetry={() => input.current?.click()}/>}
      {local.loading ? <Spinner label="正在读取本地数据"/> : local.error ? <ErrorState error={local.error} onRetry={local.reload}/> : <>
        <Stat label="本地记录总数" value={total} hint={`${local.data?.length ?? 0} 张业务表`}/>
        {total === 0 && <EmptyState title="本地尚无数据" description="可导入 JSON、迁移同源旧库，或从当前账号的服务端镜像恢复。"/>}
        <Table><TableHeader><TableRow><TableHead>业务表</TableHead><TableHead>本地记录</TableHead></TableRow></TableHeader><TableBody>{local.data?.map(item => <TableRow key={item.table}><TableCell className="font-mono text-xs">{item.table}</TableCell><TableCell className="tabular">{item.total}</TableCell></TableRow>)}</TableBody></Table>
      </>}
      <ConfirmDialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null); }} title="导入备份预览" description={preview?.name} confirmText={mode === 'overwrite' ? '确认覆盖导入' : '确认合并导入'} destructive={mode === 'overwrite'} onConfirm={async () => {
        if (!preview) return;
        await operation.run('正在导入备份', progress => writeTables(preview.backup.tables, { overwrite: mode === 'overwrite' }, progress));
      }}>
        {preview && <div className="space-y-4">
          <p className="text-sm">{preview.backup.legacyReport ? '已识别旧系统备份并转换为新结构。' : '已识别 IvacpDB 备份。'}共 {Object.values(preview.backup.tables).reduce((sum, rows) => sum + (rows?.length ?? 0), 0)} 条。</p>
          {preview.backup.legacyReport && <MigrationSummary report={preview.backup.legacyReport}/>}
          <Field label="写入方式"><Select aria-label="写入方式" value={mode} onValueChange={setMode} options={[{value:'merge', label:'合并：仅补齐缺失 ID'}, {value:'overwrite',label:'覆盖：同 ID 以备份为准'}]}/></Field>
          <Callout tone={mode === 'overwrite' ? 'warning' : 'info'}>{mode === 'overwrite' ? '同 ID 的现有记录会被替换；文件未包含的记录仍保留。请先导出本地备份。' : '现有 ID 保持当前值，新记录补齐，可重复执行。'}</Callout>
        </div>}
      </ConfirmDialog>
    </CardContent>
  </Card>;
}
