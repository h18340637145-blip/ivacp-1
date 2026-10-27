import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

/**
 * MySQL 连接与表结构引导。
 * - MYSQL_URL：新系统数据库（默认库名 ivacp），首次连接自动建库建表。
 * - LEGACY_MYSQL_URL：旧系统数据库（jira_analyzer_next），仅供一键迁移只读访问。
 */

export const DEFAULT_DATABASE = "ivacp";
export const LEGACY_DEFAULT_DATABASE = "jira_analyzer_next";

type ConnectionConfig = Required<Pick<PoolOptions, "host" | "port" | "user" | "password" | "database">>;

export function parseMysqlUrl(raw: string, fallbackDatabase = DEFAULT_DATABASE): ConnectionConfig {
  const url = new URL(raw);
  if (url.protocol !== "mysql:") throw new Error("MySQL 连接串必须以 mysql:// 开头");
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || fallbackDatabase;
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error("数据库名只允许字母、数字和下划线");
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

export function isMysqlConfigured(): boolean {
  return Boolean(process.env.MYSQL_URL?.trim());
}

/** 新库表结构。sync_records 额外抽取 source / rule_group_id / ticket_key / created_at 便于统计与标注查询。 */
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS sync_records (
    owner VARCHAR(128) NOT NULL,
    table_name VARCHAR(64) NOT NULL,
    record_id VARCHAR(255) NOT NULL,
    data LONGTEXT NULL,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    source VARCHAR(16) NULL,
    rule_group_id VARCHAR(255) NULL,
    ticket_key VARCHAR(255) NULL,
    record_created_at DATETIME(3) NULL,
    client_id VARCHAR(64) NULL,
    backup_run_id VARCHAR(64) NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (owner, table_name, record_id),
    KEY idx_owner_updated (owner, updated_at),
    KEY idx_table_created (table_name, deleted, record_created_at),
    KEY idx_ticket (table_name, source, ticket_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sync_clients (
    owner VARCHAR(128) NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    last_push_at DATETIME(3) NULL,
    last_full_backup_at DATETIME(3) NULL,
    PRIMARY KEY (owner, client_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  // 团队模板与标注表沿用旧库结构，迁移时逐行复制
  `CREATE TABLE IF NOT EXISTS team_templates (
    template_key VARCHAR(64) NOT NULL,
    version INT NOT NULL,
    name VARCHAR(80) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    tags VARCHAR(512) NOT NULL DEFAULT '[]',
    author VARCHAR(128) NOT NULL,
    config LONGTEXT NOT NULL,
    checksum VARCHAR(16) NOT NULL,
    apply_count INT NOT NULL DEFAULT 0,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (template_key, version),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS labeling_annotations (
    owner VARCHAR(128) NOT NULL,
    item_id VARCHAR(300) NOT NULL,
    verdict VARCHAR(16) NOT NULL,
    error_codes TEXT NOT NULL,
    purposes TEXT NOT NULL,
    corrected_conclusion LONGTEXT NULL,
    difficulty VARCHAR(16) NOT NULL,
    note TEXT NULL,
    labeler VARCHAR(128) NOT NULL,
    revision INT NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (owner, item_id),
    KEY idx_owner_verdict (owner, verdict)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS migration_runs (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    kind VARCHAR(32) NOT NULL,
    operator VARCHAR(128) NOT NULL,
    report JSON NOT NULL,
    created_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function createPool(config: ConnectionConfig, bootstrap: boolean): Promise<Pool> {
  if (bootstrap) {
    const connection = await mysql.createConnection({ ...config, database: undefined });
    try {
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    } finally {
      await connection.end();
    }
  }
  const pool = mysql.createPool({ ...config, connectionLimit: 5, charset: "utf8mb4" });
  if (bootstrap) {
    for (const statement of SCHEMA) await pool.query(statement);
  }
  return pool;
}

let poolPromise: Promise<Pool> | null = null;
let legacyPoolPromise: Promise<Pool> | null = null;

/** 新系统数据库连接池（首次调用时建库建表） */
export function getPool(): Promise<Pool> {
  if (!poolPromise) {
    const raw = process.env.MYSQL_URL?.trim();
    if (!raw) return Promise.reject(new Error("未配置 MYSQL_URL，服务端数据库不可用"));
    poolPromise = createPool(parseMysqlUrl(raw), true).catch((error) => {
      poolPromise = null;
      throw error;
    });
  }
  return poolPromise;
}

export function legacyMysqlUrl(): string | null {
  const explicit = process.env.LEGACY_MYSQL_URL?.trim();
  if (explicit) return explicit;
  const raw = process.env.MYSQL_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  url.pathname = `/${LEGACY_DEFAULT_DATABASE}`;
  return url.toString();
}

/** 旧系统数据库只读连接池（不建表） */
export function getLegacyPool(): Promise<Pool> {
  if (!legacyPoolPromise) {
    const raw = legacyMysqlUrl();
    if (!raw) return Promise.reject(new Error("未配置 LEGACY_MYSQL_URL / MYSQL_URL，无法读取旧系统数据库"));
    legacyPoolPromise = createPool(parseMysqlUrl(raw, LEGACY_DEFAULT_DATABASE), false).catch((error) => {
      legacyPoolPromise = null;
      throw error;
    });
  }
  return legacyPoolPromise;
}

/** 测试与脚本结束时释放连接 */
export async function closePools(): Promise<void> {
  const pools = await Promise.allSettled([poolPromise, legacyPoolPromise].filter(Boolean) as Promise<Pool>[]);
  poolPromise = null;
  legacyPoolPromise = null;
  await Promise.all(pools.map((result) => (result.status === "fulfilled" ? result.value.end() : undefined)));
}
