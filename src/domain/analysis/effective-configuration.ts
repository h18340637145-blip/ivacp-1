import { z } from "zod";
const paths = z.object({ json_dir: z.string(), dbc_dir: z.string(), proto_dir: z.string() });
export const configurationResolutionSchema = z.object({
    identityConflict: z.boolean().optional(), schemaVersion: z.literal(1), mode: z.enum(["auto", "manual"]), reason: z.string(),
    requested: z.object({ carModel: z.string(), basePaths: paths.optional(), modelToFiles: z.record(z.string(), z.unknown()).optional() }),
    evidence: z.object({ ticketModel: z.string(), logModels: z.array(z.string()), socVersions: z.array(z.string()), hashReason: z.string().optional(), records: z.array(z.object({ buildInfo: z.string(), socVersion: z.string(), sccVersions: z.array(z.object({ file: z.string(), version: z.string() })) })).optional() }),
    candidates: z.array(z.object({ projectName: z.string(), branchGroupName: z.string() })),
    actual: z.object({ carModel: z.string(), projectName: z.string().optional(), branchGroupName: z.string().optional(), directory: z.string().optional(), manifestFingerprint: z.string().optional(), syncedAt: z.string().optional(), targetId: z.string().optional(), headerFile: z.string().optional(), repos: z.array(z.object({ repoName: z.string(), repoPath: z.string(), gitBranchName: z.string(), commitid: z.string(), rtcids: z.array(z.string()).optional() })).optional(),
        files: z.array(z.object({ kind: z.enum(["json", "dbc", "proto", "vhal"]), source: z.string(), snapshot: z.string(), sha256: z.string() })), }),
    warnings: z.array(z.string()), summary: z.string(),
});
export type ConfigurationResolution = z.infer<typeof configurationResolutionSchema>;
