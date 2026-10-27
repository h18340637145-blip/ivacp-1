import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// MySQL 集成测试需要 MYSQL_URL；未配置时对应用例自动跳过
if (existsSync(".env")) process.loadEnvFile(".env");

const config = {
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
};

export default config;
