/**
 * Event payload schemas for the repo-workspace Inngest events. Bigints
 * travel as strings — event payloads must be JSON.
 */
import { z } from "zod";
export declare const RepoWorkspaceSyncEventDataSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    syncRequestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    workspaceId: string;
    syncRequestId?: string | undefined;
}, {
    workspaceId: string;
    syncRequestId?: string | undefined;
}>;
export declare const RepoExplainerJobEventDataSchema: z.ZodObject<{
    jobId: z.ZodString;
    workspaceId: z.ZodString;
    companyId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    companyId: string;
    jobId: string;
    workspaceId: string;
}, {
    companyId: string;
    jobId: string;
    workspaceId: string;
}>;
//# sourceMappingURL=events.d.ts.map