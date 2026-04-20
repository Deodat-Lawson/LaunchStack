/**
 * Knowledge Graph Schema
 *
 * Stores entities and relationships extracted from document chunks.
 * Used by the Graph RAG pipeline to provide entity-aware retrieval.
 *
 * This is a relational approach using PostgreSQL tables.
 * If Apache AGE or Neo4j is adopted later, this schema serves as the
 * migration source — the entity extraction logic is decoupled in the sidecar.
 */

import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  integer,
  serial,
  timestamp,
  varchar,
  bigint,
  uniqueIndex,
  real,
} from "drizzle-orm/pg-core";

import { pgTable } from "./helpers";
import { document } from "./base";
import { documentSections } from "./rlm-knowledge-base";

// ============================================================================
// Entity Labels
// ============================================================================

export const entityLabelEnum = [
  "PER",     // Person
  "ORG",     // Organization
  "LOC",     // Location
  "DATE",    // Date / Time
  "MONEY",   // Monetary value
  "EVENT",   // Event
  "PRODUCT", // Product
  "LAW",     // Legal reference
  "MISC",    // Miscellaneous
] as const;

export type EntityLabel = (typeof entityLabelEnum)[number];

// ============================================================================
// Relationship Types
// ============================================================================

export const relationshipTypeEnum = [
  "WORKS_FOR",
  "LOCATED_IN",
  "RELATED_TO",
  "PART_OF",
  "CREATED_BY",
  "MENTIONS",
  "REFERENCES",
  "CO_OCCURS",    // Two entities appear in the same chunk
] as const;

export type RelationshipType = (typeof relationshipTypeEnum)[number];

// ============================================================================
// 1. Knowledge Graph Entities
// ============================================================================

export const kgEntities = pgTable(
  "kg_entities",
  {
    id: serial("id").primaryKey(),
    /** Normalized lowercase name (for dedup) */
    name: varchar("name", { length: 512 }).notNull(),
    /** Original casing as extracted */
    displayName: varchar("display_name", { length: 512 }).notNull(),
    label: varchar("label", { length: 20, enum: entityLabelEnum }).notNull(),
    /** Average extraction confidence across all mentions */
    confidence: real("confidence").notNull().default(0),
    /** Number of times this entity was mentioned across all chunks */
    mentionCount: integer("mention_count").notNull().default(1),
    /** Company scope — entities are company-specific */
    companyId: bigint("company_id", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => ({
    nameCompanyIdx: uniqueIndex("kg_entities_name_company_idx").on(
      table.name,
      table.label,
      table.companyId,
    ),
    labelIdx: index("kg_entities_label_idx").on(table.label),
    companyIdx: index("kg_entities_company_idx").on(table.companyId),
    nameIdx: index("kg_entities_name_idx").on(table.name),
  }),
);

// ============================================================================
// 2. Entity Mentions (links entities to document sections)
// ============================================================================

export const kgEntityMentions = pgTable(
  "kg_entity_mentions",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => kgEntities.id, { onDelete: "cascade" }),
    sectionId: integer("section_id")
      .notNull()
      .references(() => documentSections.id, { onDelete: "cascade" }),
    documentId: bigint("document_id", { mode: "bigint" })
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    /** Confidence score for this specific mention */
    confidence: real("confidence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    entityIdx: index("kg_mentions_entity_idx").on(table.entityId),
    sectionIdx: index("kg_mentions_section_idx").on(table.sectionId),
    documentIdx: index("kg_mentions_document_idx").on(table.documentId),
    entitySectionUnique: uniqueIndex("kg_mentions_entity_section_unique").on(
      table.entityId,
      table.sectionId,
    ),
  }),
);

// ============================================================================
// 3. Relationships (edges between entities)
// ============================================================================

export const kgRelationships = pgTable(
  "kg_relationships",
  {
    id: serial("id").primaryKey(),
    sourceEntityId: integer("source_entity_id")
      .notNull()
      .references(() => kgEntities.id, { onDelete: "cascade" }),
    targetEntityId: integer("target_entity_id")
      .notNull()
      .references(() => kgEntities.id, { onDelete: "cascade" }),
    relationshipType: varchar("relationship_type", {
      length: 30,
      enum: relationshipTypeEnum,
    }).notNull(),
    /** Strength/weight of the relationship (0-1) */
    weight: real("weight").notNull().default(0.5),
    /** Number of co-occurrences supporting this relationship */
    evidenceCount: integer("evidence_count").notNull().default(1),
    /** Source document where relationship was first observed */
    documentId: bigint("document_id", { mode: "bigint" }).references(
      () => document.id,
      { onDelete: "set null" },
    ),
    companyId: bigint("company_id", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => ({
    sourceIdx: index("kg_rel_source_idx").on(table.sourceEntityId),
    targetIdx: index("kg_rel_target_idx").on(table.targetEntityId),
    typeIdx: index("kg_rel_type_idx").on(table.relationshipType),
    companyIdx: index("kg_rel_company_idx").on(table.companyId),
    sourceTargetUnique: uniqueIndex("kg_rel_source_target_type_unique").on(
      table.sourceEntityId,
      table.targetEntityId,
      table.relationshipType,
    ),
  }),
);

// ============================================================================
// Relations
// ============================================================================

export const kgEntitiesRelations = relations(kgEntities, ({ many }) => ({
  mentions: many(kgEntityMentions),
  outgoingRelationships: many(kgRelationships, {
    relationName: "source_relationships",
  }),
  incomingRelationships: many(kgRelationships, {
    relationName: "target_relationships",
  }),
}));

export const kgEntityMentionsRelations = relations(
  kgEntityMentions,
  ({ one }) => ({
    entity: one(kgEntities, {
      fields: [kgEntityMentions.entityId],
      references: [kgEntities.id],
    }),
    section: one(documentSections, {
      fields: [kgEntityMentions.sectionId],
      references: [documentSections.id],
    }),
    document: one(document, {
      fields: [kgEntityMentions.documentId],
      references: [document.id],
    }),
  }),
);

export const kgRelationshipsRelations = relations(
  kgRelationships,
  ({ one }) => ({
    source: one(kgEntities, {
      fields: [kgRelationships.sourceEntityId],
      references: [kgEntities.id],
      relationName: "source_relationships",
    }),
    target: one(kgEntities, {
      fields: [kgRelationships.targetEntityId],
      references: [kgEntities.id],
      relationName: "target_relationships",
    }),
    document: one(document, {
      fields: [kgRelationships.documentId],
      references: [document.id],
    }),
  }),
);

// ============================================================================
// Type Exports
// ============================================================================

export type KGEntity = InferSelectModel<typeof kgEntities>;
export type KGEntityMention = InferSelectModel<typeof kgEntityMentions>;
export type KGRelationship = InferSelectModel<typeof kgRelationships>;
