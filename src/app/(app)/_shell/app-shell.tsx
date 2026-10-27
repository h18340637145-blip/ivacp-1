"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, LogOut, Menu, ScanSearch, UserRound } from "lucide-react";
import { ROLE_LABEL } from "@/domain/auth/permissions";
import { useSession, useSessionStore } from "@/features/auth/session-store";
import { ChatDrawer } from "@/features/chat/components/chat-drawer";
import { ThemeToggle } from "@/shared/layout/theme";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/shared/ui/sheet";
import { isNavActive, NAV_SECTIONS } from "./nav";
import { SyncIndicator } from "./sync-indicator";

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md px-1 py-1" aria-label="IVACP 首页">
      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ScanSearch className="size-4" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-foreground">IVACP</span>
        <span className="text-[11px] text-muted-foreground">车辆问题智能分析</span>
      </span>
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can, ready } = useSession();
  return (
    <nav aria-label="主导航" className="flex flex-col gap-5">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => !item.role || !ready || can(item.role));
        if (items.length === 0) return null;
        return (
          <div key={section.title} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{section.title}</p>
            {items.map((item) => {
              const active = isNavActive(item, pathname);
              const Icon = item.icon;
              const className = cn(
                "flex min-h-10 items-center gap-2.5 rounded-md px-3 text-sm transition-colors",
                active
                  ? "bg-primary-soft font-medium text-primary"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              );
              return item.external ? (
                <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className={className} onClick={onNavigate}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={className}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function UserMenu() {
  const { user } = useSession();
  const logout = useSessionStore((state) => state.logout);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label="用户菜单">
          <UserRound className="size-4" aria-hidden />
          <span className="hidden max-w-32 truncate sm:inline">{user?.displayName ?? "未登录"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {user ? (
          <DropdownMenuLabel>
            {user.username} · {ROLE_LABEL[user.role]}
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void logout()}>
          <LogOut aria-hidden />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const loadSession = useSessionStore((state) => state.load);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // 路由切换后把焦点移到主内容，便于读屏用户
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-border bg-surface px-3 py-4 lg:flex">
        <Brand />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavList />
        </div>
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" title="导航菜单" srOnlyHeader className="w-72 gap-6 px-3 py-4">
          <Brand />
          <NavList onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="打开导航菜单"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="size-5" aria-hidden />
          </Button>
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <SyncIndicator />
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={() => setChatOpen(true)} aria-label="打开智能助手">
              <Bot className="size-4" aria-hidden />
              <span className="hidden sm:inline">智能助手</span>
            </Button>
            <UserMenu />
          </div>
        </header>
        <main id="main-content" ref={mainRef} tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </main>
      </div>

      <ChatDrawer open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  );
}
