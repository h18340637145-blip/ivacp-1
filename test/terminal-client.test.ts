import { describe, expect, it, vi } from "vitest";
import {
  shellPath,
  buildBranchCheckoutCommand,
  parseGitStatusLine,
  contextKey,
  CommandGate,
} from "@/features/terminal/commands";
import { TerminalClient } from "@/features/terminal/terminal-client";
const context = {
  project: {
    projectName: "P",
    mainPath: "~/work ' $(touch /tmp/no)",
    scriptPath: "script",
    branches: [],
  },
  branch: {
    name: "B",
    repos: [
      { repoName: "R", repoPath: "repo", branchName: "feature/one' two" },
    ],
  },
};
function setup() {
  const sent: Record<string, unknown>[] = [];
  const events: unknown[] = [];
  const client = new TerminalClient(
    "t",
    (m) => sent.push(m),
    (m) => events.push(m),
  );
  client.receive(
    JSON.stringify({ type: "connected", sessionId: "s", targetId: "t" }),
  );
  client.setContext(context);
  return { client, sent, events };
}
describe("terminal client boundaries", () => {
  it("quotes shell expansions and branches without evaluating them", () => {
    expect(shellPath("~/a'b/$HOME")).toBe("~/'a'\\''b/$HOME'");
    expect(buildBranchCheckoutCommand(context)).toContain(
      "git checkout 'feature/one'\\'' two'",
    );
    expect(buildBranchCheckoutCommand(context)).toContain("git stash push -u");
  });
  it("identifies staged, untracked, rename and quoted paths", () => {
    expect(parseGitStatusLine(" M a b").unstaged).toBe(true);
    expect(parseGitStatusLine("A  new").staged).toBe(true);
    expect(parseGitStatusLine("R  old -> new").filePath).toBe("new");
    expect(parseGitStatusLine('?? "a\\tb"').filePath).toBe("a\tb");
    expect(parseGitStatusLine("## main").isFile).toBe(false);
  });
  it("serializes actions and rejects duplicate pending actions", () => {
    const { client, sent } = setup();
    expect(client.enqueue({ type: "signalConfigFiles" })).toBe(true);
    expect(client.enqueue({ type: "signalConfigFiles" })).toBe(false);
    client.enqueue({ type: "packageChecklist" });
    expect(sent).toHaveLength(1);
    client.receive(
      JSON.stringify({
        type: "signalConfigFiles",
        sessionId: "s",
        configs: [],
        requestId: sent[0]?.requestId,
        contextKey: contextKey(context),
      }),
    );
    expect(sent).toHaveLength(2);
    client.dispose();
  });
  it("drops foreign sessions and malformed messages and ignores callbacks after close", () => {
    const { client, events, sent } = setup();
    client.receive("{bad");
    client.receive(
      JSON.stringify({ type: "output", sessionId: "other", data: "bad" }),
    );
    client.receive(
      JSON.stringify({ type: "output", sessionId: "s", data: 12 }),
    );
    expect(events).toHaveLength(1);
    client.dispose();
    expect(sent.at(-1)).toEqual({ type: "disconnect", sessionId: "s" });
    client.receive(
      JSON.stringify({ type: "output", sessionId: "s", data: "late" }),
    );
    expect(events).toHaveLength(1);
    expect(client.enqueue({ type: "packageChecklist" })).toBe(false);
  });
  it("does not apply old project responses to the next context", () => {
    const { client, events, sent } = setup();
    client.enqueue({ type: "signalConfigFiles" });
    const next = {
      ...context,
      project: { ...context.project, mainPath: "/other" },
    };
    expect(contextKey(context)).not.toBe(contextKey(next));
    client.setContext(next);
    client.receive(
      JSON.stringify({
        type: "signalConfigFiles",
        sessionId: "s",
        configs: [],
        requestId: sent[0]?.requestId,
        contextKey: contextKey(context),
      }),
    );
    expect(events).toHaveLength(1);
    client.dispose();
  });
});

