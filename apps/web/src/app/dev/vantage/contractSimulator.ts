/** Development-only fixture transport. These are examples, never live generation evidence. */
import fixtures from "../../../../../../docs/design/examples/weekly-decision-agenda-v1.json";
import type {
    AgendaV1Dto,
    CommitmentDto,
    EvidenceDto,
    MetricDefinitionDto,
    MetricObservationDto,
    TopicV1Dto,
} from "~/app/employer/tools/vantage/api";
import {
    calendarAdd,
    defaultReportingWeek,
    mondayOf,
    validReportingDate,
} from "~/app/employer/tools/vantage/_lib/reporting";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sample = (name: string) => fixtures.http.find(item => item.name === name)!.response.body;
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const failure = (code: string, status: number) =>
    json({ error: code.replaceAll("_", " "), code }, status);
const clock = new Date(fixtures.clock);
const defaultWeek = defaultReportingWeek(clock);
// Fixture weeks always begin on Monday, away from New York's Sunday DST transition.
const mondayMidnight = (date: string) => {
    const localHourAtNoonUTC = Number(
        new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            hour: "2-digit",
            hourCycle: "h23",
        }).format(new Date(`${date}T12:00:00Z`))
    );
    return `${date}T${String(12 - localHourAtNoonUTC).padStart(2, "0")}:00:00.000Z`;
};

