import { FlaskConical, Car } from "lucide-react";
import { ISSUE_SCENE_INFO, detectIssueScene } from "@/domain/analysis/issue-scene";
import { Badge } from "@/shared/ui";

/** 标题含「台架」/「实车」时显示场景徽标；无标志时不渲染 */
export function IssueSceneBadge({ title }: { title?: string | null }) {
  const scene = detectIssueScene(title);
  if (!scene) return null;
  const info = ISSUE_SCENE_INFO[scene];
  const Icon = scene === "bench" ? FlaskConical : Car;
  return (
    <Badge tone={scene === "bench" ? "warning" : "info"} title={`${info.label}：仅召回同场景历史案例`} className="shrink-0">
      <Icon aria-hidden />
      {info.keyword}
    </Badge>
  );
}
