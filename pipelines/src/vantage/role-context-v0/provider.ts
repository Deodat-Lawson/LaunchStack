import {
    ContextPortErrorV0,
    type ContextActorRequestV0,
    type ResolveBusinessRolesInputV0,
    type ResolveRequiredContextInputV0,
    type RoleContextPortV0,
} from "../context-v0/ports";
import {
    contextSourceKeyV0,
    validateRequiredContextBundle,
    validateDynamicRetrievalInput,
    validateBusinessRoleContext,
    type ContextScopeV0,
    type ContextSourceEntryV0,
    type ContextSourceRefV0,
    type RequiredContextBundleV0,
} from "../proposals/context-v0";
import type {
    PersonalContextDependenciesV0,
    PersonalContextStateV0,
    RequiredContextDiagnosticsV0,
    SourceReadV0,
    SourceCoverageDiagnosticV0,
} from "./contracts";
import { canonicalRoleV0, resolveRoleSelectionV0 } from "./roles";

export class RequiredContextErrorV0 extends ContextPortErrorV0 {
    constructor(
        readonly diagnostics: RequiredContextDiagnosticsV0,
        code: string,
        status: 403 | 409 | 503 = 409
    ) {
        super("Required context is incomplete. Review source coverage before continuing.", status, [
            { code, message: "Required context is incomplete.", status },
        ]);
    }
}
function fail(message: string, status: 400 | 403 | 409 | 503 = 403): never {
    throw new ContextPortErrorV0(message, status);
}
const sameRef = (a: ContextSourceRefV0, b: ContextSourceRefV0) =>
    contextSourceKeyV0(a) === contextSourceKeyV0(b);
const sortRefs = (a: ContextSourceRefV0, b: ContextSourceRefV0) =>
    contextSourceKeyV0(a) < contextSourceKeyV0(b)
        ? -1
        : contextSourceKeyV0(a) === contextSourceKeyV0(b)
          ? 0
          : 1;

