"use client";
import { useCallback, useState } from 'react';
import type { MigrationReport } from '@/domain/migration/legacy';
import { apiFetch } from '@/shared/lib/api';
import { useAsync } from '@/shared/hooks/use-async';
import { formatDateTime } from '@/shared/lib/format';
import { Button, Callout, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState, ErrorState, Field, Select, Spinner } from '@/shared/ui';
import type { DataOperation } from '../use-data-operation';
import { DataReport, MigrationSummary } from './data-report';

interface MysqlPreview {
  checkedAt: string;
  owners: Array<{ owner: string; report: MigrationReport; conflicts: number; conflictsByTable: Record<string, number> }>;
  templates: {read: number};
  annotations: {read: number};
}

export function MysqlMigration({operation}: {operation: DataOperation}) {
  const history = useAsync(useCallback(() => apiFetch<{runs: unknown[]}>('/api/migration/legacy'), []));
  const [preview, setPreview] = useState<MysqlPreview | null>(null);
  const [mode, setMode] = useState('merge');
  const [confirm, setConfirm] = useState(false);
  const [completed, setCompleted] = useState(false);
  return <Card><CardHeader><CardTitle>管理员：旧 MySQL 镜像迁移</CardTitle></CardHeader><CardContent className="space-y-4">
    <Callout tone="warning">先只读预检，再确认执行。执行会把旧镜像、团队模板和标注写入新 MySQL；保留旧库。账号归属保持旧用户名，登录仍沿用当前体系。</Callout>
    <Button disabled={operation.pending} onClick={() => operation.launch('正在只读预检旧 MySQL', async progress => {
      setPreview(null); setCompleted(false); progress('正在读取源数据并检查新库 ID 冲突…');
      const report = await apiFetch<MysqlPreview>('/api/migration/legacy?preview=1'); setPreview(report); return report;
    })}>只读预检旧 MySQL</Button>
    {preview && <div className="space-y-4">
      <p className="text-sm tabular">预检时间 {formatDateTime(preview.checkedAt)}；{preview.owners.length} 个账号，模板 {preview.templates.read} 条，标注 {preview.annotations.read} 条。</p>
      {preview.owners.length === 0 && <EmptyState title="旧库没有账号镜像记录" description="请核对服务端旧库连接配置；团队模板和标注仍显示在上方。"/>}
      {preview.owners.map(owner => <details className="rounded-md border border-border p-3" key={owner.owner}><summary className="cursor-pointer text-sm">{owner.owner} · 同 ID 冲突 {owner.conflicts} 条</summary><div className="mt-3"><MigrationSummary report={owner.report}/>{owner.conflicts > 0 && <DataReport value={owner.conflictsByTable}/>}</div></details>)}
      <Field label="服务端迁移方式" hint="合并跳过新库现有记录；覆盖按旧库内容替换冲突记录。模板和标注同样遵循该方式。"><Select aria-label="服务端迁移方式" value={mode} onValueChange={setMode} disabled={operation.pending} options={[{value:'merge',label:'合并：保留新库现有数据'}, {value:'overwrite',label:'覆盖：同 ID 以旧库为准'}]}/></Field>
      <Button variant="destructive-outline" disabled={operation.pending} onClick={() => setConfirm(true)}>确认迁移方式并执行</Button>
    </div>}
    {completed && <Callout tone="success" title="旧 MySQL 迁移已完成">请查看操作报告。需要在本浏览器使用时，点击上方「从服务器恢复」，只会恢复当前账号的数据。</Callout>}
    <details><summary className="cursor-pointer text-sm">最近迁移记录</summary><div className="mt-3 space-y-3">
      {history.loading ? <Spinner/> : history.error ? <ErrorState error={history.error} onRetry={() => void history.reload()}/> : !history.data?.runs.length ? <EmptyState title="暂无迁移记录"/> : history.data.runs.map((run, index) => <DataReport key={index} value={run}/>)}
    </div></details>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="执行旧 MySQL 数据迁移" description={mode === 'overwrite' ? '将迁移所有账号数据，并覆盖新库内同 ID 的镜像、模板和标注。请先完成数据库备份。执行期间请保持页面打开。' : '将迁移所有账号数据，只补齐新库缺失记录。预检后源库可能变化，最终结果以执行报告为准。请保持页面打开。'} destructive confirmText={mode === 'overwrite' ? '确认覆盖迁移' : '确认合并迁移'} onConfirm={async () => {
      await operation.run('旧 MySQL 迁移执行中，请等待服务器返回报告', async progress => {
        progress('服务器正在迁移，完成后会显示逐账号报告；请勿重复提交。');
        return apiFetch('/api/migration/legacy', { method:'POST', json:{overwrite:mode === 'overwrite'} });
      });
      setCompleted(true); setPreview(null); await history.reload();
    }}/>
  </CardContent></Card>;
}
