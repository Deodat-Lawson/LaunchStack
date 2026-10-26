/** Development-only Joseph bridge. Actor-authorized records enter through the existing TL host.
 * Personal choices live only in this server process, never localStorage or production SQL. */
import { createHash, randomUUID } from "node:crypto";
import {
    ContextPortErrorV0,
    contextSourceKeyV0,
    type CompanyArchitectureRefV0,
    type ContextActorRequestV0,
    type ContextBudgetsV0,
    type ContextReportWindowV0,
    type ContextScopeV0,
    type ContextSourceRefV0,
    type TrustedContextSourceV0,
} from "@launchstack/pipelines/vantage/context-v0";
import {
    createPersonalContextProviderV0,
    emptyPersonalContextV0,
    RequiredContextErrorV0,
    type PersonalContextStateV0,
    type RequiredContextDiagnosticsV0,
    type SourceCoverageDiagnosticV0,
} from "@launchstack/pipelines/vantage/role-context-v0";
import type { PersonalContextViewV0 } from "~/components/vantage-context/PersonalContextPanel";

export interface JosephPersonalSnapshotV0 {
    epoch: string;
    revision: number;
    digest: string;
}
export interface JosephPersonalHostOptionsV0 {
    actor: ContextScopeV0;
    records: readonly TrustedContextSourceV0[];
    reportWindow: ContextReportWindowV0;
    budgets: ContextBudgetsV0;
    resolveFresh(): Promise<{ actor: ContextScopeV0; records: readonly TrustedContextSourceV0[] }>;
    mandatoryRefs?: readonly ContextSourceRefV0[];
    companyRef?: CompanyArchitectureRefV0;
    /** Explicit synthetic title hint only; authorization roles are never business-role hints. */
    profileTitle?: string | null;
    now?: () => string;
}
export interface JosephPersonalViewV0 extends PersonalContextViewV0 {
    blocker?: string;
    persistence: "server-process-memory";
    snapshot: JosephPersonalSnapshotV0;
}
interface Memory {
    epoch: string;
    states: Map<string, PersonalContextStateV0>;
    tails: Map<string, Promise<void>>;
}
const slot = Symbol.for("launchstack.vantage.joseph.synthetic-personal/v0");
const globals = globalThis as typeof globalThis & { [slot]?: Memory };
const memory: Memory = (globals[slot] ??= {
    epoch: randomUUID(),
    states: new Map(),
    tails: new Map(),
});
const stable = (value: unknown): unknown =>
    Array.isArray(value)
        ? value.map(stable)
        : value && typeof value === "object"
          ? Object.fromEntries(
                Object.entries(value)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => [k, stable(v)])
            )
          : value;
const hash = (value: unknown) =>
    createHash("sha256")
        .update(JSON.stringify(stable(value)))
        .digest("hex");
const sourceIdentity = (entries: readonly TrustedContextSourceV0[]) =>
    hash(
        entries
            .map(entry => ({
                source: entry.source,
                access: entry.access,
                aclDigest: entry.aclDigest,
                audience: entry.audience,
                contentHash: entry.contentHash,
                excerpt: entry.excerpt,
                sourceDate: entry.sourceDate,
            }))
            .sort((a, b) =>
                contextSourceKeyV0(a.source).localeCompare(contextSourceKeyV0(b.source))
            )
    );
function fail(code: string, status: 403 | 409 = 409): never {
    throw new ContextPortErrorV0(
        "Personal context is unavailable or changed. Reload before continuing.",
        status,
        [{ code, message: "Personal context is unavailable or changed.", status }]
    );
}
const ownerKey = (actor: ContextScopeV0) =>
    JSON.stringify([actor.companyId, actor.principalRef, "vantage"]);
async function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = memory.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>(resolve => {
        release = resolve;
    });
    const tail = previous.then(() => done);
    memory.tails.set(key, tail);
    await previous;
    try {
        return await work();
    } finally {
        release();
        if (memory.tails.get(key) === tail) memory.tails.delete(key);
    }
}

