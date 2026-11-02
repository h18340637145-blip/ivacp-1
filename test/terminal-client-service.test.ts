import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportProjectConfig,
  importProjectConfig,
  loadTerminalProjects,
  loadTerminalTargets,
} from "@/features/terminal/service";
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
  it("only keeps the public target metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ targets: [target] }))),
    );
    const targets = await loadTerminalTargets(new AbortController().signal);
    expect(targets[0]).not.toHaveProperty("host");
    expect(targets[0]).not.toHaveProperty("password");
  });
  it("validates complete project configuration and surfaces missing flags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ projects: [project], configMissing: false, canImportCanonical: true }),
          ),
      ),
    );
    const result = await loadTerminalProjects("target", new AbortController().signal);
    expect(result.projects).toEqual([project]);
    expect(result.configMissing).toBe(false);
    expect(result.canImportCanonical).toBe(true);
  });
  it("does not accept HTTP 200 business errors as usable configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not allowed" }))),
    );
    await expect(
      loadTerminalProjects("target", new AbortController().signal),
    ).rejects.toThrow("格式无效");
  });
  it("rejects incomplete nested repo configuration before rendering controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              projects: [
                { ...project, branches: [{ name: "main", repos: [{ repoPath: "repo" }] }] },
              ],
              configMissing: false,
              canImportCanonical: false,
            }),
          ),
      ),
    );
    await expect(
      loadTerminalProjects("target", new AbortController().signal),
    ).rejects.toThrow("格式无效");
  });
  it("preserves the API permission error on targets and passes cancellation", async () => {
    const controller = new AbortController();
    const mock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: "仅已登录用户可用" }), { status: 403 }),
    );
    vi.stubGlobal("fetch", mock);
    await expect(loadTerminalTargets(controller.signal)).rejects.toThrow("仅已登录用户可用");
    expect(mock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });
  it("posts project list on import and surfaces the written file", async () => {
    const mock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ file: "docs/project_env.json", backup: null, scope: "named", projectCount: 1 }),
        ),
    );
    vi.stubGlobal("fetch", mock);
    const result = await importProjectConfig("target", [project]);
    expect(result.scope).toBe("named");
    expect(result.projectCount).toBe(1);
    const body = JSON.parse(String(mock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ targetId: "target", projects: [project] });
  });
  it("surfaces the server error message when export fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "服务端尚无 project.json" }), { status: 404 })),
    );
    await expect(exportProjectConfig("target")).rejects.toThrow("服务端尚无 project.json");
  });
  it("rejects malformed base64 before creating any download artifact", () => {
    expect(() =>
      downloadBase64File("file.zip", "application/zip", "%not-base64%"),
    ).toThrow();
  });
});
