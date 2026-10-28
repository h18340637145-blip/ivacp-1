import { readFile } from "node:fs/promises";
import path from "node:path";
export const SWAGGER_ASSETS = {
  "swagger-ui.css": { path: () => path.join(process.cwd(), "node_modules/swagger-ui-dist/swagger-ui.css"), type: "text/css; charset=utf-8" },
  "swagger-ui-bundle.js": { path: () => path.join(process.cwd(), "node_modules/swagger-ui-dist/swagger-ui-bundle.js"), type: "application/javascript; charset=utf-8" },
};

/** 包内固定资源，不把用户输入传入文件路径。 */
export async function readSwaggerAsset(file: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | undefined> {
  if (!Object.hasOwn(SWAGGER_ASSETS, file)) return;
  const entry = SWAGGER_ASSETS[file as keyof typeof SWAGGER_ASSETS];
  return { bytes: new Uint8Array(await readFile(entry.path())), type: entry.type };
}
