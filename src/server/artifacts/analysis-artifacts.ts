import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";

const LOG_BASE = path.join(process.cwd(), "log");

interface ArtifactIdentity {
  groupDir: string;
  carModel: string;
  issueKey: string;
  runId: string;
}

function signingSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be configured for artifact references");
  return "jira-analyzer-local-session-secret";
}

function isSafeSegment(value: string, maxLength = 80): boolean {
  return Boolean(value) && value.length <= maxLength && value !== "." && value !== ".." && !/[\\/:*?"<>|]/.test(value);
}

export function assertSafeRunId(runId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(runId)) {
    throw new Error("Invalid analysis runId");
  }
  return runId;
}

export function createArtifactRef(identity: ArtifactIdentity): string {
  if (![identity.groupDir, identity.carModel, identity.issueKey].every((part) => isSafeSegment(part))) {
    throw new Error("Invalid artifact identity");
  }
  assertSafeRunId(identity.runId);
  const payload = Buffer.from(JSON.stringify(identity), "utf8").toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function resolveArtifactRef(artifactRef: string): { identity: ArtifactIdentity; directory: string } {
  const [payload, encodedSignature] = artifactRef.split(".");
  if (!payload || !encodedSignature) throw new Error("Invalid artifactRef");
  const actual = Buffer.from(encodedSignature, "base64url");
  const calculated = createHmac("sha256", signingSecret()).update(payload).digest();
  if (actual.length !== calculated.length || !timingSafeEqual(actual, calculated)) throw new Error("Invalid artifactRef signature");
  let identity: ArtifactIdentity;
  try {
    identity = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ArtifactIdentity;
  } catch {
    throw new Error("Invalid artifactRef");
  }
  if (![identity.groupDir, identity.carModel, identity.issueKey].every((part) => typeof part === "string" && isSafeSegment(part))) {
    throw new Error("Invalid artifactRef identity");
  }
  assertSafeRunId(identity.runId);
  const directory = path.resolve(LOG_BASE, identity.groupDir, identity.carModel, identity.issueKey, identity.runId);
  const relative = path.relative(LOG_BASE, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Artifact path escapes log root");
  }
  return { identity, directory };
}