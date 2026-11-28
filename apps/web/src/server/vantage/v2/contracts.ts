import { z } from "zod";
import type { VantageTaskResult } from "./execute";
export const SettingsInput = z
    .object({
        goals: z.array(z.string().trim().min(1).max(600)).max(10),
        personaIds: z.array(z.string().min(1).max(64)).max(12),
    })
    .strict();
export const TaskInput = z
    .object({
        topicId: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(3000),
        acceptanceCriterion: z.string().trim().min(1).max(1000),
        workType: z.enum(["analysis", "comparison", "draft", "human_action"]),
        priority: z.enum(["low", "medium", "high"]),
        assigneeType: z.enum(["owner", "persona"]),
        assigneeId: z.string().min(1).max(200),
        refs: z.array(z.string().max(200)).max(8),
    })
    .strict();
export const TaskPatch = TaskInput.omit({ topicId: true, refs: true, assigneeId: true })
    .partial()
    .extend({ assigneeId: z.string().max(200).optional() })
    .extend({ expectedVersion: z.number().int().positive() })
    .strict();
export const ActionInput = z
    .object({
        action: z.enum(["run", "accept", "rework", "cancel", "complete"]),
        expectedVersion: z.number().int().positive(),
        result: z.string().max(12000).optional(),
    })
    .strict();
export type TaskStatus =
    | "proposed"
    | "queued"
    | "running"
    | "submitted"
    | "completed"
    | "cancelled"
    | "failed"
    | "blocked";
type TaskSpec = z.infer<typeof TaskInput>;
export type VantageTask = Omit<TaskSpec, "workType"> & {
    /** Older encrypted specs predate work-type persistence. */
    workType?: TaskSpec["workType"];
    id: string;
    parentId: string | null;
    version: number;
    status: TaskStatus;
    provenance: "proposal" | "grounded";
    result?: string;
    structuredResult?: VantageTaskResult;
    reason?: string;
    latestAttempt?: {
        id: string;
        number: number;
        status: TaskStatus;
        reason?: string;
        leaseUntil: string | null;
    };
};
export interface VantagePlan {
    id: string;
    reviewId: string;
    version: number;
    hash: string;
    approvedVersion: number | null;
    approvedHash: string | null;
    tasks: VantageTask[];
    discarded: { reason: string }[];
}
