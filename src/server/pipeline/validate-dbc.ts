import { spawn } from "node:child_process";
import { trackPipelineChild, throwIfPipelineCancelled } from "./process/runtime";
/** Use the same cantools parser as CAN plotting before accepting automatic DBCs. */
export async function validateDbcFiles(files: string[]): Promise<void> {
    throwIfPipelineCancelled();
    await new Promise<void>((resolve, reject) => {
        const code = "import cantools,sys\nfor file in sys.argv[1:]:\n db=cantools.database.load_file(file, database_format='dbc')\n if not db.messages: raise ValueError('DBC has no messages: '+file)\n";
        const child = spawn(process.env.CAN_PYTHON_BIN || "python3", ["-c", code, ...files], { stdio: ["ignore", "ignore", "pipe"], timeout: 60000, detached: process.platform !== "win32" });
        let stderr = "";
        child.stderr.on("data", (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-3000); });
        child.on("error", reject);
        child.on("close", status => { try {
            throwIfPipelineCancelled();
            if (status !== 0)
                throw new Error(`DBC解析失败：${stderr || status}`);
            resolve();
        }
        catch (error) {
            reject(error);
        } });
        trackPipelineChild(child);
    });
}
