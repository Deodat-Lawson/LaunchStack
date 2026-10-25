/** Opt-in, read-only company-profile host. Default Vantage generation never imports it. */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { category, document, documentVersions } from "@launchstack/store/schema";
import { companyMetadata, companyProfileSources } from "@launchstack/tools/company-context/schema";
import type { CompanyMetadataJSON } from "@launchstack/tools/company-context/schema";
import {
    collectCompanyArchitectureDocumentIds,
    projectCompanyArchitectureV0,
    type CompanyArchitectureDocumentStateV0,
    type CompanyArchitectureProjectionResultV0,
    type CompanyArchitectureReadSnapshotV0,
    type ContextBudgetsV0,
    type ContextReportWindowV0,
    type ContextScopeV0,
} from "@launchstack/pipelines/vantage/context-v0";
import { resolveDocumentScope, scopedDocumentWhere, scopeAllows } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import {
    documentGrants,
    documentSettings,
    folderGrants,
    folderSettings,
    users,
    userCompanyMemberships,
    workspaceGroupMembers,
    workspaceGroups,
    workspaceRoles,
} from "~/server/db/schema";

export const COMPANY_ARCHITECTURE_MAX_PROFILE_BYTES = 1024 * 1024;
export const COMPANY_ARCHITECTURE_MAX_DOCUMENTS = 128;
const MAX_SOURCE_ROW_BYTES = 64 * 1024;
const MAX_HOST_TIMEOUT_MS = 5000;
type Database = typeof db;
export type CompanyArchitectureTransactionV0 = Parameters<
    Parameters<Database["transaction"]>[0]
>[0];
type Reader = Pick<Database, "select" | "execute">;
type Dependencies = {
    resolveWorkspace?: typeof requireWorkspaceContext;
    database?: Database;
    resolveScope?: typeof resolveDocumentScope;
    now?: () => Date;
};
export class CompanyArchitectureHostErrorV0 extends Error {
    constructor(
        readonly code: string,
        readonly status: 400 | 401 | 403 | 409 | 503
    ) {
        super(
            status === 409
                ? "Company architecture context changed; capture it again."
                : "Company architecture context is unavailable."
        );
        this.name = "CompanyArchitectureHostErrorV0";
    }
}
export interface CapturedCompanyArchitectureV0 {
    actor: ContextScopeV0;
    projection: CompanyArchitectureProjectionResultV0;
    snapshotFingerprint: string;
    reportWindow: ContextReportWindowV0;
    budgets: ContextBudgetsV0;
}
type Pin = { authUserId: string; userPk: string; companyId: string };
type PrivateCapture = {
    pin: Pin;
    params: { reportWindow: ContextReportWindowV0; budgets: ContextBudgetsV0 };
    fingerprint: string;
};
const fail = (code: string, status: 400 | 401 | 403 | 409 | 503): never => {
    throw new CompanyArchitectureHostErrorV0(code, status);
};
const canonical = (value: unknown): unknown => {
    if (typeof value === "bigint") return { $bigint: value.toString() };
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, child]) => [key, canonical(child)])
        );
    return value;
};
const hash = (value: unknown) =>
    createHash("sha256")
        .update(JSON.stringify(canonical(value)))
        .digest("hex");
