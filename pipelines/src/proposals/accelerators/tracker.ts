import { z } from "zod";

import { AcceleratorError } from "./types";

export const TrackerPrioritySchema = z.enum(["low", "medium", "high"]);
export const TrackerStatusSchema = z.enum([
    "shortlisted",
    "preparing",
    "applied",
    "interviewing",
    "accepted",
    "rejected",
    "withdrawn",
]);
export type TrackerPriority = z.infer<typeof TrackerPrioritySchema>;
export type TrackerStatus = z.infer<typeof TrackerStatusSchema>;
const id = z.string().trim().min(1).max(64);
const dateOnly = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(value => {
        const date = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "Use a real calendar date (YYYY-MM-DD)");
const opportunityFields = {
    cycleId: id.nullable(),
    priority: TrackerPrioritySchema,
    status: TrackerStatusSchema,
    notes: z.string().max(100_000),
    submittedOn: dateOnly.nullable(),
    nextAction: z.string().trim().max(4_000).nullable(),
    plannedDeadline: z.string().datetime({ offset: true }).nullable(),
    plannedDeadlineOn: dateOnly.nullable(),
};

/** Saving is idempotent; edits to an existing opportunity use PATCH instead. */
export const SaveTrackerOpportunitySchema = z
    .object({
        programId: id,
        cycleId: id.nullable().optional(),
    })
    .strict();
export const UpdateTrackerOpportunitySchema = z
    .object(opportunityFields)
    .partial()
    .strict()
    .refine(value => Object.keys(value).length > 0, "Supply at least one field");
const taskFields = {
    title: z.string().trim().min(1).max(4_000),
    dueOn: dateOnly.nullable(),
    priority: TrackerPrioritySchema,
    done: z.boolean(),
};
export const CreateTrackerTaskSchema = z
    .object({
        title: taskFields.title,
        dueOn: taskFields.dueOn.optional(),
        priority: taskFields.priority.optional(),
        done: taskFields.done.optional(),
    })
    .strict();
export const UpdateTrackerTaskSchema = z
    .object(taskFields)
    .partial()
    .strict()
    .refine(value => Object.keys(value).length > 0, "Supply at least one field");
export type SaveTrackerOpportunity = z.infer<typeof SaveTrackerOpportunitySchema>;
export type UpdateTrackerOpportunity = z.infer<typeof UpdateTrackerOpportunitySchema>;
export type CreateTrackerTask = z.infer<typeof CreateTrackerTaskSchema>;
export type UpdateTrackerTask = z.infer<typeof UpdateTrackerTaskSchema>;

export interface TrackerTask {
    id: string;
    opportunityId: string;
    title: string;
    dueOn: string | null;
    priority: TrackerPriority;
    done: boolean;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface TrackerOpportunity {
    id: string;
    programId: string;
    cycleId: string | null;
    priority: TrackerPriority;
    status: TrackerStatus;
    notes: string;
    submittedOn: string | null;
    nextAction: string | null;
    /** The deadline planned against when the cycle was chosen: an instant, or a date the Program gave without a time. */
    plannedDeadline: string | null;
    plannedDeadlineOn: string | null;
    createdAt: string;
    updatedAt: string;
    tasks: TrackerTask[];
}

/** A cycle's official deadline at the moment it is tracked; at most one side is set. */
export interface OfficialDeadline {
    at: string | null;
    on: string | null;
}

/** Called under the company/Program transaction lock; cycles never replace past outcomes. */
export function selectTrackerOpportunity<T extends { cycleId: string | null }>(
    opportunities: readonly T[],
    cycleId: string | null
): { kind: "existing" | "upgrade"; opportunity: T } | { kind: "create" } {
    const existing = opportunities.find(opportunity => opportunity.cycleId === cycleId);
    if (existing) return { kind: "existing", opportunity: existing };
    if (cycleId !== null) {
        const programOnly = opportunities.find(opportunity => opportunity.cycleId === null);
        if (programOnly) return { kind: "upgrade", opportunity: programOnly };
    }
    return { kind: "create" };
}

export function assertTrackerCycleChange(current: string | null, next: string | null): void {
    if (current !== null && current !== next) {
        throw new AcceleratorError(
            "Save a separate opportunity for another cycle",
            409,
            "cycle_locked"
        );
    }
}

/** An unchanged completed task keeps its original completion time. */
export function trackerCompletionTime(
    done: boolean,
    completedAt: Date | null,
    nextDone: boolean | undefined,
    now: Date
): Date | null {
    if (nextDone === undefined || nextDone === done) return completedAt;
    return nextDone ? now : null;
}
