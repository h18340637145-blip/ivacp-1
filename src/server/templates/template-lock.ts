import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/server/db/mysql";
import { HttpError } from "@/server/http/route";

/** 哈希数据库排序权重而非原始键；锁名不超过MySQL的64字节。 */
function lockNameFromWeight(weight: string): string {
  return `ivacp:template:${createHash("sha256").update(weight).digest("hex").slice(0, 48)}`;
}

/** 同标识跨进程串行；业务SQL必须使用传入连接，不能持锁后再向池申请连接。 */
export async function withTemplateLock<T>(key: string, operation: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await (await getPool()).getConnection();
  let name = "";
  let acquired = false;
  let reusable = true;
  try {
    let rows: RowDataPacket[];
    try {
      // 与 team_templates 的 utf8mb4_unicode_ci 及 VARCHAR(64) 一致，包含大小写、重音及尾空格等价规则。
      const [identity] = await connection.query<RowDataPacket[]>(
        "SELECT HEX(WEIGHT_STRING(? COLLATE utf8mb4_unicode_ci AS CHAR(64))) AS weight", [key],
      );
      if (typeof identity[0]?.weight !== "string") throw new HttpError(503, "无法确定模板标识，请稍后重试");
      name = lockNameFromWeight(identity[0].weight);
      [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS acquired", [name]);
    } catch (error) { reusable = false; throw error; }
    if (Number(rows[0]?.acquired) !== 1) throw new HttpError(503, "该模板正在更新，请稍后重试");
    acquired = true;
    return await operation(connection);
  } finally {
    if (acquired) {
      try {
        const [rows] = await connection.query<RowDataPacket[]>("SELECT RELEASE_LOCK(?) AS released", [name]);
        if (Number(rows[0]?.released) !== 1) reusable = false;
      } catch { reusable = false; }
    }
    // 锁状态不确定的连接不能回池；销毁后由MySQL释放该连接持有的锁。
    if (reusable) connection.release(); else connection.destroy();
  }
}
