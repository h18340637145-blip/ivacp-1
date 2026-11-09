import type { NextConfig } from "next";

const heavyDataGlobs = ["./jira-issues/**/*", "./log/**/*", "./tmp/**/*", "./.codegraph/**/*"];

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  outputFileTracingExcludes: {
    "*": ["node_modules/@swc/core-linux-x64-gnu", "node_modules/@swc/core-linux-x64-musl", ...heavyDataGlobs],
  },
  // dev 下 webpack 编译缓存会随路由编译和热更新累积，触发 Next 的内存阈值自动重启；尽快回收闲置路由
  onDemandEntries: { maxInactiveAge: 15_000, pagesBufferLength: 2 },
  serverExternalPackages: ["ssh2", "mysql2", "playwright"],
  // 旧版路由 → 新版统一路由（查询参数会自动透传）
  async redirects() {
    return [
      { source: "/analysis/:ruleGroupId/meegle", destination: "/rule-groups/:ruleGroupId?source=meegle", permanent: false },
      {
        source: "/analysis/:ruleGroupId/:issueKey/validation/:runId",
        destination: "/tickets/jira/:issueKey/validation/:runId?group=:ruleGroupId",
        permanent: false,
      },
      { source: "/analysis/:ruleGroupId/:issueKey", destination: "/tickets/jira/:issueKey?group=:ruleGroupId", permanent: false },
      { source: "/analysis/:ruleGroupId", destination: "/rule-groups/:ruleGroupId", permanent: false },
      { source: "/meegle/issues/:workItemId/result", destination: "/tickets/meegle/:workItemId/result", permanent: false },
      { source: "/meegle/issues/:workItemId", destination: "/tickets/meegle/:workItemId", permanent: false },
      { source: "/geely2/:path*", destination: "/", permanent: false },
    ];
  },
  webpack: (config, { dev }) => {
    if (dev) {
      const ignored = config.watchOptions?.ignored;
      const existing = (Array.isArray(ignored) ? ignored : [ignored]).filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0,
      );
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [...existing, "**/jira-issues/**", "**/log/**", "**/.codegraph/**", "**/tmp/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
