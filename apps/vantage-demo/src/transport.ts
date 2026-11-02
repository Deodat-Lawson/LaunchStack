/** Recorded synthetic transport. Every request terminates here; no network delegate exists. */
import sample from "../../web/src/app/dev/vantage-action-sample/captured-sample.json";
import type {
    DemoState,
    DemoSource,
    DemoTopicReview,
} from "../../web/src/app/employer/tools/vantage/demo-contract";
import type { PersonalContextViewV0 } from "../../web/src/components/vantage-context/PersonalContextPanel";
import type { EvidenceDto, WeeklySignals } from "../../../pipelines/src/vantage/types";
import type { AgendaV1Dto } from "../../../pipelines/src/vantage/contract-v1";
import {
    resolveRoleSelectionV0,
    roleDirectoryV0,
} from "../../../pipelines/src/vantage/role-context-v0/roles";

type Data = Omit<typeof sample.data, "state" | "personal"> & {
    state: DemoState;
    personal: PersonalContextViewV0 & { persistence?: string; blocker?: string };
};
const clone = <T>(value: T): T => structuredClone(value);
const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
const failure = (status: number, error: string) =>
    reply({ error, code: "portable_recorded_only" }, status);

export function createPortableTransport(initial: Data = sample.data as unknown as Data) {
    const seed = clone(initial);
    let data = clone(seed);
    function markReplay() {
        data.state.generationMode = "replay";
        data.state.weeks = data.state.weeks.filter(
            week => week.weekStart === data.state.report?.weekStart
        );
        data.state.personalContextAvailable = true;
        const report = data.state.report;
        if (report)
            report.execution = {
                ...report.execution,
                mode: "replay",
                replay: {
                    fixtureId: "portable-recorded-orbit",
                    recordedAt: sample.provenance.capturedAt,
                    originalModelId: report.execution.modelId,
                },
            };
        data.personal.persistence = "browser-memory-only";
        for (const source of data.sources)
            source.authority = `Recorded synthetic snapshot from ${sample.provenance.capturedAt}; no live version or access check.`;
        if (data.state.companyArchitecture)
            data.state.companyArchitecture.authority = `Recorded synthetic snapshot from ${sample.provenance.capturedAt}; no live version or access check.`;
    }
    markReplay();
    const reset = () => {
        data = clone(seed);
        markReplay();
    };
    const stateFor = (week: string | null) => {
        const state = clone(data.state);
        if (week && week !== state.report?.weekStart) {
            state.selectedWeek = week;
            state.report = null;
            state.nativeAgendaId = null;
        }
        return state;
    };
    function evidence(): EvidenceDto[] {
        return data.sources.map((s, index) => ({
            id: `portable-evidence-${index}`,
            kind: "document",
            title: s.title,
            body: s.body,
            source: `Recorded synthetic ${s.source.kind}:${s.source.id}@${s.source.version}`,
            sourceUrl: null,
            observedAt: s.sourceDate?.slice(0, 10) ?? "2026-10-16",
            visibility: "private",
            tags: ["recorded-synthetic"],
            createdAt: s.sourceDate ?? sample.provenance.capturedAt,
        }));
    }
    const signals = (): WeeklySignals => ({
        weekStart: data.state.selectedWeek,
        since: "2026-10-05",
        computedAt: sample.provenance.capturedAt,
        metricChanges: [],
        metricConflicts: [],
        metricsWithoutData: [],
        newEvidence: [{ kind: "document", count: data.sources.length }],
        recentEvidenceIds: evidence().map(e => e.id),
        overdueCommitmentIds: [],
        dueThisWeekCommitmentIds: [],
        resolvedCommitmentIds: [],
        daysSinceLastEntry: 0,
    });
    function agenda(): AgendaV1Dto {
        const r = data.state.report!;
        return {
            id: data.state.nativeAgendaId ?? r.id,
            weekStart: r.weekStart,
            weekEnd: "2026-10-18",
            status: "draft",
            summary:
                "Recorded synthetic demo: contextual report available in Weekly Review. This minimal Rules carrier contains no generated native recommendations.",
            signals: signals(),
            modelMetadata: {
                portableSynthetic: true,
                source: "hand-authored-minimal-rules-carrier",
            },
            generatedAt: r.generatedAt,
            heldAt: null,
            createdAt: r.generatedAt,
            topics: [],
            reportPeriod: null,
            version: r.version,
            enhancements: [],
            execution: null,
        };
    }
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : null;
        const raw =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        let url: URL;
        try {
            url = new URL(raw, "http://portable.invalid");
        } catch {
            return failure(400, "Invalid portable request.");
        }
        // Relative local API requests only. Absolute URLs cannot escape to another host.
        if (!raw.startsWith("/api/vantage") || url.origin !== "http://portable.invalid")
            return failure(403, "Portable demo blocks all external and unsupported requests.");
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
        if (init?.signal?.aborted || request?.signal.aborted)
            throw new DOMException("Aborted", "AbortError");
        let body: Record<string, unknown> = {};
        try {
            const text =
                typeof init?.body === "string"
                    ? init.body
                    : request && method !== "GET"
                      ? await request.text()
                      : "";
            if (text) {
                const parsed: unknown = JSON.parse(text);
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                    return failure(400, "Expected an object.");
                body = parsed as Record<string, unknown>;
            }
        } catch {
            return failure(400, "Invalid JSON.");
        }
        const path = url.pathname;
        if (path === "/api/vantage/demo") {
            if (method === "GET") {
                const week = url.searchParams.get("week");
                if (week && week !== data.state.report?.weekStart)
                    return failure(
                        404,
                        `This portable package contains only the recorded week ${data.state.report?.weekStart}.`
                    );
                return reply(stateFor(week));
            }
            if (method === "POST") {
                if (body.weekStart !== seed.state.report?.weekStart)
                    return failure(404, "Only the recorded week can be replayed.");
                // Replay reloads the fixture; it never invokes a model or changes roles/stars.
                data.state = clone(seed.state);
                markReplay();
                return reply(data.state);
            }
        }
        if (path === "/api/vantage/demo/source" && method === "GET") {
            if (url.searchParams.get("reportId") !== data.state.report?.id)
                return failure(404, "Recorded report not found.");
            const source = data.sources.find(
                s =>
                    s.source.kind === url.searchParams.get("kind") &&
                    s.source.id === url.searchParams.get("id") &&
                    s.source.version === url.searchParams.get("version")
            );
            return source
                ? reply(source as DemoSource)
                : failure(404, "Exact recorded source version not found.");
        }
        if (path === "/api/vantage/demo/topics" && method === "PATCH") {
            const report = data.state.report;
            if (!report || body.reportId !== report.id)
                return failure(404, "Recorded report not found.");
            if (body.expectedVersion !== report.version)
                return failure(409, "Report changed; reload before editing.");
            const topic = report.topics.find(t => t.id === body.topicId);
            if (!topic) return failure(404, "Recorded topic not found.");
            const review = body as unknown as DemoTopicReview;
            if (review.status !== undefined && !["kept", "dismissed"].includes(review.status))
                return failure(400, "Unsupported review status.");
            if (
                review.decision !== undefined &&
                (!review.decision ||
                    !["go", "no-go", "needs-more-evidence"].includes(review.decision.value) ||
                    (review.decision.text !== undefined &&
                        (typeof review.decision.text !== "string" ||
                            review.decision.text.length > 1600)))
            )
                return failure(400, "Invalid local decision.");
            if (review.status === undefined && review.decision === undefined)
                return failure(400, "No review change supplied.");
            if (review.status) topic.status = review.status;
            if (review.decision)
                topic.decision = { ...review.decision, recordedAt: new Date().toISOString() };
            report.version++;
            return reply(data.state);
        }
        if (path === "/api/vantage/demo/personal") {
            if (method === "GET") return reply(data.personal);
            if (method === "PATCH") {
                const p = data.personal;
                if (body.expectedRevision !== p.state.revision)
                    return failure(409, "Personal context changed; reload.");
                if (body.operation === "roles") {
                    const ids: unknown[] = Array.isArray(body.roleIds)
                        ? (body.roleIds as unknown[])
                        : [];
                    const known = new Set(roleDirectoryV0().roles.map(r => r.id));
                    if (
                        !Array.isArray(ids) ||
                        !ids.length ||
                        ids.length > known.size ||
                        ids.some(id => typeof id !== "string" || !known.has(id)) ||
                        new Set(ids).size !== ids.length ||
                        (body.primaryRoleId !== undefined && !ids.includes(body.primaryRoleId))
                    )
                        return failure(
                            400,
                            "Choose known roles and a primary role within the selection."
                        );
                    const roleIds = ids.filter((id): id is string => typeof id === "string");
                    p.roles = resolveRoleSelectionV0({
                        principalRef: p.state.principalRef,
                        values: roleIds,
                        primaryRoleId:
                            typeof body.primaryRoleId === "string" ? body.primaryRoleId : undefined,
                        confirmed: true,
                    });
                    p.state.roles = {
                        roleIds,
                        ...(typeof body.primaryRoleId === "string"
                            ? { primaryRoleId: body.primaryRoleId }
                            : {}),
                        confirmedAt: new Date().toISOString(),
                    };
                } else if (body.operation === "star") {
                    const document = p.documents.find(d => d.id === body.documentId);
                    if (!document || typeof body.starred !== "boolean")
                        return failure(400, "Choose a recorded document.");
                    p.state.stars = p.state.stars.filter(s => s.documentId !== document.id);
                    if (body.starred)
                        p.state.stars.push({
                            documentId: document.id,
                            lastKnownRef: {
                                kind: "doc",
                                id: document.id,
                                version: document.version,
                            },
                            starredAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        });
                } else return failure(400, "Unsupported personal operation.");
                p.state.revision++;
                return reply(p);
            }
        }
        const pendingPath = `/api/vantage/agendas/${data.pending.agendaId}/pending-questions`;
        if (path === pendingPath) {
            if (method === "GET") return reply(data.pending);
            if (method === "PATCH") {
                if (body.expectedVersion !== data.pending.version)
                    return failure(409, "Pending questions changed; reload.");
                if (!["dismissed", "addressed"].includes(String(body.status)))
                    return failure(400, "Unsupported pending review.");
                const index = data.pending.questions.findIndex(
                    q => q.questionId === body.questionId
                );
                if (index < 0) return failure(404, "Pending question not found.");
                data.pending.questions.splice(index, 1);
                data.pending.version++;
                return reply(data.pending);
            }
        }
        if (method !== "GET")
            return failure(
                405,
                "This operation is unavailable in the recorded demo. No work was created."
            );
        if (path === "/api/vantage/agendas") {
            const a = agenda();
            const week = url.searchParams.get("week") ?? a.weekStart;
            return reply({
                week,
                agenda: week === a.weekStart ? a : null,
                agendas: [
                    {
                        id: a.id,
                        weekStart: a.weekStart,
                        weekEnd: a.weekEnd,
                        status: a.status,
                        topicCount: 0,
                        decidedCount: 0,
                        generatedAt: a.generatedAt,
                        heldAt: null,
                    },
                ],
            });
        }
        if (path === `/api/vantage/agendas/${data.state.nativeAgendaId}`)
            return reply({ agenda: agenda() });
        if (path === "/api/vantage/overview")
            return reply({
                today: "2026-10-18",
                agendaWeek: data.state.selectedWeek,
                agendaWeekEnd: "2026-10-18",
                agenda: agenda(),
                previousAgenda: null,
                signals: signals(),
                checkIns: data.commitments,
                recentEvidence: evidence(),
                counts: {
                    evidenceThisWindow: data.sources.length,
                    openCommitments: data.commitments.length,
                    metricsWithData: 0,
                },
                lastEntryAt: sample.provenance.capturedAt,
                daysSinceLastEntry: 0,
            });
        if (path === "/api/vantage/triage")
            return reply({
                today: "2026-10-18",
                helpRequests: [],
                missedCommitments: [],
                dueSoon: [],
                deadlines: [],
                lastEntryAt: sample.provenance.capturedAt,
                daysSinceLastEntry: 0,
                quiet: false,
            });
        if (path === "/api/vantage/evidence")
            return reply({
                evidence: evidence().filter(
                    e => !url.searchParams.get("kind") || e.kind === url.searchParams.get("kind")
                ),
            });
        if (path.startsWith("/api/vantage/evidence/")) {
            const found = evidence().find(
                e => e.id === decodeURIComponent(path.slice("/api/vantage/evidence/".length))
            );
            return found
                ? reply({ evidence: found })
                : failure(404, "Recorded evidence unavailable.");
        }
        if (path === "/api/vantage/metrics") return reply({ definitions: [], observations: [] });
        if (path === "/api/vantage/commitments") return reply({ commitments: data.commitments });
        if (path === "/api/vantage/deadlines") return reply({ deadlines: [] });
        return failure(404, "No recorded response exists for this request.");
    };
    return { fetch, reset, getSnapshot: () => clone(data) };
}

export function installPortableTransport(target: Pick<typeof globalThis, "fetch"> = globalThis) {
    const original = target.fetch;
    const transport = createPortableTransport();
    target.fetch = transport.fetch;
    return {
        ...transport,
        restore: () => {
            if (target.fetch === transport.fetch) target.fetch = original;
        },
    };
}
