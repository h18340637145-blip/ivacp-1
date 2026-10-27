"use client";
import { useCallback, useEffect, useState } from 'react';
import { fetchServerBackupStatus, getAutoSyncState, subscribeAutoSync, pushFullBackup, restoreFromServer } from '@/shared/db/sync';
import { useAsync } from '@/shared/hooks/use-async';
import { formatDateTime } from '@/shared/lib/format';
import { Button, Callout, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState, ErrorState, Field, Select, Spinner, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui';
import type { DataOperation } from '../use-data-operation';

export function MirrorData({ operation }: { operation: DataOperation }) {
  const server = useAsync(useCallback(() => fetchServerBackupStatus(), []));
  const [sync, setSync] = useState(getAutoSyncState);
  const [confirm, setConfirm] = useState<'push' | 'restore' | null>(null);
  const [mode, setMode] = useState('merge');
  useEffect(() => subscribeAutoSync(setSync), []);
  const available = server.data?.configured && server.data.available !== false;
  return <Card><CardHeader><CardTitle>当前账号的服务器镜像</CardTitle><Button onClick={() => void server.reload()} disabled={server.loading || operation.pending}>刷新状态</Button></CardHeader>
    <CardContent className="space-y-4">
      {server.loading ? <Spinner/> : server.error ? <ErrorState error={server.error} onRetry={() => void server.reload()}/> : !server.data?.configured ? <Callout title="服务器镜像未配置">当前仍可使用文件导入与导出。配置 MySQL 后再刷新状态。</Callout> : !available ? <ErrorState error={server.data.error ?? '镜像服务不可用'} onRetry={() => void server.reload()}/> : <>
        <p className="text-sm">账号：{server.data.owner ?? '当前登录账号'}　<StatusBadge status={sync.syncing ? 'running' : 'completed'} label={sync.syncing ? '增量同步中' : sync.enabled ? '增量同步已启用' : '镜像可用'}/></p>
        <p className="text-xs text-muted-foreground tabular">待同步 {sync.pending} 条 · 最近同步 {formatDateTime(sync.lastSyncAt)} · 最近完整备份 {formatDateTime(sync.lastFullBackupAt)}</p>
        {sync.lastError && <Callout tone="warning" title="最近同步失败">{sync.lastError}</Callout>}
        {!server.data.tables?.length ? <EmptyState title="服务器尚无镜像记录" description="完整备份将当前浏览器的数据写入该账号镜像。"/> : <Table><TableHeader><TableRow><TableHead>镜像表</TableHead><TableHead>记录数</TableHead><TableHead>更新时间</TableHead></TableRow></TableHeader><TableBody>{server.data.tables.map(item => <TableRow key={item.table}><TableCell className="font-mono text-xs">{item.table}</TableCell><TableCell className="tabular">{item.total}</TableCell><TableCell className="tabular text-xs">{formatDateTime(item.lastUpdated)}</TableCell></TableRow>)}</TableBody></Table>}
      </>}
      <div className="flex flex-wrap gap-2"><Button disabled={!available || operation.pending} onClick={() => setConfirm('push')}>完整备份到服务器</Button><Button disabled={!available || operation.pending} onClick={() => {setMode('merge'); setConfirm('restore');}}>从服务器恢复</Button></div>
      <ConfirmDialog open={confirm !== null} onOpenChange={open => {if (!open) setConfirm(null);}} title={confirm === 'push' ? '完整备份到服务器' : '从服务器恢复到本地'} description={confirm === 'push' ? '服务器镜像将以当前浏览器为完整快照，本地没有的服务器记录会标记为删除。请确认当前浏览器包含所需的完整数据。' : '只恢复当前登录账号的镜像；下载完整数据后统一写入本地。'} confirmText={confirm === 'push' ? '确认完整备份' : mode === 'overwrite' ? '确认覆盖恢复' : '确认合并恢复'} destructive={confirm === 'push' || mode === 'overwrite'} onConfirm={async () => {
        await operation.run(confirm === 'push' ? '正在完整备份' : '正在恢复镜像', progress => confirm === 'push' ? pushFullBackup(progress) : restoreFromServer({overwrite: mode === 'overwrite'}, progress));
        await server.reload();
      }}>
        {confirm === 'restore' && <Field label="恢复方式" hint="合并仅补齐缺失 ID；覆盖替换同 ID，保留服务器未包含的本地记录。"><Select aria-label="恢复方式" value={mode} onValueChange={setMode} options={[{value:'merge',label:'合并缺失记录'}, {value:'overwrite',label:'覆盖同 ID 记录'}]}/></Field>}
      </ConfirmDialog>
    </CardContent>
  </Card>;
}