/** Reject hanging dependencies as well as cooperative cancellation. No writes occur inside this boundary. */
async function bounded<T>(
    input: ContextActorRequestV0,
    run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
    if (!Number.isFinite(input.budgets.timeoutMs) || input.budgets.timeoutMs <= 0)
        fail("Invalid context timeout.", 400);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
        return await Promise.race([
            new Promise<never>((_, reject) => {
                const stop = () => {
                    controller.abort();
                    reject(
                        new ContextPortErrorV0("Context preparation cancelled or timed out.", 503)
                    );
                };
                abort = stop;
                if (input.signal?.aborted) stop();
                else input.signal?.addEventListener("abort", stop, { once: true });
                timer = setTimeout(stop, input.budgets.timeoutMs);
            }),
            Promise.resolve().then(() => {
                if (controller.signal.aborted) fail("Context preparation cancelled.", 503);
                return run(controller.signal);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        if (abort) input.signal?.removeEventListener("abort", abort);
    }
}

export function createPersonalContextProviderV0(
    deps: PersonalContextDependenciesV0
): RoleContextPortV0 & {
    readPersonalState(input: ContextActorRequestV0): Promise<PersonalContextStateV0>;
    saveRoles(
        input: ContextActorRequestV0,
        change: { roleIds: string[]; primaryRoleId?: string; expectedRevision: number }
    ): Promise<PersonalContextStateV0>;
    setStar(
        input: ContextActorRequestV0,
        change: { documentId: string; starred: boolean; expectedRevision: number }
    ): Promise<PersonalContextStateV0>;
    prepareRequiredContext(
        input: ResolveRequiredContextInputV0
    ): Promise<{ bundle: RequiredContextBundleV0; diagnostics: RequiredContextDiagnosticsV0 }>;
} {
    async function actorFor(input: ContextActorRequestV0): Promise<ContextScopeV0> {
        const actor = await deps.resolveAuthenticatedActor(input);
        if (
            actor.companyId !== input.companyId ||
            actor.principalRef !== input.principalRef ||
            actor.audience.kind !== "actor" ||
            actor.audience.principalRef !== actor.principalRef ||
            !actor.aclDigest
        )
            fail("Actor scope mismatch.");
        return actor;
    }
    async function stateFor(actor: ContextScopeV0) {
        const state = await deps.store.read(actor);
        if (
            state.version !== "joseph-personal-context-v0" ||
            state.companyId !== actor.companyId ||
            state.principalRef !== actor.principalRef ||
            state.module !== "vantage"
        )
            fail("Personal context scope mismatch.");
        if (
            !Number.isSafeInteger(state.revision) ||
            state.revision < 0 ||
            new Set(state.stars.map(s => s.documentId)).size !== state.stars.length ||
            state.stars.some(
                s => s.lastKnownRef.kind !== "doc" || s.lastKnownRef.id !== s.documentId
            )
        )
            fail("Invalid stored context.", 409);
        return structuredClone(state);
    }
    function authorized(
        entry: ContextSourceEntryV0,
        actor: ContextScopeV0,
        input: ContextActorRequestV0
    ) {
        if (
            entry.access !== "allowed" ||
            entry.companyId !== actor.companyId ||
            !entry.aclDigest ||
            (entry.audience.kind === "company" && entry.audience.companyId !== actor.companyId) ||
            (entry.audience.kind === "actor" &&
                entry.audience.principalRef !== actor.principalRef) ||
            entry.audience.kind === "public"
        )
            fail("Source access denied.");
        if (
            !Number.isFinite(Date.parse(entry.sourceDate)) ||
            !Number.isFinite(Date.parse(input.reportWindow.asOf)) ||
            Date.parse(entry.sourceDate) > Date.parse(input.reportWindow.asOf)
        )
            fail("Source is outside the reporting cutoff.", 409);
        if (!entry.source.id || !entry.source.version || !entry.excerpt.trim())
            fail("Source content is unavailable.", 409);
        if (
            entry.excerptOffsets &&
            (entry.excerptOffsets.sourceVersion !== entry.source.version ||
                entry.excerptOffsets.start < 0 ||
                entry.excerptOffsets.end - entry.excerptOffsets.start !== entry.excerpt.length)
        )
            fail("Invalid source excerpt range.", 409);
    }
    async function commit(actor: ContextScopeV0, state: PersonalContextStateV0, expected: number) {
        if (!Number.isSafeInteger(expected) || expected < 0)
            fail("Invalid expected revision.", 400);
        if (state.revision !== expected)
            fail("Personal context changed. Reload before saving.", 409);
        const next = { ...state, revision: expected + 1 };
        if (!(await deps.store.compareAndSwap(actor, expected, next)))
            fail("Personal context changed. Reload before saving.", 409);
        return structuredClone(next);
    }
    async function resolveBusinessRoles(input: ResolveBusinessRolesInputV0) {
        return bounded(input, async signal => {
            const actor = await actorFor({ ...input, signal });
            const state = await stateFor(actor);
            const title = state.roles ? null : await deps.readProfileTitle(actor);
            const context = resolveRoleSelectionV0({
                principalRef: actor.principalRef,
                values:
                    state.roles?.roleIds ?? (title ? title.split(/\s*(?:\+|,|;|\band\b)\s*/i) : []),
                primaryRoleId: state.roles?.primaryRoleId,
                confirmed: state.roles !== null,
            });
            if (input.requestedRoleIds !== undefined) {
                if (input.requestedRoleIds.some(id => !context.roleIds.includes(id)))
                    fail("Requested role must be confirmed in the role profile.", 400);
                context.roleIds = context.roleIds.filter(id =>
                    input.requestedRoleIds!.includes(id)
                );
                context.roles = context.roles.filter(role => context.roleIds.includes(role.roleId));
                if (context.primaryRoleId && !context.roleIds.includes(context.primaryRoleId))
                    delete context.primaryRoleId;
            }
            return context;
        });
    }
    async function prepareRequiredContext(input: ResolveRequiredContextInputV0) {
        return bounded(input, async signal => {
            const actor = await actorFor({ ...input, signal });
            if (
                !validateBusinessRoleContext(input.roleContext).ok ||
                input.roleContext.authenticatedPrincipalRef !== actor.principalRef
            )
                fail("Role context does not match the actor.");
            const requestValidation = validateDynamicRetrievalInput({
                contractVersion: "v0-proposed",
                actor,
                verifiedRoleContext: input.roleContext,
                reportWindow: input.reportWindow,
                sourceCatalog: [],
                budgets: input.budgets,
            });
            if (!requestValidation.ok) fail("Invalid context window or budget.", 400);
            const [state, inventory] = await Promise.all([
                stateFor(actor),
                deps.requiredSources(actor, input.reportWindow, signal),
            ]);
            const diagnostics: RequiredContextDiagnosticsV0 = {
                coverage: { checked: [], used: [], missing: [], revoked: [], omitted: [] },
                sources: [],
            };
            const selected = new Map<string, ContextSourceEntryV0>();
            const constraints = new Set<string>();
            let companyArchitecture: RequiredContextBundleV0["companyArchitecture"] | undefined;
            const parts: Omit<RequiredContextBundleV0, "companyArchitecture"> = {
                contractVersion: "v0-proposed",
                actor,
                asOf: input.reportWindow.asOf,
                workspaceMandatoryDocuments: [],
                personalVantageStars: [],
                constraints: [],
                coverage: diagnostics.coverage,
                status: "complete",
            };
            let failure = false;
            async function consume(
                lane: SourceCoverageDiagnosticV0["lane"],
                ref: ContextSourceRefV0 | undefined,
                read: () => Promise<SourceReadV0>
            ) {
                const diagnostic: SourceCoverageDiagnosticV0 = {
                    lane,
                    source: ref,
                    companyId: actor.companyId,
                    principalRef: actor.principalRef,
                    module: "vantage",
                    status: "missing",
                    checkedAt: deps.now(),
                };
                diagnostics.sources.push(diagnostic);
                if (!ref) {
                    failure = true;
                    diagnostic.reason = "Canonical company context has not been created.";
                    return;
                }
                let result: SourceReadV0;
                try {
                    result = await read();
                } catch {
                    result = { status: "unavailable" };
                }
                if (result.status !== "allowed") {
                    diagnostic.status = result.status;
                    diagnostics.coverage.checked.push(ref);
                    diagnostics.coverage[
                        result.status === "unavailable" ? "omitted" : result.status
                    ].push(ref);
                    failure = true;
                    return;
                }
                const entry = structuredClone(result.entry);
                try {
                    authorized(entry, actor, input);
                    if (
                        lane === "star"
                            ? entry.source.kind !== "doc" || entry.source.id !== ref.id
                            : !sameRef(entry.source, ref)
                    )
                        fail("Source identity changed.", 409);
                    if (lane !== "star" && entry.audience.kind !== "company")
                        fail("Mandatory company source audience mismatch.");
                } catch {
                    diagnostic.status = "omitted";
                    diagnostic.reason =
                        "Source identity, permission or cutoff could not be verified.";
                    diagnostics.coverage.checked.push(ref);
                    diagnostics.coverage.omitted.push(ref);
                    failure = true;
                    return;
                }
                diagnostic.source = entry.source;
                diagnostic.sourceDate = entry.sourceDate;
                diagnostic.excerptOffsets = entry.excerptOffsets;
                diagnostic.status = "used";
                diagnostic.checkedAt = entry.checkedAt;
                diagnostics.coverage.checked.push(entry.source);
                const key = contextSourceKeyV0(entry.source);
                if (selected.has(key)) {
                    diagnostic.reason = "Already included as mandatory company context.";
                    return;
                }
                selected.set(key, entry);
                diagnostics.coverage.used.push(entry.source);
                result.constraints.forEach(value => constraints.add(value));
                if (lane === "company") {
                    companyArchitecture = {
                        ...entry,
                        source: inventory.companyArchitecture!,
                        required: true,
                        canonical: true,
                    };
                } else if (lane === "mandatory")
                    parts.workspaceMandatoryDocuments.push({ ...entry, required: true });
                else
                    parts.personalVantageStars.push({
                        ...entry,
                        audience: actor.audience,
                        module: "vantage",
                        required: true,
                    });
            }
            const architecture = inventory.companyArchitecture;
            if (
                architecture &&
                (architecture.companyId !== actor.companyId ||
                    architecture.kind !== "company" ||
                    !architecture.canonical ||
                    !["reviewed", "unknowns-marked"].includes(architecture.reviewState))
            )
                fail(
                    "Company context must be canonical and reviewed or explicitly mark unknowns.",
                    409
                );
            await consume("company", architecture ?? undefined, () =>
                deps.readSource(actor, architecture!, input.reportWindow, signal)
            );
            for (const ref of [...inventory.workspaceMandatoryDocuments].sort(sortRefs)) {
                if (ref.kind !== "doc")
                    fail("Workspace mandatory sources must be canonical documents.", 409);
                await consume("mandatory", ref, () =>
                    deps.readSource(actor, ref, input.reportWindow, signal)
                );
            }
            for (const star of [...state.stars].sort((a, b) =>
                a.documentId < b.documentId ? -1 : a.documentId === b.documentId ? 0 : 1
            )) {
                await consume("star", star.lastKnownRef, () =>
                    deps.readDocument(actor, star.documentId, input.reportWindow, signal)
                );
            }
            for (const key of ["checked", "used", "missing", "revoked", "omitted"] as const)
                diagnostics.coverage[key] = [
                    ...new Map(
                        diagnostics.coverage[key].map(ref => [contextSourceKeyV0(ref), ref])
                    ).values(),
                ].sort(sortRefs);
            parts.constraints = [...constraints].sort();
            parts.coverage = diagnostics.coverage;
            const chars = [...selected.values()].reduce(
                (sum, entry) => sum + entry.excerpt.length,
                0
            );
            if (
                ![input.budgets.maxSources, input.budgets.maxExcerptChars].every(
                    n => Number.isSafeInteger(n) && n >= 0
                )
            )
                fail("Invalid required-context budgets.", 400);
            if (selected.size > input.budgets.maxSources || chars > input.budgets.maxExcerptChars) {
                diagnostics.coverage.omitted = [
                    ...new Map(
                        [
                            ...diagnostics.coverage.omitted,
                            ...[...selected.values()].map(e => e.source),
                        ].map(ref => [contextSourceKeyV0(ref), ref])
                    ).values(),
                ].sort(sortRefs);
                diagnostics.coverage.used = [];
                diagnostics.sources.forEach(item => {
                    if (item.status === "used") {
                        item.status = "omitted";
                        item.reason =
                            "Required context exceeds the budget; nothing was silently truncated.";
                    }
                });
                throw new RequiredContextErrorV0(diagnostics, "required_context_budget");
            }
            if (failure || !companyArchitecture)
                throw new RequiredContextErrorV0(diagnostics, "required_context_incomplete");
            const bundle: RequiredContextBundleV0 = { ...parts, companyArchitecture };
            const validation = validateRequiredContextBundle(bundle, {
                expectedCompanyId: actor.companyId,
                expectedPrincipalRef: actor.principalRef,
                expectedAclDigest: actor.aclDigest,
            });
            if (!validation.ok)
                throw new RequiredContextErrorV0(diagnostics, "required_context_invalid");
            return { bundle, diagnostics };
        });
    }
    return {
        resolveBusinessRoles,
        prepareRequiredContext,
        async resolveRequiredContext(input) {
            return (await prepareRequiredContext(input)).bundle;
        },
        async readPersonalState(input) {
            return stateFor(await actorFor(input));
        },
        async saveRoles(input, change) {
            const actor = await actorFor(input);
            const state = await stateFor(actor);
            if (
                !Array.isArray(change.roleIds) ||
                change.roleIds.some(id => canonicalRoleV0(id) !== id) ||
                (change.primaryRoleId && !change.roleIds.includes(change.primaryRoleId))
            )
                fail(
                    "Select controlled business roles and a primary role from that selection.",
                    400
                );
            const roles = resolveRoleSelectionV0({
                principalRef: actor.principalRef,
                values: change.roleIds,
                primaryRoleId: change.primaryRoleId,
                confirmed: true,
            });
            state.roles = {
                roleIds: roles.roleIds,
                ...(roles.primaryRoleId ? { primaryRoleId: roles.primaryRoleId } : {}),
                confirmedAt: deps.now(),
            };
            return commit(actor, state, change.expectedRevision);
        },
        async setStar(input, change) {
            const actor = await actorFor(input);
            const state = await stateFor(actor);
            if (!change.documentId.trim()) fail("Document ID is required.", 400);
            if (change.starred) {
                const read = await bounded(input, signal =>
                    deps.readDocument(actor, change.documentId, input.reportWindow, signal)
                );
                if (read.status !== "allowed")
                    fail("Document is unavailable or you no longer have access.");
                authorized(read.entry, actor, input);
                if (read.entry.source.kind !== "doc" || read.entry.source.id !== change.documentId)
                    fail("Document identity mismatch.");
                const existing = state.stars.find(star => star.documentId === change.documentId);
                state.stars = state.stars.filter(star => star.documentId !== change.documentId);
                state.stars.push({
                    documentId: change.documentId,
                    lastKnownRef: read.entry.source,
                    starredAt: existing?.starredAt ?? deps.now(),
                    updatedAt: deps.now(),
                });
            } else {
                // Removing your own selection is safe even after document access is revoked.
                state.stars = state.stars.filter(star => star.documentId !== change.documentId);
            }
            state.stars.sort((a, b) => (a.documentId < b.documentId ? -1 : 1));
            return commit(actor, state, change.expectedRevision);
        },
    };
}
