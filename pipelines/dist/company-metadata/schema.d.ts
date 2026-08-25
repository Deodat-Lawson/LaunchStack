/**
 * Company Metadata Schema
 *
 * Stores a canonical per-company metadata JSON derived from uploaded documents.
 * Used downstream by LLMs generating outreach messages / posts.
 *
 * - `companyMetadata` — one row per company, holds the current canonical JSON.
 * - `companyMetadataHistory` — append-only audit log of every mutation.
 */
import type { InferSelectModel } from "drizzle-orm";
export declare const CHANGE_TYPE_VALUES: readonly ["extraction", "merge", "manual_override", "deprecation"];
export type ChangeType = (typeof CHANGE_TYPE_VALUES)[number];
export type Visibility = "public" | "partner" | "private" | "internal";
export type Usage = "outreach_ok" | "outreach_ok_with_approval" | "no_outreach";
export type Priority = "manual_override" | "high" | "normal" | "low";
export type FactStatus = "active" | "deprecated" | "superseded";
export interface MetadataSource {
    doc_id: number;
    doc_name: string;
    extracted_at: string;
    /**
     * The document version the fact was read from. Required for a fact to
     * produce a valid citation anchor; absent on facts extracted before the
     * field existed, which stay document-level rather than inventing one.
     */
    version_id?: number;
    snippet_ref?: string;
    page?: number;
    /** Verbatim supporting text, when the extractor captured one. */
    quote?: string;
}
export interface MetadataFact<T = string> {
    value: T;
    visibility: Visibility;
    usage: Usage;
    confidence: number;
    priority: Priority;
    status: FactStatus;
    last_updated: string;
    valid_from?: string;
    valid_to?: string;
    sources: MetadataSource[];
}
export interface CompanyInfo {
    name?: MetadataFact;
    industry?: MetadataFact;
    founded_year?: MetadataFact<number>;
    headquarters?: MetadataFact;
    description?: MetadataFact;
    website?: MetadataFact;
    size?: MetadataFact;
    [key: string]: MetadataFact<unknown> | undefined;
}
export interface PersonEntry {
    name: MetadataFact;
    role?: MetadataFact;
    email?: MetadataFact;
    phone?: MetadataFact;
    department?: MetadataFact;
    [key: string]: MetadataFact<unknown> | undefined;
}
export interface ServiceEntry {
    name: MetadataFact;
    description?: MetadataFact;
    status?: MetadataFact;
    [key: string]: MetadataFact<unknown> | undefined;
}
export interface MarketsInfo {
    primary?: MetadataFact[];
    verticals?: MetadataFact[];
    geographies?: MetadataFact[];
}
export interface SubprojectEntry {
    name: MetadataFact;
    description?: MetadataFact;
    status?: MetadataFact;
}
export interface ProjectEntry {
    name: MetadataFact;
    description?: MetadataFact;
    status?: MetadataFact;
    subprojects?: SubprojectEntry[];
    [key: string]: MetadataFact<unknown> | SubprojectEntry[] | undefined;
}
export interface LegalEntry {
    name: MetadataFact;
    type?: MetadataFact;
    summary?: MetadataFact;
    effective_date?: MetadataFact;
    expiry_date?: MetadataFact;
    parties?: MetadataFact;
    status?: MetadataFact;
    [key: string]: MetadataFact<unknown> | undefined;
}
export interface ProvenanceInfo {
    total_documents_processed: number;
    last_document_processed?: {
        doc_id: number;
        doc_name: string;
        processed_at: string;
    };
    extraction_model: string;
    extraction_version: string;
}
export interface CompanyMetadataJSON {
    schema_version: string;
    company_id: string;
    updated_at: string;
    company: CompanyInfo;
    people: PersonEntry[];
    services: ServiceEntry[];
    markets: MarketsInfo;
    projects: ProjectEntry[];
    policies: Record<string, MetadataFact>;
    legal: LegalEntry[];
    provenance: ProvenanceInfo;
    derived_views?: Record<string, string>;
}
export interface DiffEntry {
    path: string;
    old?: MetadataFact<unknown>;
    new?: MetadataFact<unknown>;
}
export interface MetadataDiff {
    added: DiffEntry[];
    updated: DiffEntry[];
    deprecated: DiffEntry[];
}
export declare const companyMetadata: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "company_metadata";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "company_metadata";
            dataType: "number";
            columnType: "PgBigSerial53";
            data: number;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        companyId: import("drizzle-orm/pg-core").PgColumn<{
            name: "company_id";
            tableName: "company_metadata";
            dataType: "bigint";
            columnType: "PgBigInt64";
            data: bigint;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        schemaVersion: import("drizzle-orm/pg-core").PgColumn<{
            name: "schema_version";
            tableName: "company_metadata";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 20;
        }>;
        metadata: import("drizzle-orm/pg-core").PgColumn<{
            name: "metadata";
            tableName: "company_metadata";
            dataType: "json";
            columnType: "PgJsonb";
            data: CompanyMetadataJSON;
            driverParam: unknown;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: CompanyMetadataJSON;
        }>;
        lastExtractionDocumentId: import("drizzle-orm/pg-core").PgColumn<{
            name: "last_extraction_document_id";
            tableName: "company_metadata";
            dataType: "bigint";
            columnType: "PgBigInt64";
            data: bigint;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "company_metadata";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        updatedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "updated_at";
            tableName: "company_metadata";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: false;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export declare const companyMetadataHistory: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "company_metadata_history";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "company_metadata_history";
            dataType: "number";
            columnType: "PgBigSerial53";
            data: number;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        companyId: import("drizzle-orm/pg-core").PgColumn<{
            name: "company_id";
            tableName: "company_metadata_history";
            dataType: "bigint";
            columnType: "PgBigInt64";
            data: bigint;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        documentId: import("drizzle-orm/pg-core").PgColumn<{
            name: "document_id";
            tableName: "company_metadata_history";
            dataType: "bigint";
            columnType: "PgBigInt64";
            data: bigint;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        changeType: import("drizzle-orm/pg-core").PgColumn<{
            name: "change_type";
            tableName: "company_metadata_history";
            dataType: "string";
            columnType: "PgVarchar";
            data: "extraction" | "merge" | "manual_override" | "deprecation";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["extraction", "merge", "manual_override", "deprecation"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 32;
        }>;
        diff: import("drizzle-orm/pg-core").PgColumn<{
            name: "diff";
            tableName: "company_metadata_history";
            dataType: "json";
            columnType: "PgJsonb";
            data: MetadataDiff;
            driverParam: unknown;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: MetadataDiff;
        }>;
        changedBy: import("drizzle-orm/pg-core").PgColumn<{
            name: "changed_by";
            tableName: "company_metadata_history";
            dataType: "string";
            columnType: "PgVarchar";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: 256;
        }>;
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "company_metadata_history";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export declare const companyMetadataRelations: import("drizzle-orm").Relations<"company_metadata", {
    company: import("drizzle-orm").One<"company", true>;
    lastExtractionDocument: import("drizzle-orm").One<"document", false>;
}>;
export declare const companyMetadataHistoryRelations: import("drizzle-orm").Relations<"company_metadata_history", {
    company: import("drizzle-orm").One<"company", true>;
    document: import("drizzle-orm").One<"document", false>;
}>;
export type CompanyMetadataRow = InferSelectModel<typeof companyMetadata>;
export type CompanyMetadataHistoryRow = InferSelectModel<typeof companyMetadataHistory>;
//# sourceMappingURL=schema.d.ts.map