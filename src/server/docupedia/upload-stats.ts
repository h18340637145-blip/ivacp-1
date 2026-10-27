import fs from "node:fs/promises";
import path from "node:path";

export interface DocupediaUploadRecord {
  uploadedAt: string;
  month: string;
  title: string;
  characterCount: number;
  action: "created" | "existing";
  monthlyTotal: number;
}

const pendingWrites = new Map<string, Promise<unknown>>();

export async function recordDocupediaUpload(input: {
  title: string;
  text: string;
  action: "created" | "existing";
  directory?: string;
  uploadedAt?: Date;
}): Promise<DocupediaUploadRecord | null> {
  if (input.text.length <= 500) return null;
  const uploadedAt = input.uploadedAt ?? new Date();
  const month = `${uploadedAt.getFullYear()}-${String(uploadedAt.getMonth() + 1).padStart(2, "0")}`;
  const directory = path.resolve(input.directory ?? path.join(process.cwd(), "log", "docupedia-upload-stats"));
  const filePath = path.join(directory, `${month}.jsonl`);
  const previous = pendingWrites.get(filePath) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    await fs.mkdir(directory, { recursive: true });
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const records = content.split("\n").filter((line) => line.trim())
      .map((line) => JSON.parse(line) as DocupediaUploadRecord);
    if (records.some((record) => record.title === input.title)) return null;
    const record: DocupediaUploadRecord = {
      uploadedAt: uploadedAt.toISOString(),
      month,
      title: input.title,
      characterCount: input.text.length,
      action: input.action,
      monthlyTotal: new Set(records.map((entry) => entry.title)).size + 1,
    };
    const separator = content && !content.endsWith("\n") ? "\n" : "";
    await fs.appendFile(filePath, `${separator}${JSON.stringify(record)}\n`, "utf8");
    return record;
  });
  pendingWrites.set(filePath, write);
  try {
    return await write;
  } finally {
    if (pendingWrites.get(filePath) === write) pendingWrites.delete(filePath);
  }
}