export class ContractSimulator {
    agendas = new Map<string, AgendaV1Dto>();
    evidence = clone(fixtures.internal.input.data.currentEvidence) as EvidenceDto[];
    definitions = clone(fixtures.internal.input.data.metricDefinitions) as MetricDefinitionDto[];
    observations = clone([
        ...fixtures.internal.input.data.currentObservations,
        ...fixtures.internal.input.data.comparisonObservations,
    ]) as MetricObservationDto[];
    commitments: CommitmentDto[] = [];
    submissions = new Map<string, { body: string; topicId: string }>();
    requests: { path: string; method: string; key: string | null }[] = [];
    lostOnce = false;
    constructor(readonly scenario = "ai") {
        if (scenario === "fresh") return;
        const name =
            scenario === "fallback"
                ? "Generate fallback agenda"
                : scenario === "empty"
                  ? "Generate empty agenda"
                  : "Generate AI agenda";
        const agenda = clone(sample(name).agenda) as AgendaV1Dto;
        if (scenario === "rules" && agenda.execution) {
            agenda.execution.mode = "rules";
            agenda.execution.modelId = null;
            agenda.execution.attempts = 0;
            agenda.topics.forEach(t => (t.origin = "rules"));
        }
        if (scenario === "legacy") {
            agenda.reportPeriod = null;
            agenda.execution = null;
        }
        if (agenda.topics.length && scenario !== "legacy") {
            agenda.topics[0]!.status = "kept";
            agenda.topics[0]!.contentVersion = 2;
            agenda.version = 2;
            agenda.enhancements = [
                {
                    ...clone(fixtures.internal.enrichment.enhancements[0]!),
                    id: "enhancement-demo-1",
                    kind: "question",
                    status: "suggested",
                    createdAt: fixtures.clock,
                },
            ];
        }
        this.agendas.set(agenda.weekStart, agenda);
    }
    async respond(url: URL, init?: RequestInit): Promise<Response | null> {
        if (url.pathname === "/api/fetchUserInfo")
            return json({
                role: "owner",
                roleName: "Owner",
                membershipStatus: "active",
                companyId: 1,
                company: "Contract fixture workspace",
                permissions: [
                    "settings.manage",
                    "documents.read",
                    "documents.edit",
                    "documents.upload",
                ],
            });
        if (!url.pathname.startsWith("/api/vantage/")) return null;
        const method = init?.method ?? "GET";
        const headers = new Headers(init?.headers);
        const key = headers.get("Idempotency-Key");
        this.requests.push({ path: url.pathname, method, key });
        if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const body =
            typeof init?.body === "string"
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : {};
        const parts = url.pathname.slice("/api/vantage/".length).split("/").map(decodeURIComponent);
        if (this.scenario === "denied") return failure("pilot_access_denied", 403);
        if (this.scenario === "signed-out") return failure("unauthorized", 401);
        const summaries = () =>
            [...this.agendas.values()].map(a => ({
                id: a.id,
                weekStart: a.weekStart,
                weekEnd: a.weekEnd,
                status: a.status,
                generatedAt: a.generatedAt,
                heldAt: a.heldAt,
                topicCount: a.topics.length,
                decidedCount: a.topics.filter(t => t.decision).length,
            }));
        if (parts[0] === "agendas") {
            if (method === "GET") {
                if (parts[1]) {
                    const agenda = [...this.agendas.values()].find(a => a.id === parts[1]);
                    return agenda ? json({ agenda }) : failure("not_found", 404);
                }
                const selected = url.searchParams.get("week") ?? defaultWeek;
                if (!validReportingDate(selected)) return failure("validation_error", 400);
                const week = mondayOf(selected);
                return json({ week, agenda: this.agendas.get(week) ?? null, agendas: summaries() });
            }
            if (method === "POST" && !parts[1]) {
                if (this.scenario === "unavailable") return failure("generation_unavailable", 503);
                if (this.scenario === "failed") return failure("generation_failed", 500);
                if (this.scenario === "stale") return failure("stale_agenda", 409);
                const week =
                    typeof body.weekStart === "string" ? mondayOf(body.weekStart) : defaultWeek;
                if (week > mondayOf("2026-10-17")) return failure("future_week", 400);
                const prior = this.agendas.get(week);
                const next = clone(
                    sample(
                        this.scenario === "fallback"
                            ? "Generate fallback agenda"
                            : this.scenario === "empty"
                              ? "Generate empty agenda"
                              : "Generate AI agenda"
                    ).agenda
                ) as AgendaV1Dto;
                next.id = prior?.id ?? `agenda-${crypto.randomUUID()}`;
                next.weekStart = week;
                next.weekEnd = calendarAdd(week, 6);
                next.version = (prior?.version ?? 0) + 1;
                // Fixed synthetic clock. Historic fixture periods use the appropriate end boundary.
                next.reportPeriod = {
                    ...next.reportPeriod!,
                    weekStart: week,
                    startInclusive: mondayMidnight(week),
                    endExclusive:
                        week < mondayOf("2026-10-17")
                            ? mondayMidnight(calendarAdd(week, 7))
                            : fixtures.clock,
                    kind: week < mondayOf("2026-10-17") ? "completed-week" : "week-to-date",
                };
                if (body.generationMode === "rules" && next.execution) {
                    next.execution.mode = "rules";
                    next.execution.fallbackReason = null;
                    next.execution.modelId = null;
                    next.execution.attempts = 0;
                    next.topics.forEach(t => (t.origin = "rules"));
                }
                const protectedTopics =
                    prior?.topics.filter(
                        t =>
                            t.origin === "founder" ||
                            t.status !== "suggested" ||
                            Boolean(t.decision) ||
                            t.contentVersion > 1
                    ) ?? [];
                next.topics = protectedTopics.length
                    ? clone(protectedTopics)
                    : next.topics.map(t => ({
                          ...t,
                          id: `topic-${crypto.randomUUID()}`,
                          agendaId: next.id,
                      }));
                next.enhancements = clone(prior?.enhancements ?? []);
                for (const topic of protectedTopics) {
                    if (
                        !next.enhancements.some(
                            e =>
                                e.topicId === topic.id &&
                                e.status === "suggested" &&
                                e.baseTopicVersion === topic.contentVersion
                        )
                    ) {
                        next.enhancements.push({
                            ...clone(fixtures.internal.enrichment.enhancements[0]!),
                            id: crypto.randomUUID(),
                            topicId: topic.id,
                            baseTopicVersion: topic.contentVersion,
                            kind: "question",
                            status: "suggested",
                            createdAt: fixtures.clock,
                        });
                    }
                }
                this.agendas.set(week, next);
                return json({ agenda: next }, 201);
            }
            if (method === "POST" && parts[2] === "topics") {
                const agenda = [...this.agendas.values()].find(a => a.id === parts[1]);
                if (!agenda) return failure("not_found", 404);
                const topic = {
                    ...clone((sample("Generate AI agenda").agenda as AgendaV1Dto).topics[0]),
                    ...body,
                    id: crypto.randomUUID(),
                    agendaId: agenda.id,
                    origin: "founder",
                    status: "kept",
                    contentVersion: 1,
                    position: agenda.topics.length,
                    shared: false,
                    decision: null,
                    decidedAt: null,
                    commitmentId: null,
                } as TopicV1Dto;
                agenda.topics.push(topic);
                agenda.version++;
                return json({ topic }, 201);
            }
        }
        if (parts[0] === "topics") {
            const agenda = [...this.agendas.values()].find(a =>
                a.topics.some(t => t.id === parts[1])
            );
            const topic = agenda?.topics.find(t => t.id === parts[1]);
            if (!agenda || !topic) return failure("not_found", 404);
            if (parts[2] === "enhancements" && method === "PATCH") {
                const enhancement = agenda.enhancements.find(
                    e => e.id === parts[3] && e.topicId === topic.id
                );
                if (!enhancement) return failure("not_found", 404);
                if (
                    body.baseTopicVersion !== topic.contentVersion ||
                    enhancement.baseTopicVersion !== topic.contentVersion
                )
                    return failure("stale_topic", 409);
                if (enhancement.status !== "suggested" && enhancement.status !== body.status)
                    return failure("enhancement_finalized", 409);
                if (body.status !== "accepted" && body.status !== "dismissed")
                    return failure("validation_error", 400);
                if (enhancement.status !== body.status) {
                    enhancement.status = body.status;
                    agenda.version++;
                }
                return json({ enhancement, agendaVersion: agenda.version });
            }
            if (parts[2] === "decide" && method === "POST") {
                if (!key) return failure("idempotency_key_required", 400);
                const submissionId = `${topic.id}:${key}`;
                const prior = this.submissions.get(submissionId);
                if (prior)
                    return prior.body === JSON.stringify(body)
                        ? json({ topic })
                        : failure("idempotency_conflict", 409);
                const action = body.commitment as {
                    title: string;
                    owner: string;
                    dueOn: string;
                    test: string;
                } | null;
                if (
                    !(typeof body.decision === "string" ? body.decision.trim() : "") ||
                    (action &&
                        (!action.owner?.trim() ||
                            !action.test?.trim() ||
                            !validReportingDate(action.dueOn)))
                )
                    return failure("validation_error", 400);
                if (action && topic.commitmentId) return failure("commitment_exists", 409);
                if (action) {
                    const commitment = {
                        ...clone(sample("List commitments").commitments![0]),
                        ...action,
                        id: crypto.randomUUID(),
                        agendaId: agenda.id,
                        topicId: topic.id,
                        topicTitle: topic.title,
                        status: "open",
                        shared: false,
                    } as CommitmentDto;
                    this.commitments.push(commitment);
                    topic.commitmentId = commitment.id;
                }
                topic.decision = String(body.decision);
                topic.decidedAt = fixtures.clock;
                topic.contentVersion++;
                topic.status = "kept";
                agenda.version++;
                this.submissions.set(submissionId, {
                    body: JSON.stringify(body),
                    topicId: topic.id,
                });
                if (this.scenario === "lost-response" && !this.lostOnce) {
                    this.lostOnce = true;
                    throw new TypeError("Simulated lost response after commit");
                }
                return json({ topic });
            }
            if (method === "PATCH" && !parts[2]) {
                Object.assign(topic, body, {
                    contentVersion: topic.contentVersion + 1,
                    shared: false,
                    status: body.status ?? "kept",
                });
                agenda.version++;
                return json({ topic });
            }
        }
        if (parts[0] === "commitments") {
            if (method === "GET") return json({ commitments: this.commitments });
            if (method === "POST") {
                const commitment = {
                    ...clone(sample("List commitments").commitments![0]),
                    ...body,
                    id: crypto.randomUUID(),
                    agendaId: null,
                    topicId: null,
                    topicTitle: null,
                    shared: false,
                } as CommitmentDto;
                this.commitments.push(commitment);
                return json({ commitment }, 201);
            }
            const item = this.commitments.find(c => c.id === parts[1]);
            if (!item) return failure("not_found", 404);
            if (method === "PATCH") {
                if (
                    body.status &&
                    body.status !== "open" &&
                    !(typeof body.outcome === "string" ? body.outcome.trim() : "")
                )
                    return failure("validation_error", 400);
                Object.assign(item, body);
                if (body.status) item.resolvedAt = body.status === "open" ? null : fixtures.clock;
                return json({ commitment: item });
            }
        }
        if (parts[0] === "evidence") {
            if (method === "GET") return json({ evidence: this.evidence });
            if (method === "POST") {
                const item = {
                    ...body,
                    id: crypto.randomUUID(),
                    createdAt: fixtures.clock,
                    visibility: "private",
                } as unknown as EvidenceDto;
                this.evidence.push(item);
                return json({ evidence: item }, 201);
            }
            const index = this.evidence.findIndex(e => e.id === parts[1]);
            if (index < 0) return failure("not_found", 404);
            if (method === "PATCH") {
                Object.assign(this.evidence[index]!, body);
                return json({ evidence: this.evidence[index] });
            }
            if (method === "DELETE") {
                this.evidence.splice(index, 1);
                return json({ ok: true });
            }
        }
        if (parts[0] === "metrics") {
            if (method === "GET")
                return json({ definitions: this.definitions, observations: this.observations });
            if (parts[1] === "import")
                return json(clone(sample("CSV import with a reported bad row")));
            if (parts[1] === "observations" && method === "POST") {
                const def = this.definitions.find(d => d.id === body.metricId);
                if (!def) return failure("not_found", 404);
                const item = {
                    ...body,
                    id: crypto.randomUUID(),
                    metricKey: def.key,
                    metricName: def.name,
                    createdAt: fixtures.clock,
                } as unknown as MetricObservationDto;
                this.observations.push(item);
                return json({ observations: [item] }, 201);
            }
            if (method === "POST" && !parts[1]) {
                const item = {
                    ...body,
                    id: crypto.randomUUID(),
                    key: typeof body.key === "string" && body.key ? body.key : crypto.randomUUID(),
                    createdAt: fixtures.clock,
                } as unknown as MetricDefinitionDto;
                this.definitions.push(item);
                return json({ definition: item }, 201);
            }
        }
        return failure("feature_unavailable", 403);
    }
}

let simulator: ContractSimulator | undefined;
export async function simulateContractVantage(url: URL, init?: RequestInit) {
    simulator ??= new ContractSimulator(
        new URLSearchParams(window.location.search).get("scenario") ?? "ai"
    );
    return simulator.respond(url, init);
}
