import type { Metadata, Viewport } from "next";
import { THEME_INIT_SCRIPT } from "@/shared/layout/theme";
import { Toaster } from "@/shared/ui/toast";
import { TooltipProvider } from "@/shared/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "IVACP · 车辆问题智能分析与协作平台", template: "%s · IVACP" },
  description: "Jira / 飞书项目缺陷票 AI 辅助分析、复核与团队协作平台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          跳转到主内容
        </a>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
