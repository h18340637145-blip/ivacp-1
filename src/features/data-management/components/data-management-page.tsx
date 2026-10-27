"use client";
import { exportBackupFile } from '@/shared/db/sync';
import { useSession } from '@/features/auth/session-store';
import { Button, Callout, Card, CardContent, CardHeader, CardTitle, ErrorState, Page, PageHeader, Spinner } from '@/shared/ui';
import { useDataOperation } from '../use-data-operation';
import { DataReport } from './data-report';
import { LocalData } from './local-data';
import { MirrorData } from './mirror-data';
import { LegacyData } from './legacy-data';
import { MysqlMigration } from './mysql-migration';

export function DataManagementPage() {
  const session = useSession();
  const operation = useDataOperation();
  return <Page className="space-y-5">
    <PageHeader title="数据管理" description="管理浏览器本地数据、服务器镜像与旧系统迁移。" breadcrumbs={[{label:'规则组看板', href:'/'}, {label:'数据管理'}]} actions={<Button variant="primary" disabled={operation.pending} onClick={() => operation.launch('正在导出本地 JSON', exportBackupFile)}>导出 JSON 备份</Button>}/>
    {(operation.pending || operation.messages.length > 0 || operation.error) && <Card><CardHeader><CardTitle>操作进度与结果</CardTitle>{operation.pending && <Spinner label="操作进行中"/>}</CardHeader><CardContent className="space-y-3">
      <div role="log" aria-live="polite" aria-relevant="additions" className="max-h-44 overflow-y-auto text-xs text-muted-foreground"><ol className="space-y-1">{operation.messages.map((message,index) => <li key={index}>{message}</li>)}</ol></div>
      {operation.error && <ErrorState title="操作失败" error={operation.error}/>}
      {operation.report !== undefined && <DataReport value={operation.report}/>}
    </CardContent></Card>}
    <LocalData operation={operation}/>
    <MirrorData operation={operation}/>
    <LegacyData operation={operation}/>
    {session.can('admin') ? <MysqlMigration operation={operation}/> : <Callout>服务端旧库迁移仅管理员可操作。文件备份、当前账号镜像与浏览器旧库迁移仍可使用。</Callout>}
  </Page>;
}
