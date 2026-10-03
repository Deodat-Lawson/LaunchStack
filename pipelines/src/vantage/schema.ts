/**
 * Drizzle schema for Vantage — the evidence-backed weekly meeting loop.
 *
 * Product-side tables: they reference the engine `company` table, never the
 * reverse. They live here rather than in apps/web because a package cannot
 * import from an app, and the vertical that queries them owns them. Applied by
 * the product migration set (apps/web/drizzle).
 *
 * Six tables, one loop:
 *
 *   evidence + metric observations ──► agenda (per week) ──► topics
 *   topics ──decision──► commitments ──next week──► evidence for the next agenda
 *
 * `program_deadlines` is the one table that is not the founder's: it is what
 * an administrator puts in front of every team.
 */

import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    boolean,
    date,
    doublePrecision,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

export const VANTAGE_EVIDENCE_KINDS = [
    "note",
    "interview",
    "link",
    "task",
    "claim",
    "document",
] as const;
export type VantageEvidenceKind = (typeof VANTAGE_EVIDENCE_KINDS)[number];

export const VANTAGE_VISIBILITIES = ["private", "shared"] as const;
export type VantageVisibility = (typeof VANTAGE_VISIBILITIES)[number];

export const VANTAGE_AGENDA_STATUSES = ["draft", "ready", "held", "closed"] as const;
export type VantageAgendaStatus = (typeof VANTAGE_AGENDA_STATUSES)[number];

export const VANTAGE_TOPIC_STATUSES = ["suggested", "kept", "dismissed"] as const;
export type VantageTopicStatus = (typeof VANTAGE_TOPIC_STATUSES)[number];

export const VANTAGE_TOPIC_ORIGINS = ["ai", "rules", "founder"] as const;
export type VantageTopicOrigin = (typeof VANTAGE_TOPIC_ORIGINS)[number];

export const VANTAGE_COMMITMENT_STATUSES = ["open", "done", "missed", "dropped"] as const;
export type VantageCommitmentStatus = (typeof VANTAGE_COMMITMENT_STATUSES)[number];

/**
 * A reference from a topic to the evidence it rests on. `ref` is the pack id
 * the generator cites (`ev:<id>`, `obs:<id>`, `cm:<id>`); `label` and `date`
 * are copied at write time so a topic still reads after its source is
 * deleted, and so the agenda does not need a join per chip.
 */
export interface VantageEvidenceRef {
    ref: string;
    label: string;
    date: string | null;
}

/** One factual sentence and the sources it came from. */
export interface VantageFact {
    text: string;
    refs: VantageEvidenceRef[];
    /** True when the generator asserted it without a source the pack could confirm. */
    unsupported?: boolean;
}

/** A contradiction the generator or the rules noticed. */
export interface VantageConflict {
    text: string;
    refs: VantageEvidenceRef[];
}

export const vantageEvidence = pgTable(
    "vantage_evidence",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        kind: varchar("kind", { length: 20, enum: VANTAGE_EVIDENCE_KINDS }).notNull(),
        title: varchar("title", { length: 300 }).notNull(),
        body: text("body").notNull(),
        /** Where it came from, in words: "Call with Dana, 12 Sep", "Mixpanel". */
        source: varchar("source", { length: 300 }),
        sourceUrl: varchar("source_url", { length: 1000 }),
        /** The date the evidence is *about*, not the date it was typed in. */
        observedAt: date("observed_at").notNull(),
        visibility: varchar("visibility", { length: 10, enum: VANTAGE_VISIBILITIES })
            .notNull()
            .default("private"),
        tags: jsonb("tags")
            .$type<string[]>()
            .notNull()
            .default(sql`'[]'::jsonb`),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        index("vantage_evidence_company_observed_idx").on(table.companyId, table.observedAt),
        index("vantage_evidence_company_kind_idx").on(table.companyId, table.kind),
    ]
);

export const vantageMetricDefinitions = pgTable(
    "vantage_metric_definitions",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Stable short handle used in CSV imports and citations: `signups`. */
        key: varchar("key", { length: 64 }).notNull(),
        name: varchar("name", { length: 120 }).notNull(),
        /** What counts and what does not — the thing a deck and a dashboard disagree about. */
        definition: text("definition").notNull(),
        unit: varchar("unit", { length: 32 }).notNull().default("count"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        uniqueIndex("vantage_metric_definitions_company_key_unique").on(table.companyId, table.key),
    ]
);

