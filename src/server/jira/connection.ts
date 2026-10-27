export type JiraProvider = "default" | "bosch";

export interface JiraConnection {
  provider: JiraProvider;
  /** 不带结尾斜杠的服务地址 */
  server: string;
  username: string;
  /** Basic Authorization 的 base64 部分 */
  basicAuth: string;
  /** Jira 搜索接口路径与分页方式 */
  searchPath: string;
  searchMode: "offset" | "token";
  missing: string[];
}

export function normalizeJiraProvider(value: unknown): JiraProvider {
  return value === "bosch" ? "bosch" : "default";
}

function trimServer(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export function getJiraConnection(provider?: unknown): JiraConnection {
  if (normalizeJiraProvider(provider) === "bosch") {
    const server = trimServer(process.env.BOSCH_JIRA_URL);
    const username = process.env.BOSCH_JIRA_USERNAME ?? "";
    // Atlassian Cloud 只接受 API Token 作为 Basic 密码，登录密码仅作兜底
    const secret = process.env.bosch_jira_api_token || process.env.BOSCH_JIRA_API_TOKEN || process.env.BOSCH_JIRA_PASSWORD || "";
    const missing: string[] = [];
    if (!server) missing.push("BOSCH_JIRA_URL");
    if (!username) missing.push("BOSCH_JIRA_USERNAME");
    if (!secret) missing.push("bosch_jira_api_token");
    return {
      provider: "bosch",
      server,
      username,
      basicAuth: Buffer.from(`${username}:${secret}`).toString("base64"),
      searchPath: "/rest/api/2/search/jql",
      searchMode: "token",
      missing,
    };
  }

  const server = trimServer(process.env.JIRA_SERVER);
  const username = process.env.JIRA_USERNAME ?? "";
  const password = process.env.JIRA_PASSWORD ?? "";
  const missing: string[] = [];
  if (!server) missing.push("JIRA_SERVER");
  if (!username) missing.push("JIRA_USERNAME");
  if (!password) missing.push("JIRA_PASSWORD");
  return {
    provider: "default",
    server,
    username,
    basicAuth: Buffer.from(`${username}:${password}`).toString("base64"),
    searchPath: "/rest/api/2/search",
    searchMode: "offset",
    missing,
  };
}

/** 按 URL 主机选择对应 Jira 连接，凭据只发送给已配置的 Jira 主机 */
export function getJiraConnectionForUrl(url: string): JiraConnection | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const provider of ["bosch", "default"] as const) {
    const connection = getJiraConnection(provider);
    if (!connection.server) continue;
    try {
      if (new URL(connection.server).hostname === hostname) return connection;
    } catch {
      // 忽略无效的服务地址
    }
  }
  return null;
}
