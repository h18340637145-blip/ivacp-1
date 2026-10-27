import fs from "node:fs/promises";
import path from "node:path";
import type { PipelineLogger } from "@/server/pipeline/paths-logging";
import { findMaxCycleDir } from "@/server/pipeline/signals";

/** 结论提到“信号不存在 / 报文不存在”时，从最大 cycle_ 目录的 Buildinfo.txt 追加博世 MAIN_VERSION */
export async function appendBoschMainVersion(finalReply: string, extractDir: string, logger: PipelineLogger): Promise<string> {
  if (!(finalReply.includes("信号不存在") || finalReply.includes("报文不存在"))) return finalReply;
  logger.log("VERSION_EXTRACT", "分析结果中存在信号或报文不存在的情况，开始获取博世版本号…");
  if (!extractDir) return finalReply;
  let reply = finalReply;
  try {
    const maxCyclePath = await findMaxCycleDir(extractDir);
    if (maxCyclePath) {
      const buildInfoPath = path.join(maxCyclePath, "Buildinfo.txt");
      let buildInfoContent = "";
      try {
        buildInfoContent = await fs.readFile(buildInfoPath, "utf-8");
      } catch {
        // 尝试不区分大小写匹配文件名
        try {
          const filesInCycle = await fs.readdir(maxCyclePath);
          const targetFile = filesInCycle.find(f => f.toLowerCase() === "buildinfo.txt");
          if (targetFile) {
            buildInfoContent = await fs.readFile(path.join(maxCyclePath, targetFile), "utf-8");
          }
        } catch (err) {
          logger.log("VERSION_EXTRACT", `读取 Buildinfo.txt 失败: ${String(err)}`);
        }
      }

      if (buildInfoContent) {
        const versionMatch = buildInfoContent.match(/MAIN_VERSION\s*=\s*([^\s\r\n]+)/);
        if (versionMatch) {
          const mainVersion = versionMatch[1];
          logger.log("VERSION_EXTRACT", `成功获取 MAIN_VERSION: ${mainVersion}`);
          reply += `\n\n当前测试版本基于博世版本：MAIN_VERSION=${mainVersion}`;
        } else {
          logger.log("VERSION_EXTRACT", "Buildinfo.txt 中未找到 MAIN_VERSION");
        }
      } else {
        logger.log("VERSION_EXTRACT", "Buildinfo.txt 内容为空或未找到文件");
      }
    } else {
      logger.log("VERSION_EXTRACT", "未找到 cycle_数字 文件夹");
    }
  } catch (e) {
    logger.log("VERSION_EXTRACT", `获取博世版本号异常: ${String(e)}`);
  }
  return reply;
}
