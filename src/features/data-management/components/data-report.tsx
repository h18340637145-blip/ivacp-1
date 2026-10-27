import type { MigrationReport } from '@/domain/migration/legacy';
import { Callout, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui';

export function MigrationSummary({ report }: { report: MigrationReport }) {
  return <div className="space-y-3">
    <p className="text-sm">读取 {Object.values(report.read).reduce((a, b) => a + b, 0)} 条，转换为 {Object.values(report.written).reduce((a, b) => a + b, 0)} 条新结构记录。</p>
    {report.warnings.length > 0 && <Callout tone="warning" title="需要核对的数据问题"><ul className="list-inside list-disc break-words">{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></Callout>}
    <Table><TableHeader><TableRow><TableHead>新表</TableHead><TableHead>转换条数</TableHead></TableRow></TableHeader><TableBody>{Object.entries(report.written).map(([name, total]) => <TableRow key={name}><TableCell className="font-mono text-xs">{name}</TableCell><TableCell className="tabular">{total}</TableCell></TableRow>)}</TableBody></Table>
  </div>;
}

export function DataReport({ value }: { value: unknown }) {
  return <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm">查看完整操作报告</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs font-mono">{JSON.stringify(value, null, 2)}</pre></details>;
}
