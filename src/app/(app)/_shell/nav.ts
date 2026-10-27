import {
  BarChart3,
  Database,
  FileCode2,
  LayoutGrid,
  LibraryBig,
  Tags,
  TerminalSquare,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { AuthRole } from "@/domain/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 访问所需最低角色 */
  role?: AuthRole;
  /** 额外匹配为“当前”的路径前缀 */
  match?: string[];
  external?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** 侧栏导航（全局唯一来源） */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "分析",
    items: [
      { href: "/", label: "规则组看板", icon: LayoutGrid, match: ["/rule-groups", "/tickets"] },
      { href: "/meegle", label: "飞书项目", icon: Workflow },
      { href: "/statistics", label: "统计报表", icon: BarChart3 },
    ],
  },
  {
    title: "协作",
    items: [
      { href: "/templates", label: "模板库", icon: LibraryBig },
      { href: "/labeling", label: "数据标注", icon: Tags },
    ],
  },
  {
    title: "系统",
    items: [
      { href: "/settings/data", label: "数据管理", icon: Database, match: ["/settings"] },
      { href: "/terminal", label: "远程终端", icon: TerminalSquare, role: "admin" },
      { href: "/api/docs", label: "API 文档", icon: FileCode2, external: true },
    ],
  },
];

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.external) return false;
  if (item.href === "/") return pathname === "/" || (item.match ?? []).some((prefix) => pathname.startsWith(prefix));
  return pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.match ?? []).some((prefix) => pathname.startsWith(prefix));
}
