import type { TeamMemberStatistics } from "@/domain/analysis/team-statistics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from "@/shared/ui";
import { dwellText, memberCoverage, percentText } from "../format";

/** 团队成员明细：表格为主，处理票数列附带 Jira / 飞书构成条 */
export function MemberTable({ members }: { members: TeamMemberStatistics[] }) {
  if (!members.length) return null;
  const max = Math.max(1, ...members.map((member) => member.statistics.processedTickets));
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>成员明细</CardTitle>
          <CardDescription>按账号汇总；同一张票被多人处理时分别计入各自名下</CardDescription>
        </div>
        <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="图例">
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-primary" />Jira</li>
          <li className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-info" />飞书项目</li>
        </ul>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>账号</TableHead>
              <TableHead className="w-[30%]">处理票数</TableHead>
              <TableHead className="text-right">Jira</TableHead>
              <TableHead className="text-right">飞书项目</TableHead>
              <TableHead className="text-right">复核覆盖率</TableHead>
              <TableHead className="text-right">平均流转</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map(({ owner, statistics }) => {
              const jira = statistics.jira.processedTickets;
              const meegle = statistics.meegle.processedTickets;
              return (
                <TableRow key={owner}>
                  <TableCell className="font-medium">{owner}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="tabular w-10 shrink-0 text-right">{statistics.processedTickets}</span>
                      <Tooltip content={`Jira ${jira} 张，飞书项目 ${meegle} 张`}>
                        <span tabIndex={0} aria-label={`Jira ${jira} 张，飞书项目 ${meegle} 张`} className="flex h-2 flex-1 overflow-hidden rounded-full bg-surface-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="h-full bg-primary" style={{ width: `${(jira / max) * 100}%` }} />
                          <span className="h-full bg-info" style={{ width: `${(meegle / max) * 100}%` }} />
                        </span>
                      </Tooltip>
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right">{jira}</TableCell>
                  <TableCell className="tabular text-right">{meegle}</TableCell>
                  <TableCell className="tabular text-right">{percentText(memberCoverage(statistics))}</TableCell>
                  <TableCell className="tabular text-right">{dwellText(statistics.dwell.avgDwellMs)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
