import { Suspense } from "react";
import type { Metadata } from "next";
import { ScanSearch } from "lucide-react";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return (
    <main id="main-content" className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-md sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ScanSearch className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">IVACP 智能分析平台</h1>
            <p className="mt-1 text-sm text-muted-foreground">使用团队账号登录</p>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
