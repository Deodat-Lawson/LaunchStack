/**
 * Drizzle schema for the scenarios vertical: simulated social networks and
 * Brand post tests.
 *
 * Four tables, company-scoped with cascade delete, prefixed `pdr_ai_v2_` by
 * the shared helper. The whole simulation state of a run is one JSON world
 * (`@launchstack/simulation` keeps it plain JSON), rewritten once per round.
 * Columns added by later migrations must be declared LAST.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    index,
    integer,
    jsonb,
    serial,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import type { Brief, PostReception, ScenarioReport, World } from "@launchstack/simulation";
import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

import type {
    PostTestDraft,
    RunEstimateStored,
    RunUsage,
    ScenarioSourcesInput,
    StoredEvidence,
} from "./types";
import { SCENARIO_KINDS, SCENARIO_STATUSES } from "./types";

export const scenarioRuns = pgTable(
    "scenario_runs",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        kind: varchar("kind", { length: 16, enum: SCENARIO_KINDS }).notNull(),
        title: varchar("title", { length: 200 }).notNull(),
        subject: text("subject").notNull(),
        status: varchar("status", { length: 16, enum: SCENARIO_STATUSES })
            .notNull()
            .default("queued"),
        /** Units completed; every unit commits with a compare-and-set on this. */
        step: integer("step").notNull().default(0),
        agentCount: integer("agent_count").notNull(),
        roundCount: integer("round_count").notNull(),
        seed: integer("seed").notNull(),
        sources: jsonb("sources").$type<ScenarioSourcesInput>().notNull(),
        evidence: jsonb("evidence").$type<StoredEvidence[]>(),
        brief: jsonb("brief").$type<Brief>(),
        world: jsonb("world").$type<World>(),
        report: jsonb("report").$type<ScenarioReport>(),
        reception: jsonb("reception").$type<PostReception>(),
        estimate: jsonb("estimate").$type<RunEstimateStored>().notNull(),
        usage: jsonb("usage").$type<RunUsage>().notNull(),
        /** Post tests: the tested draft and sha-256 of its normalized text. */
        draft: jsonb("draft").$type<PostTestDraft>(),
        draftHash: varchar("draft_hash", { length: 64 }),
        error: text("error"),
        /** Set when the creator shares the run with the whole workspace. */
        sharedAt: timestamp("shared_at", { withTimezone: true }),
        cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
        /** The in-process executor's claim; a stale lease lets a poll resume the run. */
        leaseUntil: timestamp("lease_until", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
        startedAt: timestamp("started_at", { withTimezone: true }),
        finishedAt: timestamp("finished_at", { withTimezone: true }),
        /**
         * Set when the final round starts, before it reads pending events.
         * Adding an event checks this under the same row lock, so an event is
         * either applied in a round or refused, never accepted and dropped.
         */
        eventsClosedAt: timestamp("events_closed_at", { withTimezone: true }),
    },
    table => [
        index("scenario_runs_company_creator_idx").on(
            table.companyId,
            table.createdByUserId,
            table.createdAt
        ),
        index("scenario_runs_company_kind_idx").on(table.companyId, table.kind, table.createdAt),
        index("scenario_runs_status_idx").on(table.status),
    ]
);
export type ScenarioRunRow = InferSelectModel<typeof scenarioRuns>;

/** Events the creator adds while a run is going; applied at the start of the next round. */
export const scenarioInjections = pgTable(
    "scenario_injections",
    {
        id: serial("id").primaryKey(),
        runId: integer("run_id")
            .notNull()
            .references(() => scenarioRuns.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        text: text("text").notNull(),
        /** The round it appeared in; null while waiting. */
        appliedRound: integer("applied_round"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [index("scenario_injections_run_idx").on(table.runId, table.appliedRound)]
);
export type ScenarioInjectionRow = InferSelectModel<typeof scenarioInjections>;

/** Questions put to a simulated person or the analyst. Private to whoever asked. */
export const scenarioInterviews = pgTable(
    "scenario_interviews",
    {
        id: serial("id").primaryKey(),
        runId: integer("run_id")
            .notNull()
            .references(() => scenarioRuns.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        askedByUserId: varchar("asked_by_user_id", { length: 256 }).notNull(),
        /** A person's id ("a3") or "analyst". */
        agentId: varchar("agent_id", { length: 32 }).notNull(),
        question: text("question").notNull(),
        answer: text("answer").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [
        index("scenario_interviews_run_asker_idx").on(
            table.runId,
            table.askedByUserId,
            table.createdAt
        ),
    ]
);
export type ScenarioInterviewRow = InferSelectModel<typeof scenarioInterviews>;

/**
 * Which post test predicted which Brand post. One test per post; testing the
 * same text again re-points the link. `brand_post_id` has no foreign key —
 * a post deleted from the calendar just drops out of the track record.
 */
export const scenarioPostLinks = pgTable(
    "scenario_post_links",
    {
        id: serial("id").primaryKey(),
        runId: integer("run_id")
            .notNull()
            .references(() => scenarioRuns.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        brandPostId: varchar("brand_post_id", { length: 64 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => [
        uniqueIndex("scenario_post_links_post_unique").on(table.brandPostId),
        index("scenario_post_links_company_idx").on(table.companyId),
    ]
);
export type ScenarioPostLinkRow = InferSelectModel<typeof scenarioPostLinks>;