describe("terminal protocol correlation", () => {
  it("uses request IDs and does not complete an action from unsolicited git status", () => {
    const { client, sent } = setup();
    client.enqueue({ type: "projectGitStatus" });
    client.enqueue({ type: "packageChecklist" });
    const requestId = sent[0]?.requestId;
    expect(requestId).toEqual(expect.any(String));
    client.receive(
      JSON.stringify({
        type: "gitStatus",
        sessionId: "s",
        statuses: [],
        contextKey: contextKey(context),
      }),
    );
    expect(sent).toHaveLength(1);
    client.receive(
      JSON.stringify({
        type: "gitStatus",
        sessionId: "s",
        statuses: [],
        requestId,
        contextKey: contextKey(context),
      }),
    );
    expect(sent).toHaveLength(2);
    client.dispose();
  });
  it("rejects late downloads with a prior request ID", () => {
    const { client, sent, events } = setup();
    client.enqueue({ type: "packageChecklist" });
    client.receive(
      JSON.stringify({
        type: "fileDownload",
        sessionId: "s",
        fileName: "x",
        mimeType: "x",
        contentBase64: "eA==",
        requestId: "old",
        contextKey: contextKey(context),
      }),
    );
    expect(events).toHaveLength(1);
    client.receive(
      JSON.stringify({
        type: "fileDownload",
        sessionId: "s",
        fileName: "x",
        mimeType: "x",
        contentBase64: "eA==",
        requestId: sent[0]?.requestId,
        contextKey: contextKey(context),
      }),
    );
    expect(events).toHaveLength(2);
    client.dispose();
  });
  it("ignores automatic status from a different main directory with identical repos", () => {
    const { client, events } = setup();
    client.setContext({
      ...context,
      project: { ...context.project, mainPath: "/other" },
    });
    client.receive(
      JSON.stringify({
        type: "gitStatus",
        sessionId: "s",
        statuses: [],
        contextKey: contextKey(context),
      }),
    );
    expect(events).toHaveLength(1);
    client.dispose();
  });
  it("fails closed on timeout and clears queued mutations", () => {
    vi.useFakeTimers();
    try {
      const sent: unknown[] = [];
      const fatal = vi.fn();
      const client = new TerminalClient(
        "t",
        (m) => sent.push(m),
        () => {},
        () => {},
        fatal,
      );
      client.receive(
        JSON.stringify({ type: "connected", sessionId: "s", targetId: "t" }),
      );
      client.setContext(context);
      client.enqueue({ type: "packageChecklist" });
      client.enqueue({ type: "gitAdd", repoPath: "repo", files: ["a"] });
      vi.advanceTimersByTime(30001);
      expect(fatal).toHaveBeenCalledOnce();
      expect(sent).toHaveLength(2);
      expect(sent.at(-1)).toEqual({ type: "disconnect", sessionId: "s" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("routes a structured operation error to its own request then allows the next request", () => {
    const { client, sent, events } = setup();
    client.enqueue({ type: "packageChecklist" });
    client.enqueue({ type: "signalConfigFiles" });
    client.receive(
      JSON.stringify({
        type: "status",
        status: "error",
        message: "failed",
        requestId: "foreign",
      }),
    );
    expect(sent).toHaveLength(1);
    client.receive(
      JSON.stringify({
        type: "status",
        status: "error",
        message: "failed",
        requestId: sent[0]?.requestId,
      }),
    );
    expect(sent).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "status", message: "failed" });
    client.dispose();
  });
  it("suppresses double-click toolbar commands while retaining later intentional retries", () => {
    const gate = new CommandGate();
    expect(gate.accept("git pull", 1000)).toBe(true);
    expect(gate.accept("git pull", 1100)).toBe(false);
    expect(gate.accept("git pull", 1800)).toBe(true);
  });
  it("decodes Git C-quoted UTF8 and preserves literal rename separators in ordinary filenames", () => {
    expect(parseGitStatusLine(' M "\\344\\270\\255.txt"').filePath).toBe(
      "中.txt",
    );
    expect(parseGitStatusLine(" M before -> after").filePath).toBe(
      "before -> after",
    );
  });
});
