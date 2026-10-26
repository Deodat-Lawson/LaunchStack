import {
    ContextPortErrorV0,
    type ContextSourceEntryV0,
} from "@launchstack/pipelines/vantage/context-v0";
import {
    resolveRoleSelectionV0,
    createPersonalContextProviderV0,
    type PersonalContextDependenciesV0,
    type RequiredContextDiagnosticsV0,
} from "@launchstack/pipelines/vantage/role-context-v0";
import { db } from "~/server/db";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    contextDocumentIdSchema,
    saveContextRolesSchema,
    setContextStarSchema,
    type PersonalContextViewV0,
} from "~/lib/vantage/personal-context";
import {
    personalContextSession,
    createPostgresPersonalContextStoreV0,
    contextDigest,
    MAX_PERSONAL_EXCERPT_CHARS,
    MAX_PERSONAL_SOURCES,
} from "./personal-context-store";

type Database = typeof db;
type Session = Awaited<ReturnType<typeof personalContextSession>>;
function rolesFor(session: Session) {
    return resolveRoleSelectionV0({
        principalRef: session.actor.principalRef,
        values:
            session.state.roles?.roleIds ??
            session.profileTitle?.split(/\s*(?:\+|,|;|\band\b)\s*/i) ??
            [],
        primaryRoleId: session.state.roles?.primaryRoleId,
        confirmed: session.state.roles !== null,
    });
}

