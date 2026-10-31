import { z } from "zod";
const status = z.enum(["ok", "unknown", "ambiguous", "skipped"]);
const hitSchema = z.object({ sheet: z.string(), row: z.number(), column: z.string(), value: z.string(), project: z.string() });
const hashCandidateSchema = z.object({ rawHash: z.string(), commitPrefix: z.string(), buildDate: z.string(), file: z.string(), line: z.number(), rawLine: z.string() });
const commitCandidateSchema = z.object({ projectName: z.string(), branchGroupName: z.string(), repoName: z.string(), repoPath: z.string(), gitBranchName: z.string(), commitid: z.string(), rtcids: z.array(z.string()) });
const vsCandidateSchema = commitCandidateSchema.extend({ matchedRtcids: z.array(z.string()) });
export const versionVhalCheckSchema = z.object({
    schemaVersion: z.literal(1), runId: z.string().optional(), issueKey: z.string(), source: z.string(), recordedAt: z.string(),
    socScc: z.object({
        result: z.enum(["matched", "mismatched", "unknown"]),
        pairs: z.array(z.object({ buildInfo: z.string(), sccFile: z.string(), socRaw: z.string(), sccRaw: z.string(), socVersion: z.string().nullable(), sccVersion: z.string().nullable(), result: z.enum(["matched", "mismatched", "unknown"]), reason: z.string() })),
    }),
    resolution: z.object({
        status, reason: z.string(),
        hashes: z.array(hashCandidateSchema),
        selectedHash: hashCandidateSchema.optional(),
        candidates: z.array(commitCandidateSchema),
        // Optional for results written before RTC-to-VS association was introduced.
        vsAssociation: z.object({ status, reason: z.string(), candidates: z.array(vsCandidateSchema), selected: vsCandidateSchema.optional(), unmatchedRtcids: z.array(z.string()) }).optional(),
        archives: z.array(z.object({ file: z.string(), code: z.string(), commitCandidates: z.array(z.string()).optional() })),
        version: z.string().optional(), platform: z.string().optional(), excel: z.string().optional(), excelSha256: z.string().optional(),
    }),
    config: z.object({
        status, model: z.string().optional(), dbcs: z.array(z.string()), stop: z.boolean(),
        signals: z.array(z.object({ signal: z.string(), status: z.enum(["configured", "signal_missing", "model_not_configured", "unknown"]), caseMismatch: z.boolean(), hits: z.array(hitSchema), caseCandidates: z.array(hitSchema) })),
    }),
    warnings: z.array(z.string()), stopReason: z.enum(["version_mismatch", "all_signals_missing"]).optional(), summary: z.string(),
});
export type VersionVhalCheck = z.infer<typeof versionVhalCheckSchema>;
export type HashCandidate = VersionVhalCheck["resolution"]["hashes"][number];
export type CommitCandidate = VersionVhalCheck["resolution"]["candidates"][number];
export type SignalCheck = VersionVhalCheck["config"]["signals"][number];
