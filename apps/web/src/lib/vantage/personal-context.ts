import { z } from "zod";
import type {
    BusinessRoleContextV0,
    ContextScopeV0,
    ContextSourceEntryV0,
} from "@launchstack/pipelines/vantage/context-v0";
import {
    canonicalRoleV0,
    type PersonalContextStateV0,
    type RequiredContextDiagnosticsV0,
} from "@launchstack/pipelines/vantage/role-context-v0";

export const contextRevisionSchema = z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1);
export const contextDocumentIdSchema = z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine(value => Number.isSafeInteger(Number(value)));
export const saveContextRolesSchema = z
    .object({
        expectedRevision: contextRevisionSchema,
        roleIds: z.array(z.string().refine(value => canonicalRoleV0(value) === value)).max(4),
        primaryRoleId: z.string().optional(),
    })
    .strict()
    .refine(value => !value.primaryRoleId || value.roleIds.includes(value.primaryRoleId), {
        message: "Select the primary responsibility from your roles.",
    });
export const setContextStarSchema = z
    .object({
        starred: z.boolean(),
        expectedRevision: contextRevisionSchema,
    })
    .strict();

/** Personal inputs only. The generation assembler adds canonical company and retrieval context. */
export interface PersonalContextSnapshotV0 {
    version: "vantage-personal-snapshot-v0";
    id: string;
    asOf: string;
    actor: ContextScopeV0;
    revision: number;
    roles: BusinessRoleContextV0;
    sources: ContextSourceEntryV0[];
}
export interface PersonalContextViewV0 {
    state: PersonalContextStateV0;
    roles: BusinessRoleContextV0;
    documents: { id: string; title: string; version: string; sourceDate: string }[];
    diagnostics: RequiredContextDiagnosticsV0;
    ready: boolean;
    /** Absent for the older full-context synthetic preview. */
    scope?: "personal";
    snapshot?: PersonalContextSnapshotV0 | null;
}