export function createJosephPersonalHostV0(options: JosephPersonalHostOptionsV0) {
    const actor = structuredClone(options.actor),
        key = ownerKey(actor);
    const input: ContextActorRequestV0 = {
        principalRef: actor.principalRef,
        companyId: actor.companyId,
        reportWindow: structuredClone(options.reportWindow),
        budgets: structuredClone(options.budgets),
    };
    const now = options.now ?? (() => new Date().toISOString());
    function scope(candidate: ContextScopeV0) {
        if (
            !actor.companyId ||
            !actor.principalRef ||
            !actor.aclDigest ||
            candidate.companyId !== actor.companyId ||
            candidate.principalRef !== actor.principalRef ||
            candidate.aclDigest !== actor.aclDigest ||
            candidate.audience.kind !== "actor" ||
            candidate.audience.principalRef !== actor.principalRef
        )
            fail("personal_actor_scope", 403);
    }
    function records(candidate: readonly TrustedContextSourceV0[]) {
        const ids = new Set<string>();
        for (const entry of candidate) {
            if (
                entry.companyId !== actor.companyId ||
                entry.aclDigest !== actor.aclDigest ||
                entry.access !== "allowed" ||
                entry.audience.kind === "public" ||
                (entry.audience.kind === "actor" &&
                    entry.audience.principalRef !== actor.principalRef) ||
                (entry.audience.kind === "company" &&
                    entry.audience.companyId !== actor.companyId) ||
                !["company", "doc"].includes(entry.source.kind) ||
                !entry.source.version ||
                !entry.excerpt.trim() ||
                !entry.contentHash ||
                !Number.isFinite(Date.parse(entry.sourceDate)) ||
                Date.parse(entry.sourceDate) > Date.parse(input.reportWindow.asOf) ||
                (entry.source.kind === "doc" &&
                    !/^workspace-document\/[1-9]\d*$/.test(entry.source.id)) ||
                (entry.source.kind === "company" &&
                    entry.source.id !== `company-metadata/${actor.companyId}`) ||
                ids.has(`${entry.source.kind}:${entry.source.id}`)
            )
                fail("personal_source_scope", 403);
            ids.add(`${entry.source.kind}:${entry.source.id}`);
        }
        return structuredClone([...candidate]);
    }
    scope(actor);
    records(options.records);
    async function fresh() {
        const next = await options.resolveFresh();
        scope(next.actor);
        return { actor: structuredClone(next.actor), records: records(next.records) };
    }
    const readState = (): PersonalContextStateV0 =>
        structuredClone(memory.states.get(key) ?? emptyPersonalContextV0(actor));
    const snapshot = async (): Promise<JosephPersonalSnapshotV0> => {
        const frame = await fresh();
        const state = readState();
        return {
            epoch: memory.epoch,
            revision: state.revision,
            digest: hash({
                epoch: memory.epoch,
                key,
                state,
                actorAclDigest: actor.aclDigest,
                sources: sourceIdentity(frame.records),
            }),
        };
    };
    function architecture(frame: Awaited<ReturnType<typeof fresh>>) {
        const record = frame.records.find(entry => entry.source.kind === "company");
        if (!record) return null;
        const ref = options.companyRef ?? (record.source as CompanyArchitectureRefV0);
        let body: { reviewState?: string };
        try {
            body = JSON.parse(record.excerpt) as { reviewState?: string };
        } catch {
            return fail("personal_company_identity");
        }
        if (
            ref.kind !== "company" ||
            ref.companyId !== actor.companyId ||
            ref.canonical !== true ||
            !["reviewed", "unknowns-marked", "unreviewed"].includes(ref.reviewState) ||
            body.reviewState !== ref.reviewState ||
            contextSourceKeyV0(ref) !== contextSourceKeyV0(record.source)
        )
            fail("personal_company_identity");
        return structuredClone(ref);
    }
    const provider = createPersonalContextProviderV0({
        resolveAuthenticatedActor: async request => {
            if (
                request.companyId !== actor.companyId ||
                request.principalRef !== actor.principalRef
            )
                fail("personal_actor_scope", 403);
            return (await fresh()).actor;
        },
        store: {
            async read(requestActor) {
                scope(requestActor);
                await fresh();
                return readState();
            },
            async compareAndSwap(requestActor, expectedRevision, next) {
                scope(requestActor);
                return locked(key, async () => {
                    const frame = await fresh(),
                        previous = readState();
                    if (previous.revision !== expectedRevision) return false;
                    if (
                        next.companyId !== actor.companyId ||
                        next.principalRef !== actor.principalRef ||
                        next.module !== "vantage" ||
                        next.revision !== expectedRevision + 1
                    )
                        fail("personal_store_scope", 403);
                    // Recheck additions/version refreshes inside the same mutex as the write.
                    for (const star of next.stars) {
                        const before = previous.stars.find(
                            value => value.documentId === star.documentId
                        );
                        if (before && hash(before) === hash(star)) continue;
                        const current = frame.records.find(
                            record =>
                                record.source.kind === "doc" && record.source.id === star.documentId
                        );
                        if (
                            !current ||
                            contextSourceKeyV0(current.source) !==
                                contextSourceKeyV0(star.lastKnownRef)
                        )
                            fail("personal_star_changed", 403);
                    }
                    memory.states.set(key, structuredClone(next));
                    return true;
                });
            },
        },
        readProfileTitle: async () => options.profileTitle ?? null,
        requiredSources: async () => ({
            companyArchitecture: architecture(await fresh()),
            workspaceMandatoryDocuments: structuredClone([...(options.mandatoryRefs ?? [])]),
        }),
        readSource: async (requestActor, ref) => {
            scope(requestActor);
            const entry = (await fresh()).records.find(
                record => contextSourceKeyV0(record.source) === contextSourceKeyV0(ref)
            );
            return entry ? { status: "allowed", entry, constraints: [] } : { status: "missing" };
        },
        readDocument: async (requestActor, documentId) => {
            scope(requestActor);
            if (!/^workspace-document\/[1-9]\d*$/.test(documentId)) return { status: "missing" };
            const entry = (await fresh()).records.find(
                record => record.source.kind === "doc" && record.source.id === documentId
            );
            return entry ? { status: "allowed", entry, constraints: [] } : { status: "missing" };
        },
        now,
    });
    async function loadView(): Promise<JosephPersonalViewV0> {
        const before = await snapshot(),
            frame = await fresh();
        const state = await provider.readPersonalState(input),
            roles = await provider.resolveBusinessRoles(input);
        let diagnostics: RequiredContextDiagnosticsV0,
            ready = false,
            blocker: string | undefined;
        try {
            diagnostics = (await provider.prepareRequiredContext({ ...input, roleContext: roles }))
                .diagnostics;
            ready = true;
        } catch (error) {
            if (!(error instanceof ContextPortErrorV0)) throw error;
            if (error instanceof RequiredContextErrorV0) diagnostics = error.diagnostics;
            else {
                // Joseph rejects an unreviewed Architecture before collecting other lanes.
                // This honest preview is not a usable RequiredContextBundle or assembled manifest.
                const company = architecture(frame);
                const checks: SourceCoverageDiagnosticV0[] = [];
                if (company)
                    checks.push({
                        lane: "company",
                        source: company,
                        companyId: actor.companyId,
                        principalRef: actor.principalRef,
                        module: "vantage",
                        status: "omitted",
                        checkedAt: now(),
                        reason:
                            company.reviewState === "unreviewed"
                                ? "Canonical Company Architecture is unreviewed; Joseph requires reviewed or unknowns-marked context."
                                : "Required context could not be verified.",
                    });
                else
                    checks.push({
                        lane: "company",
                        companyId: actor.companyId,
                        principalRef: actor.principalRef,
                        module: "vantage",
                        status: "missing",
                        checkedAt: now(),
                        reason: "Canonical Company Architecture is unavailable.",
                    });
                const inspect = (lane: "star" | "mandatory", ref: ContextSourceRefV0) => {
                    const entry = frame.records.find(record =>
                        lane === "star"
                            ? record.source.id === ref.id
                            : contextSourceKeyV0(record.source) === contextSourceKeyV0(ref)
                    );
                    const okay =
                        !!entry && (lane !== "mandatory" || entry.audience.kind === "company");
                    checks.push({
                        lane,
                        source: entry?.source ?? ref,
                        companyId: actor.companyId,
                        principalRef: actor.principalRef,
                        module: "vantage",
                        status: okay ? "used" : "missing",
                        checkedAt: now(),
                        ...(okay
                            ? { sourceDate: entry.sourceDate, excerptOffsets: entry.excerptOffsets }
                            : {
                                  reason: "Unavailable to this actor, missing, revoked or outside the reporting cutoff.",
                              }),
                    });
                };
                for (const ref of options.mandatoryRefs ?? []) inspect("mandatory", ref);
                for (const star of state.stars) inspect("star", star.lastKnownRef);
                const refs = (status?: SourceCoverageDiagnosticV0["status"]) => [
                    ...new Map(
                        checks
                            .filter(check => check.source && (!status || check.status === status))
                            .map(check => [contextSourceKeyV0(check.source!), check.source!])
                    ).values(),
                ];
                diagnostics = {
                    sources: checks,
                    coverage: {
                        checked: refs(),
                        used: refs("used"),
                        missing: refs("missing"),
                        revoked: [],
                        omitted: refs("omitted"),
                    },
                };
            }
            blocker =
                architecture(frame)?.reviewState === "unreviewed"
                    ? "Joseph required context is incomplete. The canonical profile remains unreviewed; no approval is fabricated."
                    : "Joseph required context is incomplete. Inspect unavailable or omitted required sources before continuing.";
        }
        const after = await snapshot(),
            latest = await fresh();
        if (
            before.digest !== after.digest ||
            sourceIdentity(frame.records) !== sourceIdentity(latest.records)
        )
            fail("personal_snapshot_changed");
        return {
            state,
            roles,
            documents: frame.records
                .filter(record => record.source.kind === "doc")
                .map(record => ({
                    id: record.source.id,
                    title:
                        record.citation?.title ??
                        `Workspace document ${record.source.id.replace("workspace-document/", "")}`,
                    version: record.source.version,
                    sourceDate: record.sourceDate,
                })),
            diagnostics,
            ready,
            ...(blocker ? { blocker } : {}),
            persistence: "server-process-memory",
            snapshot: after,
        };
    }
    async function withFreshState<T>(
        expected: JosephPersonalSnapshotV0 | string,
        work: () => Promise<T>
    ) {
        return locked(key, async () => {
            const current = await snapshot();
            if (current.digest !== (typeof expected === "string" ? expected : expected.digest))
                fail("personal_snapshot_changed");
            return work();
        });
    }
    return {
        provider,
        input,
        loadView,
        snapshot,
        fingerprint: async () => (await snapshot()).digest,
        withFreshState,
    };
}
export const createJosephPersonalHost = createJosephPersonalHostV0;