function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}
const instant = (value: Date | null | undefined) => value?.toISOString() ?? null;
function normalizeScope(scope: DocumentScope): DocumentScope {
    if (scope.kind === "everything") return { kind: "everything" };
    if (scope.kind !== "except" && scope.kind !== "only")
        return fail("invalid_document_scope", 503);
    const ids = (values: readonly number[]) => {
        if (!values.every(value => Number.isSafeInteger(value) && value > 0))
            fail("invalid_document_scope", 503);
        return [...new Set(values)].sort((a, b) => a - b);
    };
    const paths = (values: readonly string[]) => {
        if (!values.every(value => typeof value === "string" && value.length <= 256))
            fail("invalid_document_scope", 503);
        return [...new Set(values)].sort();
    };
    const result: DocumentScope = {
        kind: scope.kind,
        deniedCategories: paths(scope.deniedCategories ?? []),
        allowedCategories: paths(scope.allowedCategories ?? []),
        deniedDocumentIds: ids(scope.deniedDocumentIds),
        allowedDocumentIds: ids(scope.allowedDocumentIds),
    };
    if (Buffer.byteLength(JSON.stringify(result)) > COMPANY_ARCHITECTURE_MAX_PROFILE_BYTES)
        fail("scope_limit", 503);
    return result;
}
function params(input: { reportWindow: ContextReportWindowV0; budgets: ContextBudgetsV0 }) {
    const copy = structuredClone(input);
    const { reportWindow: window, budgets } = copy;
    if (
        !window ||
        ![window.startInclusive, window.endExclusive, window.asOf].every(value =>
            Number.isFinite(Date.parse(value))
        ) ||
        Date.parse(window.startInclusive) >= Date.parse(window.endExclusive)
    )
        fail("invalid_report_window", 400);
    if (
        !budgets ||
        (["maxSources", "maxExcerptChars", "timeoutMs", "maxQueries", "maxTokens"] as const).some(
            key =>
                typeof budgets[key] !== "number" ||
                !Number.isSafeInteger(budgets[key]) ||
                budgets[key] < 1
        ) ||
        budgets.maxQueries < 3
    )
        fail("invalid_host_budget", 400);
    return freeze(copy);
}
async function bounded<T>(work: (check: () => void) => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const check = () => {
        if (expired) fail("host_timeout", 503);
    };
    try {
        return await Promise.race([
            work(check),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    expired = true;
                    reject(new CompanyArchitectureHostErrorV0("host_timeout", 503));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Server functions are injectable for synthetic tests, never populated from request JSON. */
export function createCompanyArchitectureAdapterV0(deps: Dependencies = {}) {
    const database = deps.database ?? db;
    const resolveWorkspace = deps.resolveWorkspace ?? requireWorkspaceContext;
    const resolveScope = deps.resolveScope ?? resolveDocumentScope;
    const now = deps.now ?? (() => new Date());
    const captures = new WeakMap<CapturedCompanyArchitectureV0, PrivateCapture>();
    const ownedTransactions = new WeakSet<object>();

    async function read(
        input: PrivateCapture["params"],
        reader: Reader,
        expectedPin?: Pin,
        check: () => void = () => undefined
    ) {
        check();
        const auth = await resolveWorkspace();
        check();
        if (!auth.success)
            return fail(
                "workspace_authorization",
                auth.response.status === 401 ? 401 : auth.response.status === 403 ? 403 : 503
            );
        // Pin primitive identity and copy permissions BEFORE any subsequent await. A
        // caller cannot mutate a WorkspaceContext or its ReadonlySet behind this read.
        const ctx = auth.data;
        const pin = freeze({
            authUserId: ctx.authUserId,
            userPk: String(ctx.userPk),
            companyId: String(ctx.companyId),
        });
        const role = ctx.role,
            status = ctx.status,
            permissions = new Set(ctx.permissions);
        if (
            typeof ctx.userPk !== "bigint" ||
            typeof ctx.companyId !== "bigint" ||
            !pin.authUserId ||
            !/^[1-9]\d*$/.test(pin.userPk) ||
            !/^[1-9]\d*$/.test(pin.companyId) ||
            status !== "active" ||
            !permissions.has("documents.read")
        )
            fail("workspace_authorization", 403);
        if (
            expectedPin &&
            (pin.authUserId !== expectedPin.authUserId ||
                pin.userPk !== expectedPin.userPk ||
                pin.companyId !== expectedPin.companyId)
        )
            fail("actor_changed", 409);
        const companyId = BigInt(pin.companyId);
        // Deliberately bypass ctx.documentScope(): it is request-memoized and is not
        // suitable for revocation checks between capture, generation and persistence.
        const scope = freeze(
            normalizeScope(
                await resolveScope({ companyId, userPk: BigInt(pin.userPk), role, permissions })
            )
        );
        check();
        const actor: ContextScopeV0 = {
            principalRef: pin.authUserId,
            companyId: pin.companyId,
            audience: { kind: "actor", principalRef: pin.authUserId },
            aclDigest: hash({ pin, role, status, permissions: [...permissions].sort(), scope }),
        };
        const rows = await reader
            .select({
                id: sql<string>`${companyMetadata.id}::text`,
                companyId: sql<string>`${companyMetadata.companyId}::text`,
                metadata: sql<CompanyMetadataJSON | null>`CASE WHEN octet_length(${companyMetadata.metadata}::text) <= ${COMPANY_ARCHITECTURE_MAX_PROFILE_BYTES} THEN ${companyMetadata.metadata} ELSE NULL END`,
                metadataBytes: sql<number>`octet_length(${companyMetadata.metadata}::text)`,
                schemaVersion: companyMetadata.schemaVersion,
                createdAt: companyMetadata.createdAt,
                updatedAt: companyMetadata.updatedAt,
                builtAt: companyMetadata.builtAt,
                buildStatus: companyMetadata.buildStatus,
            })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, companyId))
            .limit(2);
        check();
        if (rows.length > 1) fail("duplicate_profile", 503);
        const row = rows[0];
        if (
            row &&
            (!row.metadata ||
                row.metadataBytes > COMPANY_ARCHITECTURE_MAX_PROFILE_BYTES ||
                row.companyId !== pin.companyId)
        )
            fail("profile_limit_or_identity", 503);
        const profile: CompanyArchitectureReadSnapshotV0["profile"] = row
            ? {
                  id: row.id,
                  companyId: row.companyId,
                  metadata: row.metadata!,
                  schemaVersion: row.schemaVersion,
                  createdAt: row.createdAt.toISOString(),
                  updatedAt: instant(row.updatedAt),
                  builtAt: instant(row.builtAt),
                  buildStatus: row.buildStatus,
              }
            : null;
        const ids = collectCompanyArchitectureDocumentIds(
            profile?.metadata ?? null,
            COMPANY_ARCHITECTURE_MAX_DOCUMENTS
        );
        const sourceRows = ids.length
            ? await reader
                  .select()
                  .from(companyProfileSources)
                  .where(
                      and(
                          eq(companyProfileSources.companyId, companyId),
                          inArray(
                              companyProfileSources.documentId,
                              ids.map(id => BigInt(id))
                          ),
                          sql`octet_length(row_to_json(${companyProfileSources})::text) <= ${MAX_SOURCE_ROW_BYTES}`
                      )
                  )
                  .orderBy(asc(companyProfileSources.documentId))
                  .limit(COMPANY_ARCHITECTURE_MAX_DOCUMENTS + 1)
            : [];
        check();
        if (
            sourceRows.length > COMPANY_ARCHITECTURE_MAX_DOCUMENTS ||
            sourceRows.some(
                source =>
                    !Number.isSafeInteger(source.id) ||
                    String(source.companyId) !== pin.companyId ||
                    !ids.includes(String(source.documentId))
            )
        )
            fail("source_limit_or_identity", 503);
        const docs = ids.length
            ? await reader
                  .select({
                      id: sql<string>`${document.id}::text`,
                      companyId: sql<string>`${document.companyId}::text`,
                      category: document.category,
                      currentVersionId: sql<string>`${document.currentVersionId}::text`,
                      updatedAt: document.updatedAt,
                      versionId: sql<string>`${documentVersions.id}::text`,
                      versionDocumentId: sql<string>`${documentVersions.documentId}::text`,
                      versionCreatedAt: documentVersions.createdAt,
                      versionNumber: documentVersions.versionNumber,
                      versionUrl: documentVersions.url,
                      mimeType: documentVersions.mimeType,
                      fileSize: documentVersions.fileSize,
                      creationKey: documentVersions.creationKey,
                      indexed: documentVersions.ocrProcessed,
                      documentPayloadFingerprint: sql<string>`encode(sha256(convert_to(coalesce(${document.ocrMetadata}::text, 'null'), 'UTF8')), 'hex')`,
                      versionPayloadFingerprint: sql<string>`encode(sha256(convert_to(coalesce(${documentVersions.ocrMetadata}::text, 'null'), 'UTF8')), 'hex')`,
                  })
                  .from(document)
                  .innerJoin(
                      documentVersions,
                      and(
                          eq(document.currentVersionId, documentVersions.id),
                          eq(documentVersions.documentId, document.id)
                      )
                  )
                  .where(
                      and(
                          scopedDocumentWhere(companyId, scope),
                          inArray(document.id, ids.map(Number))
                      )
                  )
                  .orderBy(asc(document.id))
                  .limit(COMPANY_ARCHITECTURE_MAX_DOCUMENTS + 1)
            : [];
        check();
        if (
            docs.length > COMPANY_ARCHITECTURE_MAX_DOCUMENTS ||
            docs.some(
                doc =>
                    !ids.includes(doc.id) ||
                    doc.companyId !== pin.companyId ||
                    !scopeAllows(scope, { id: Number(doc.id), category: doc.category }) ||
                    doc.currentVersionId !== doc.versionId ||
                    doc.versionDocumentId !== doc.id
            )
        )
            fail("document_limit_or_identity", 503);
        const documents: CompanyArchitectureDocumentStateV0[] = ids.map(id => {
            const doc = docs.find(value => value.id === id);
            if (!doc)
                return {
                    id,
                    companyId: pin.companyId,
                    access: "missing",
                    currentVersionId: null,
                    versionCreatedAt: null,
                    contentFingerprint: hash({ id, unavailable: true }),
                    updatedAt: null,
                };
            return {
                id,
                companyId: pin.companyId,
                access: "allowed",
                currentVersionId: doc.currentVersionId,
                versionCreatedAt: instant(doc.versionCreatedAt),
                updatedAt: instant(doc.updatedAt),
                // A fingerprint of native exact-version metadata, NOT a claim that
                // this adapter fetched or independently verified document contents.
                contentFingerprint: hash(doc),
            };
        });
        const snapshot: CompanyArchitectureReadSnapshotV0 = {
            actor,
            reportWindow: input.reportWindow,
            checkedAt: now().toISOString(),
            profile,
            sourceRows,
            documents,
        };
        const projection = projectCompanyArchitectureV0(snapshot, { budgets: input.budgets });
        const stable = { actor, reportWindow: input.reportWindow, profile, sourceRows, documents };
        const fingerprint = hash({ stable, budgets: input.budgets, pin });
        const captured = freeze({
            actor,
            projection,
            snapshotFingerprint: fingerprint,
            reportWindow: structuredClone(input.reportWindow),
            budgets: structuredClone(input.budgets),
        });
        captures.set(captured, freeze({ pin, params: input, fingerprint }));
        return captured;
    }

    async function locked<T>(
        input: PrivateCapture["params"],
        work: (transaction: CompanyArchitectureTransactionV0, check: () => void) => Promise<T>
    ): Promise<T> {
        try {
            return await database.transaction(async transaction => {
                ownedTransactions.add(transaction);
                try {
                    const timeout = Math.min(input.budgets.timeoutMs, MAX_HOST_TIMEOUT_MS);
                    // Timeout rejection occurs INSIDE this transaction callback, so
                    // rollback releases the locks. A late authorization read cannot
                    // issue further native reads after the check has expired.
                    return await bounded(async check => {
                        await transaction.execute(
                            sql`SELECT set_config('lock_timeout', ${String(Math.min(timeout, 1000))}, true), set_config('statement_timeout', ${String(timeout)}, true)`
                        );
                        check();
                        // Both initial capture and final commit use the same short
                        // critical section. SHARE prevents phantom ACL/source rows,
                        // including folder moves between scope resolution and reading.
                        // This briefly blocks writers across tenants; no model runs here.
                        await transaction.execute(
                            sql`LOCK TABLE ${companyMetadata}, ${companyProfileSources}, ${document}, ${documentVersions}, ${category}, ${users}, ${userCompanyMemberships}, ${workspaceRoles}, ${workspaceGroups}, ${workspaceGroupMembers}, ${folderSettings}, ${folderGrants}, ${documentSettings}, ${documentGrants} IN SHARE MODE`
                        );
                        check();
                        return await work(transaction, check);
                    }, timeout);
                } finally {
                    ownedTransactions.delete(transaction);
                }
            });
        } catch (error) {
            const value = error as { code?: string; cause?: { code?: string } } | null;
            if (["55P03", "57014", "40P01"].includes(value?.code ?? value?.cause?.code ?? ""))
                fail("guard_lock_unavailable", 503);
            throw error;
        }
    }
    async function capture(input: {
        reportWindow: ContextReportWindowV0;
        budgets: ContextBudgetsV0;
    }) {
        const value = params(input);
        try {
            return await locked(value, (transaction, check) =>
                read(value, transaction, undefined, check)
            );
        } catch (error) {
            if (error instanceof CompanyArchitectureHostErrorV0) throw error;
            return fail("native_read_unavailable", 503);
        }
    }
    function privateCapture(captured: CapturedCompanyArchitectureV0) {
        return captures.get(captured) ?? fail("unrecognized_capture", 409);
    }
    async function assertFresh(
        captured: CapturedCompanyArchitectureV0,
        options: { transaction?: unknown } = {}
    ) {
        const previous = privateCapture(captured);
        if (
            options.transaction !== undefined &&
            (!options.transaction ||
                typeof options.transaction !== "object" ||
                !ownedTransactions.has(options.transaction))
        )
            fail("unsupported_transaction", 503);
        try {
            const fresh = options.transaction
                ? await bounded(
                      check =>
                          read(previous.params, options.transaction as Reader, previous.pin, check),
                      Math.min(previous.params.budgets.timeoutMs, MAX_HOST_TIMEOUT_MS)
                  )
                : await locked(previous.params, (transaction, check) =>
                      read(previous.params, transaction, previous.pin, check)
                  );
            if (fresh.snapshotFingerprint !== previous.fingerprint) fail("stale_context", 409);
            return fresh;
        } catch (error) {
            if (error instanceof CompanyArchitectureHostErrorV0 && error.status === 503)
                throw error;
            return fail("stale_context", 409);
        }
    }
    async function guardedCommit<T>(
        captured: CapturedCompanyArchitectureV0,
        persist: (transaction: CompanyArchitectureTransactionV0) => Promise<T>
    ): Promise<T> {
        const previous = privateCapture(captured);
        if (captured.projection.status !== "available" || !captured.projection.requiredEntry)
            fail("required_architecture_unavailable", 503);
        return locked(previous.params, async (transaction, check) => {
            const fresh = await read(previous.params, transaction, previous.pin, check);
            if (fresh.snapshotFingerprint !== previous.fingerprint) fail("stale_context", 409);
            if (fresh.projection.status !== "available" || !fresh.projection.requiredEntry)
                fail("required_architecture_unavailable", 409);
            check();
            return await persist(transaction);
        });
    }
    return { capture, assertFresh, guardedCommit };
}
