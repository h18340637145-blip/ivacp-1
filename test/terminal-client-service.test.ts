import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTerminalConfiguration } from "@/features/terminal/service";
import { downloadBase64File } from "@/features/terminal/browser-files";
const target = {
  id: "target",
  name: "测试环境",
  description: "允许目标",
  environment: "test",
  riskLevel: "normal",
  guardMode: "soft",
  host: "secret-host",
  password: "never-render",
};
const project = {
  projectName: "P",
  mainPath: "~/workspace",
  scriptPath: "scripts",
  branches: [
    {
      name: "main",
      repos: [{ repoName: "R", repoPath: "repo", branchName: "main" }],
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
describe("terminal configuration boundaries", () => {
  it("only keeps the public target metadata and validates complete project configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith("targets")
                ? { targets: [target] }
                : { projects: [project] },
            ),
          ),
      ),
    );
    const result = await loadTerminalConfiguration(
      new AbortController().signal,
    );
    expect(result.targets[0]).not.toHaveProperty("host");
    expect(result.targets[0]).not.toHaveProperty("password");
    expect(result.projects).toEqual([project]);
  });
  it("does not accept HTTP 200 business errors as usable empty configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not allowed" }))),
    );
    await expect(
      loadTerminalConfiguration(new AbortController().signal),
    ).rejects.toThrow("配置格式无效");
  });
  it("rejects incomplete nested repo configuration before rendering controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith("targets")
                ? { targets: [target] }
                : {
                    projects: [
                      {
                        ...project,
                        branches: [
                          { name: "main", repos: [{ repoPath: "repo" }] },
                        ],
                      },
                    ],
                  },
            ),
          ),
      ),
    );
    await expect(
      loadTerminalConfiguration(new AbortController().signal),
    ).rejects.toThrow("配置格式无效");
  });
  it("preserves the API permission error and passes cancellation to both requests", async () => {
    const controller = new AbortController();
    const mock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: "仅管理员可用" }), {
          status: 403,
        }),
    );
    vi.stubGlobal("fetch", mock);
    await expect(loadTerminalConfiguration(controller.signal)).rejects.toThrow(
      "仅管理员可用",
    );
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    });
  });
  it("rejects malformed base64 before creating any download artifact", () => {
    expect(() =>
      downloadBase64File("file.zip", "application/zip", "%not-base64%"),
    ).toThrow();
  });
});