export const vantageMetricObservations = pgTable(
    "vantage_metric_observations",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        metricId: varchar("metric_id", { length: 64 })
            .notNull()
            .references(() => vantageMetricDefinitions.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        value: doublePrecision("value").notNull(),
        periodStart: date("period_start").notNull(),
        periodEnd: date("period_end").notNull(),
        source: varchar("source", { length: 300 }),
        note: text("note"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [
        index("vantage_metric_observations_company_metric_period_idx").on(
            table.companyId,
            table.metricId,
            table.periodEnd
        ),
    ]
);

export const vantageAgendas = pgTable(
    "vantage_agendas",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        /** Monday of the week the meeting falls in. One agenda per week. */
        weekStart: date("week_start").notNull(),
        status: varchar("status", { length: 12, enum: VANTAGE_AGENDA_STATUSES })
            .notNull()
            .default("draft"),
        /** The generator's one-paragraph account of what changed. */
        summary: text("summary"),
        /** The signals the draft was prepared from, kept so "why" stays answerable. */
        signals: jsonb("signals").$type<Record<string, unknown> | null>(),
        modelMetadata: jsonb("model_metadata").$type<Record<string, unknown> | null>(),
        generatedAt: timestamp("generated_at", { withTimezone: true }),
        heldAt: timestamp("held_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        uniqueIndex("vantage_agendas_company_week_unique").on(table.companyId, table.weekStart),
        index("vantage_agendas_company_created_idx").on(table.companyId, table.createdAt),
    ]
);

export const vantageAgendaTopics = pgTable(
    "vantage_agenda_topics",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        agendaId: varchar("agenda_id", { length: 64 })
            .notNull()
            .references(() => vantageAgendas.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        position: integer("position").notNull().default(0),
        status: varchar("status", { length: 12, enum: VANTAGE_TOPIC_STATUSES })
            .notNull()
            .default("suggested"),
        origin: varchar("origin", { length: 12, enum: VANTAGE_TOPIC_ORIGINS }).notNull(),
        title: varchar("title", { length: 300 }).notNull(),
        /** What happened — observed facts, each with its sources. */
        facts: jsonb("facts")
            .$type<VantageFact[]>()
            .notNull()
            .default(sql`'[]'::jsonb`),
        /** Why it merits discussion: a change, contradiction, missed target, unknown. */
        whyItMatters: text("why_it_matters").notNull().default(""),
        /** The decision, phrased as the choice to make. */
        decisionQuestion: text("decision_question").notNull().default(""),
        proposedNextStep: text("proposed_next_step").notNull().default(""),
        proposedOwner: varchar("proposed_owner", { length: 200 }),
        proposedDue: date("proposed_due"),
        helpRequested: text("help_requested"),
        /** What the data does not say. Shown as "unknown", never guessed. */
        unknowns: jsonb("unknowns")
            .$type<string[]>()
            .notNull()
            .default(sql`'[]'::jsonb`),
        conflicts: jsonb("conflicts")
            .$type<VantageConflict[]>()
            .notNull()
            .default(sql`'[]'::jsonb`),
        /** Why the generator put it forward — so the founder can reject it knowingly. */
        rationale: text("rationale"),
        /** Founder's choice: an administrator or mentor may see this topic. */
        shared: boolean("shared").notNull().default(false),
        /** Recorded after the meeting. */
        decision: text("decision"),
        decidedAt: timestamp("decided_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        index("vantage_agenda_topics_agenda_position_idx").on(table.agendaId, table.position),
        index("vantage_agenda_topics_company_shared_idx").on(table.companyId, table.shared),
    ]
);

export const vantageCommitments = pgTable(
    "vantage_commitments",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        agendaId: varchar("agenda_id", { length: 64 }).references(() => vantageAgendas.id, {
            onDelete: "set null",
        }),
        topicId: varchar("topic_id", { length: 64 }).references(() => vantageAgendaTopics.id, {
            onDelete: "set null",
        }),
        title: varchar("title", { length: 300 }).notNull(),
        owner: varchar("owner", { length: 200 }).notNull(),
        dueOn: date("due_on").notNull(),
        /** The experiment or check that resolves the uncertainty. */
        test: text("test"),
        status: varchar("status", { length: 12, enum: VANTAGE_COMMITMENT_STATUSES })
            .notNull()
            .default("open"),
        /** What was learned, recorded at check-in. */
        outcome: text("outcome"),
        shared: boolean("shared").notNull().default(false),
        resolvedAt: timestamp("resolved_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        index("vantage_commitments_company_status_due_idx").on(
            table.companyId,
            table.status,
            table.dueOn
        ),
        index("vantage_commitments_agenda_idx").on(table.agendaId),
    ]
);

export const vantageProgramDeadlines = pgTable(
    "vantage_program_deadlines",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        title: varchar("title", { length: 300 }).notNull(),
        dueOn: date("due_on").notNull(),
        note: text("note"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [index("vantage_program_deadlines_company_due_idx").on(table.companyId, table.dueOn)]
);

export type VantageEvidenceRow = InferSelectModel<typeof vantageEvidence>;
export type VantageMetricDefinitionRow = InferSelectModel<typeof vantageMetricDefinitions>;
export type VantageMetricObservationRow = InferSelectModel<typeof vantageMetricObservations>;
export type VantageAgendaRow = InferSelectModel<typeof vantageAgendas>;
export type VantageAgendaTopicRow = InferSelectModel<typeof vantageAgendaTopics>;
export type VantageCommitmentRow = InferSelectModel<typeof vantageCommitments>;
export type VantageProgramDeadlineRow = InferSelectModel<typeof vantageProgramDeadlines>;
