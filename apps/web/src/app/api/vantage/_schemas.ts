/**
 * Request schemas for `/api/vantage/*`, in one place because Next allows a
 * route file to export only its handlers. Messages are the words the form
 * shows next to the control.
 */
import { z } from "zod";

import {
    VANTAGE_COMMITMENT_STATUSES,
    VANTAGE_EVIDENCE_KINDS,
    VANTAGE_VISIBILITIES,
    isIsoDate,
} from "@launchstack/pipelines/vantage";

export const isoDate = z.string().refine(isIsoDate, "must be a date (YYYY-MM-DD)");

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const EvidenceSchema = z.object({
    kind: z.enum(VANTAGE_EVIDENCE_KINDS),
    title: z.string().trim().min(1, "give it a title").max(300),
    body: z.string().trim().min(1, "write what happened").max(40_000),
    source: optionalText(300),
    sourceUrl: z
        .union([z.string().trim().url().max(1000), z.literal("")])
        .optional()
        .nullable(),
    observedAt: isoDate,
    visibility: z.enum(VANTAGE_VISIBILITIES).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

export const MetricDefinitionSchema = z.object({
    key: z.string().trim().max(64).optional(),
    name: z.string().trim().min(1, "name the metric").max(120),
    definition: z.string().trim().min(1, "say what counts").max(2000),
    unit: z.string().trim().max(32).optional(),
});

export const ObservationSchema = z
    .object({
        metricId: z.string().min(1),
        value: z.number().finite(),
        periodStart: isoDate,
        periodEnd: isoDate,
        source: optionalText(300),
        note: optionalText(2000),
    })
    .refine(o => o.periodEnd >= o.periodStart, {
        message: "the period ends before it starts",
        path: ["periodEnd"],
    });

export const ImportSchema = z.object({
    csv: z.string().min(1, "paste or choose a CSV").max(2_000_000),
    source: optionalText(300),
});

export const RefSchema = z.object({
    ref: z.string().min(1).max(80),
    label: z.string().max(300),
    date: z.string().nullable(),
});

export const FactSchema = z.object({
    text: z.string().trim().min(1).max(600),
    refs: z.array(RefSchema).max(8),
    unsupported: z.boolean().optional(),
});

export const TopicSchema = z.object({
    title: z.string().trim().min(1, "give the topic a title").max(300),
    facts: z.array(FactSchema).max(8).optional(),
    whyItMatters: z.string().trim().max(2000).optional(),
    decisionQuestion: z.string().trim().max(1000).optional(),
    proposedNextStep: z.string().trim().max(1000).optional(),
    proposedOwner: optionalText(200),
    proposedDue: z
        .union([isoDate, z.literal("")])
        .optional()
        .nullable(),
    helpRequested: optionalText(1000),
    unknowns: z.array(z.string().trim().max(300)).max(8).optional(),
    conflicts: z
        .array(
            z.object({ text: z.string().trim().min(1).max(600), refs: z.array(RefSchema).max(8) })
        )
        .max(6)
        .optional(),
    shared: z.boolean().optional(),
});

export const TopicPatchSchema = TopicSchema.partial().extend({
    status: z.enum(["kept", "dismissed", "suggested"]).optional(),
});

export const DecisionSchema = z.object({
    decision: z.string().trim().min(1, "write the decision").max(2000),
    commitment: z
        .object({
            title: z.string().trim().min(1, "name the action").max(300),
            owner: z.string().trim().min(1, "name an owner").max(200),
            dueOn: isoDate,
            test: optionalText(1000),
            shared: z.boolean().optional(),
        })
        .nullable(),
});

export const CommitmentSchema = z.object({
    title: z.string().trim().min(1, "name the action").max(300),
    owner: z.string().trim().min(1, "name an owner").max(200),
    dueOn: isoDate,
    test: optionalText(1000),
    shared: z.boolean().optional(),
    agendaId: z.string().optional().nullable(),
    topicId: z.string().optional().nullable(),
});

export const CommitmentPatchSchema = CommitmentSchema.omit({ agendaId: true, topicId: true })
    .partial()
    .extend({
        status: z.enum(VANTAGE_COMMITMENT_STATUSES).optional(),
        outcome: optionalText(2000),
    });

export const DeadlineSchema = z.object({
    title: z.string().trim().min(1, "name the deadline").max(300),
    dueOn: isoDate,
    note: optionalText(1000),
});

export const ReorderSchema = z.object({ ids: z.array(z.string().min(1)).max(50) });

export const AgendaStatusSchema = z.object({
    status: z.enum(["draft", "ready", "held", "closed"]),
});

export const PrepareSchema = z.object({ weekStart: isoDate.optional() });
