/**
 * Drizzle schema for the distribution pipeline (design §4.3).
 *
 * Eight product tables, all company-scoped with cascade delete, prefixed
 * `pdr_ai_v2_` by the shared helper. Columns added by later migrations must
 * be declared LAST (the pg_dump parity gate compares column order).
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, date, doublePrecision, index, integer, jsonb, real, text, timestamp, uniqueIndex, varchar, } from "drizzle-orm/pg-core";
import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";
import { PARTNER_KINDS, RELATIONSHIP_STAGES, RUN_STATUSES } from "./types.js";
// ─── Programs ────────────────────────────────────────────────────────────────
export const distributionPrograms = pgTable("distribution_programs", {
    id: varchar("id", { length: 256 }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" }),
    createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    offering: text("offering").notNull(),
    categories: jsonb("categories").$type().notNull().default([]),
    hsCodes: jsonb("hs_codes").$type().notNull().default([]),
    targetTerritories: jsonb("target_territories").$type().notNull().default([]),
    partnerKinds: jsonb("partner_kinds").$type().notNull().default([]),
    constraints: text("constraints"),
    knownPartnerDomains: jsonb("known_partner_domains").$type().notNull().default([]),
    status: varchar("status", { length: 32, enum: ["active", "archived"] })
        .notNull()
        .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql `CURRENT_TIMESTAMP`)
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
}, table => ({
    companyIdx: index("distribution_programs_company_idx").on(table.companyId),
}));
// ─── Runs ────────────────────────────────────────────────────────────────────
export const distributionRuns = pgTable("distribution_runs", {
    id: varchar("id", { length: 256 }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" }),
    programId: varchar("program_id", { length: 256 })
        .notNull()
        .references(() => distributionPrograms.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 256 }).notNull(),
    status: varchar("status", { length: 32, enum: RUN_STATUSES }).notNull().default("queued"),
    options: jsonb("options").$type().notNull(),
    plan: jsonb("plan").$type(),
    summary: jsonb("summary").$type(),
    /** The shortlist the enrich stage works through, in order. */
    candidateOrgIds: jsonb("candidate_org_ids").$type(),
    creditsUsed: integer("credits_used").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql `CURRENT_TIMESTAMP`)
        .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
}, table => ({
    companyIdx: index("distribution_runs_company_idx").on(table.companyId),
    programIdx: index("distribution_runs_program_idx").on(table.programId),
    companyStatusIdx: index("distribution_runs_company_status_idx").on(table.companyId, table.status),
}));
// ─── Organisations ───────────────────────────────────────────────────────────
export const partnerOrgs = pgTable("partner_orgs", {
    id: varchar("id", { length: 256 }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" }),
    /** From @launchstack/tools/org-resolver — "d:<domain>" or "n:<name>|<cc>". */
    resolveKey: varchar("resolve_key", { length: 512 }).notNull(),
    name: varchar("name", { length: 512 }).notNull(),
    domain: varchar("domain", { length: 256 }),
    country: varchar("country", { length: 2 }),
    region: varchar("region", { length: 128 }),
    city: varchar("city", { length: 128 }),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    roles: jsonb("roles").$type().notNull().default([]),
    categories: jsonb("categories").$type().notNull().default([]),
    sizeBand: varchar("size_band", { length: 32 }),
    description: text("description"),
    /** Link to a knowledge-graph organisation entity when one matches. */
    kgEntityId: bigint("kg_entity_id", { mode: "number" }),
    firstSeenRunId: varchar("first_seen_run_id", { length: 256 }),
    lastEnrichedAt: timestamp("last_enriched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql `CURRENT_TIMESTAMP`)
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
}, table => ({
    resolveKeyUnique: uniqueIndex("partner_orgs_company_resolve_key_unique").on(table.companyId, table.resolveKey),
    companyIdx: index("partner_orgs_company_idx").on(table.companyId),
    domainIdx: index("partner_orgs_domain_idx").on(table.domain),
}));
// ─── Evidence ────────────────────────────────────────────────────────────────
export const partnerEvidence = pgTable("partner_evidence", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" }),
    orgId: varchar("org_id", { length: 256 })
        .notNull()
        .references(() => partnerOrgs.id, { onDelete: "cascade" }),
    runId: varchar("run_id", { length: 256 }).references(() => distributionRuns.id, {
        onDelete: "set null",
    }),
    kind: varchar("kind", { length: 32 }).notNull(),
    claim: text("claim").notNull(),
    sourceUrl: text("source_url").notNull(),
    quote: text("quote"),
    confidence: real("confidence").notNull().default(0.5),
    capturedAt: timestamp("captured_at", { withTimezone: true })
        .default(sql `CURRENT_TIMESTAMP`)
        .notNull(),
    provenance: jsonb("provenance").$type(),
}, table => ({
    orgIdx: index("partner_evidence_org_idx").on(table.orgId),
    companyIdx: index("partner_evidence_company_idx").on(table.companyId),
    runIdx: index("partner_evidence_run_idx").on(table.runId),
}));
// ─── Relationships ───────────────────────────────────────────────────────────
export const partnerRelationships = pgTable("partner_relationships", {
    id: varchar("id", { length: 256 }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" }),
    programId: varchar("program_id", { length: 256 })
        .notNull()
        .references(() => distributionPrograms.id, { onDelete: "cascade" }),
    orgId: varchar("org_id", { length: 256 })
        .notNull()
        .references(() => partnerOrgs.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32, enum: PARTNER_KINDS }).notNull(),
    territory: jsonb("territory").$type(),
    stage: varchar("stage", { length: 32, enum: RELATIONSHIP_STAGES })
        .notNull()
        .default("candidate"),
    fitScore: integer("fit_score"),
    fitRationale: text("fit_rationale"),
    fitBreakdown: jsonb("fit_breakdown").$type(),
    riskFlags: jsonb("risk_flags").$type().notNull().default([]),
    screening: jsonb("screening").$type(),
    dossier: jsonb("dossier").$type(),
    ownerUserId: varchar("owner_user_id", { length: 256 }),
    nextAction: text("next_action"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    dossierDocumentId: bigint("dossier_document_id", { mode: "number" }),
    source: varchar("source", { length: 16, enum: ["discovery", "manual", "import"] })
        .notNull()
        .default("discovery"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true })
        .default(sql `CURRENT_TIMESTAMP`)
        .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql `CURRENT_TIMESTAMP`)
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
}, table => ({
    programOrgKindUnique: uniqueIndex("partner_relationships_program_org_kind_unique").on(table.companyId, table.programId, table.orgId, table.kind),
    companyIdx: index("partner_relationships_company_idx").on(table.companyId),
    programIdx: index("partner_relationships_program_idx").on(table.programId),
    stageIdx: index("partner_relationships_stage_idx").on(table.companyId, table.stage),
}));
// ─── Events ──────────────────────────────────────────────────────────────────
export const relationshipEvents = pgTable("relationship_events", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" }),
    relationshipId: varchar("relationship_id", { length: 256 })
        .notNull()
        .references(() => partnerRelationships.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    payload: jsonb("payload").$type().notNull().default({}),
    actorUserId: varchar("actor_user_id", { length: 256 }),
    /** Cross-reference: a campaign id, a note id, a document id. */
    ref: varchar("ref", { length: 256 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
        .default(sql `CURRENT_TIMESTAMP`)
        .notNull(),
}, table => ({
    relationshipIdx: index("relationship_events_relationship_idx").on(table.relationshipId),
    companyIdx: index("relationship_events_company_idx").on(table.companyId),
}));
// ─── Agreements ──────────────────────────────────────────────────────────────
export const distributionAgreements = pgTable("distribution_agreements", {
    id: varchar("id", { length: 256 }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" }),
    relationshipId: varchar("relationship_id", { length: 256 })
        .notNull()
        .references(() => partnerRelationships.id, { onDelete: "cascade" }),
    territory: jsonb("territory").$type(),
    exclusivity: varchar("exclusivity", { length: 16, enum: ["none", "exclusive", "semi"] })
        .notNull()
        .default("none"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    terms: jsonb("terms").$type().notNull().default({}),
    documentId: bigint("document_id", { mode: "number" }),
    renewalReminderAt: timestamp("renewal_reminder_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql `CURRENT_TIMESTAMP`)
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
}, table => ({
    relationshipIdx: index("distribution_agreements_relationship_idx").on(table.relationshipId),
    companyIdx: index("distribution_agreements_company_idx").on(table.companyId),
}));
// ─── Market edges ────────────────────────────────────────────────────────────
export const marketEdges = pgTable("market_edges", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" }),
    fromOrgId: varchar("from_org_id", { length: 256 })
        .notNull()
        .references(() => partnerOrgs.id, { onDelete: "cascade" }),
    toOrgId: varchar("to_org_id", { length: 256 }).references(() => partnerOrgs.id, {
        onDelete: "set null",
    }),
    /** When the target is a brand rather than a resolved organisation. */
    toBrand: varchar("to_brand", { length: 256 }),
    kind: varchar("kind", {
        length: 32,
        enum: ["distributes_for", "stocks", "imports_from", "competes_with"],
    }).notNull(),
    evidenceId: bigint("evidence_id", { mode: "number" }).references(() => partnerEvidence.id, {
        onDelete: "set null",
    }),
    runId: varchar("run_id", { length: 256 }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql `CURRENT_TIMESTAMP`)
        .notNull(),
}, table => ({
    companyIdx: index("market_edges_company_idx").on(table.companyId),
    fromIdx: index("market_edges_from_idx").on(table.fromOrgId),
    brandIdx: index("market_edges_brand_idx").on(table.companyId, table.toBrand),
}));
//# sourceMappingURL=schema.js.map