/**
 * Event payload schemas for the repo-workspace Inngest events. Bigints
 * travel as strings — event payloads must be JSON.
 */

import { z } from "zod";

export const RepoWorkspaceSyncEventDataSchema = z.object({
    workspaceId: z.string().min(1),
    syncRequestId: z.string().min(1).optional(),
});

export const RepoExplainerJobEventDataSchema = z.object({
    jobId: z.string().min(1),
    workspaceId: z.string().min(1),
    companyId: z.string().min(1),
    /** Auth id of whoever asked; their AI allowance is charged. Absent on older events. */
    userId: z.string().min(1).optional(),
});
