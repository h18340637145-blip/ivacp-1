"use client";
import { useCallback, useState } from 'react';
import { useAsync } from '@/shared/hooks/use-async';
import { Button, Callout, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState, ErrorState, Spinner } from '@/shared/ui';
import { probeLegacyDatabase, migrateBrowserLegacy, readLegacyDatabase } from '../service';
import { migrateLegacyTables, type MigrationReport } from '@/domain/migration/legacy';
import type { DataOperation } from '../use-data-operation';
import { MigrationSummary } from './data-report';

export function LegacyData({operation}: {operation: DataOperation}) {
  const probe = useAsync(useCallback(() => probeLegacyDatabase(), []));
  const [preview, setPreview] = useState<MigrationReport | null>(null);
  const [confirm, setConfirm] = useState(false);
  return <Card><CardHeader><CardTitle>同源旧浏览器数据迁移</CardTitle><Button disabled={operation.pending || probe.loading} onClick={() => void probe.reload()}>重新探测</Button></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">只读 JiraAnalyzerDB，转换后合并至 IvacpDB；保留旧库与现有新库记录。不同端口、协议或域名的旧库无法直接读取，可在旧系统导出 JSON 后导入。</p>
    {probe.loading ? <Spinner label="正在探测旧库"/> : probe.error ? <ErrorState error={probe.error} onRetry={() => void probe.reload()}/> : probe.data?.status === 'found' ? <Callout tone="success" title="发现同源 JiraAnalyzerDB">可以预览并迁移旧数据，重复执行只补齐缺失 ID。</Callout> : <EmptyState title={probe.data?.status === 'unavailable' ? '浏览器不支持安全枚举数据库' : '当前来源未发现旧库'} description="请使用旧系统导出的 JSON 备份。探测过程不会创建旧数据库。"/>}
    <Button disabled={probe.data?.status !== 'found' || operation.pending} onClick={() => operation.launch('正在预览旧库迁移', async progress => {
      progress('正在以只读事务读取旧库');
      const result = migrateLegacyTables(await readLegacyDatabase()); setPreview(result.report); setConfirm(true); return result.report;
    })}>预览旧库一键迁移</Button>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="确认迁移旧浏览器数据" description="读取旧库并转换写入新库；已有 ID 跳过，旧库不会被修改。" confirmText="确认迁移到新库" onConfirm={() => operation.run('正在迁移旧浏览器数据', migrateBrowserLegacy).then(() => undefined)}>
      {preview && <MigrationSummary report={preview}/>}
    </ConfirmDialog>
  </CardContent></Card>;
}
