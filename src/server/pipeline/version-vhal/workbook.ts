import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { trackPipelineChild, throwIfPipelineCancelled } from "../process/runtime";
const workbookSchema = z.object({ rows: z.array(z.object({ sheet: z.string(), row: z.number(), project: z.string(), propertyId: z.string().optional(), up: z.string(), down: z.string(), projectUnknown: z.boolean().optional() })), warnings: z.array(z.string()), sheets: z.array(z.string()) });
export async function readVhalWorkbook(file: string) {
    throwIfPipelineCancelled();
    return new Promise<z.infer<typeof workbookSchema>>((resolve, reject) => {
        const child = spawn(process.env.CAN_PYTHON_BIN || "python3", [path.join(process.cwd(), "scripts/read-vhal-xlsx.py"), file], { timeout: 60000, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "", overflow = false;
        child.stdout.on("data", (data: Buffer) => { if (!overflow) {
            stdout += data.toString();
            if (Buffer.byteLength(stdout) > 32 * 1024 * 1024) {
                overflow = true;
                child.kill("SIGTERM");
            }
        } });
        child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-4000); });
        child.on("error", reject);
        child.on("close", code => {
            try {
                throwIfPipelineCancelled();
                if (code !== 0 || overflow)
                    throw new Error(overflow ? "Excel解析输出过大" : `Excel解析失败：${stderr}`);
                resolve(workbookSchema.parse(JSON.parse(stdout)));
            }
            catch (e) {
                reject(e);
            }
        });
        trackPipelineChild(child);
    });
}