/** Reads one consistent database snapshot. Incomplete inputs never yield a usable snapshot. */
export async function loadPersonalContext(
    ctx: WorkspaceContext,
    database: Database = db,
    expectedRevision?: number
): Promise<PersonalContextViewV0> {
    return database.transaction(
        async tx => {
            const session = await personalContextSession(ctx, tx);
            const { actor, state } = session;
            if (expectedRevision !== undefined && state.revision !== expectedRevision)
                throw new ContextPortErrorV0(
                    "Personal context changed. Reload before preparing a snapshot.",
                    409
                );
            const asOf = new Date().toISOString();
            const roles = rolesFor(session);
            const diagnostics: RequiredContextDiagnosticsV0 = {
                coverage: { checked: [], used: [], missing: [], revoked: [], omitted: [] },
                sources: [],
            };
            const entries: ContextSourceEntryV0[] = [];
            let chars = 0;
            for (const star of state.stars) {
                const read =
                    state.stars.length > MAX_PERSONAL_SOURCES
                        ? { status: "unavailable" as const }
                        : await session.readDocument(star.documentId, asOf);
                const source = read.status === "allowed" ? read.entry.source : star.lastKnownRef;
                diagnostics.coverage.checked.push(source);
                if (read.status === "allowed") {
                    entries.push(read.entry);
                    chars += read.entry.excerpt.length;
                    diagnostics.coverage.used.push(source);
                    diagnostics.sources.push({
                        lane: "star",
                        source,
                        companyId: actor.companyId,
                        principalRef: actor.principalRef,
                        module: "vantage",
                        status: "used",
                        checkedAt: read.entry.checkedAt,
                        sourceDate: read.entry.sourceDate,
                        excerptOffsets: read.entry.excerptOffsets,
                    });
                } else {
                    diagnostics.coverage[
                        read.status === "unavailable" ? "omitted" : read.status
                    ].push(source);
                    diagnostics.sources.push({
                        lane: "star",
                        source,
                        companyId: actor.companyId,
                        principalRef: actor.principalRef,
                        module: "vantage",
                        status: read.status,
                        checkedAt: asOf,
                        reason:
                            read.status === "unavailable"
                                ? "Version-specific extracted text is unavailable or exceeds the context limit."
                                : "The document is missing or you no longer have access.",
                    });
                }
            }
            if (chars > MAX_PERSONAL_EXCERPT_CHARS) {
                diagnostics.coverage.omitted.push(...diagnostics.coverage.used);
                diagnostics.coverage.used = [];
                diagnostics.sources = diagnostics.sources.map(item =>
                    item.status === "used"
                        ? {
                              ...item,
                              status: "omitted",
                              reason: "Your selected documents exceed the context limit. Nothing was silently dropped.",
                          }
                        : item
                );
            }
            const ready = diagnostics.sources.every(item => item.status === "used");
            const payload = {
                version: "vantage-personal-snapshot-v0" as const,
                asOf,
                actor,
                revision: state.revision,
                roles,
                sources: entries,
            };
            return {
                state,
                roles,
                diagnostics,
                ready,
                scope: "personal",
                documents: await session.listDocuments(),
                snapshot: ready ? { ...payload, id: contextDigest(payload) } : null,
            };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" }
    );
}

export async function savePersonalRoles(
    ctx: WorkspaceContext,
    input: unknown,
    database: Database = db
) {
    const parsed = saveContextRolesSchema.safeParse(input);
    if (!parsed.success)
        throw new ContextPortErrorV0(
            "Choose valid business responsibilities and a primary role from your selection.",
            400
        );
    return database.transaction(async tx => {
        const session = await personalContextSession(ctx, tx, true);
        const roles = resolveRoleSelectionV0({
            principalRef: ctx.authUserId,
            values: parsed.data.roleIds,
            primaryRoleId: parsed.data.primaryRoleId,
            confirmed: true,
        });
        const next = {
            ...session.state,
            revision: parsed.data.expectedRevision + 1,
            roles: {
                roleIds: roles.roleIds,
                primaryRoleId: roles.primaryRoleId,
                confirmedAt: new Date().toISOString(),
            },
        };
        if (!(await session.persist(next, parsed.data.expectedRevision)))
            throw new ContextPortErrorV0("Personal context changed. Reload before saving.", 409);
        return { revision: next.revision };
    });
}

export async function setPersonalStar(
    ctx: WorkspaceContext,
    documentId: string,
    input: unknown,
    database: Database = db
) {
    const parsed = setContextStarSchema.safeParse(input);
    if (!parsed.success || !contextDocumentIdSchema.safeParse(documentId).success)
        throw new ContextPortErrorV0("Invalid document selection.", 400);
    return database.transaction(async tx => {
        const session = await personalContextSession(ctx, tx, true);
        if (session.state.revision !== parsed.data.expectedRevision)
            throw new ContextPortErrorV0("Personal context changed. Reload before saving.", 409);
        const next = {
            ...session.state,
            revision: session.state.revision + 1,
            stars: session.state.stars.filter(star => star.documentId !== documentId),
        };
        if (parsed.data.starred) {
            const row = await session.visibleVersion(documentId);
            if (!row) throw new ContextPortErrorV0("Document not found.", 404);
            const now = new Date().toISOString();
            next.stars.push({
                documentId,
                lastKnownRef: { kind: "doc", id: documentId, version: String(row.versionId) },
                starredAt:
                    session.state.stars.find(star => star.documentId === documentId)?.starredAt ??
                    now,
                updatedAt: now,
            });
        }
        if (!(await session.persist(next, parsed.data.expectedRevision)))
            throw new ContextPortErrorV0("Personal context changed. Reload before saving.", 409);
        return { revision: next.revision };
    });
}

/** Production RoleContextPort: TL supplies canonical company/mandatory inventory and its source resolver. */
export function createDatabasePersonalContextProviderV0(
    ctx: WorkspaceContext,
    company: Pick<PersonalContextDependenciesV0, "requiredSources" | "readSource">,
    database: Database = db
) {
    function read<T>(run: (session: Session) => Promise<T> | T) {
        return database.transaction(async tx => run(await personalContextSession(ctx, tx)), {
            isolationLevel: "repeatable read",
            accessMode: "read only",
        });
    }
    function checkActor(actor: { companyId: string; principalRef: string }) {
        if (actor.companyId !== String(ctx.companyId) || actor.principalRef !== ctx.authUserId)
            throw new ContextPortErrorV0("Personal context scope mismatch.", 403);
    }
    return createPersonalContextProviderV0({
        ...company,
        store: createPostgresPersonalContextStoreV0(ctx, database),
        now: () => new Date().toISOString(),
        resolveAuthenticatedActor(input) {
            checkActor(input);
            return read(session => session.actor);
        },
        readProfileTitle(actor) {
            checkActor(actor);
            return read(session => session.profileTitle);
        },
        readDocument(actor, id, window) {
            checkActor(actor);
            return read(session => session.readDocument(id, window.asOf));
        },
    });
}
