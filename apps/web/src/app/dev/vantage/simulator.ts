/**
 * An in-memory stand-in for `/api/vantage/*`, so `/dev/vantage` renders
 * the current Vantage screens populated, with no database, session or model. The
 * shapes are the real wire types (`tools/vantage/api.ts` re-exports the
 * vertical's DTOs), so a field the screens start reading that this does not
 * send is a type error here, not a blank cell in the preview.
 *
 * The fictional fixture lives for the page load; a reload starts over.
 * Weekly-review generation is deterministic and never calls a model.
 */
import type {
    CommitmentDto,
    DeadlineDto,
    EvidenceDto,
    EvidenceInput,
    MetricDefinitionDto,
    MetricObservationDto,
    TriageDto,
    OverviewDto,
    WeeklySignals,
    VantageEvidenceKind,
} from "~/app/employer/tools/vantage/api";
import { simulateWeeklyReview } from "./weekly-review-fixture";
import { parseIsoDate, weekStartOf } from "@launchstack/pipelines/vantage/week";
import { addDaysIso, todayIso } from "~/app/employer/tools/vantage/_lib/format";

interface World {
    evidence: EvidenceDto[];
    definitions: MetricDefinitionDto[];
    observations: MetricObservationDto[];
    commitments: CommitmentDto[];
    deadlines: DeadlineDto[];
    commitmentRequests?: Map<string, { body: string; commitment: CommitmentDto }>;
}

let seq = 100;
const id = (prefix: string) => `${prefix}_${++seq}`;
const stamp = (iso: string) => new Date(`${iso}T10:00:00`).toISOString();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Factories, shared by the seed and the write routes
// ---------------------------------------------------------------------------

function makeEvidence(input: EvidenceInput, createdAt = new Date().toISOString()): EvidenceDto {
    return {
        id: id("ev"),
        kind: input.kind,
        title: input.title,
        body: input.body,
        source: input.source ?? null,
        sourceUrl: input.sourceUrl ?? null,
        observedAt: input.observedAt,
        visibility: input.visibility ?? "private",
        tags: input.tags ?? [],
        createdAt,
    };
}

function makeObservation(
    def: MetricDefinitionDto,
    o: { value: number; periodStart: string; periodEnd: string; source?: string | null },
    createdAt = new Date().toISOString()
): MetricObservationDto {
    return {
        id: id("ob"),
        metricId: def.id,
        metricKey: def.key,
        metricName: def.name,
        value: o.value,
        periodStart: o.periodStart,
        periodEnd: o.periodEnd,
        source: o.source ?? null,
        note: null,
        createdAt,
    };
}

function makeCommitment(
    c: Partial<CommitmentDto> & Pick<CommitmentDto, "title" | "owner" | "dueOn">
): CommitmentDto {
    return {
        id: id("cm"),
        contentVersion: 1,
        agendaId: null,
        topicId: null,
        topicTitle: null,
        test: null,
        status: "open",
        outcome: null,
        shared: false,
        resolvedAt: null,
        createdAt: new Date().toISOString(),
        ...c,
    };
}

// ---------------------------------------------------------------------------
// The seed: a two-founder B2B invoicing startup in a program
// ---------------------------------------------------------------------------

function seed(): World {
    const today = todayIso();
    const ago = (n: number) => addDaysIso(today, -n);
    const ev = (
        kind: VantageEvidenceKind,
        daysAgo: number,
        title: string,
        body: string,
        source: string,
        more: Partial<EvidenceInput> = {}
    ) =>
        makeEvidence(
            { kind, title, body, source, observedAt: ago(daysAgo), ...more },
            stamp(ago(daysAgo))
        );

    const evidence = [
        ev(
            "task",
            1,
            "Slack approvals beta live for three pilots",
            "Northwind, Acme and Kestrel route approvals through Slack. Median time to approve: 40 minutes.",
            "Release notes",
            { visibility: "shared" }
        ),
        ev(
            "interview",
            2,
            "Northwind: approvals sit in email for three days",
            "Dana (ops lead) would pay to route approvals through Slack. Asked twice about NetSuite.",
            "Call with Dana Ortiz, Northwind Freight",
            { visibility: "shared" }
        ),
        ev(
            "note",
            3,
            "Onboarding stalls at the bank connection step",
            "Of 38 teams that did not activate last week, 24 stopped at 'connect your bank'.",
            "PostHog funnel"
        ),
        ev(
            "interview",
            4,
            "Brightline Clinics left after the trial",
            "Needed invoicing across three clinic entities. Would come back if multi-entity ships.",
            "Exit call with Sam Reyes"
        ),
        ev(
            "link",
            5,
            "Activation funnel dashboard",
            "The weekly activation funnel, split by signup source.",
            "PostHog",
            { sourceUrl: "https://example.com/dashboards/activation" }
        ),
        ev(
            "claim",
            6,
            "Seed deck: 40% week-over-week signup growth",
            "Slide 6 claims 40% week-over-week signup growth for the last month.",
            "Seed deck v3, slide 6"
        ),
        ev(
            "interview",
            8,
            "Acme Logistics needs SSO before rollout",
            "IT will not approve a company-wide rollout without SAML SSO. 140 seats if it ships this quarter.",
            "Call with Priya Nair, Acme Logistics",
            { visibility: "shared" }
        ),
        ev(
            "note",
            20,
            "Annual plan as the pricing-page default",
            "Annual share went from 18% to 31% over two weeks; conversion unchanged.",
            "Stripe"
        ),
    ];

    const def = (key: string, name: string, definition: string, unit = "count") => ({
        id: id("md"),
        key,
        name,
        definition,
        unit,
        createdAt: stamp(ago(60)),
    });
    const definitions: MetricDefinitionDto[] = [
        def("signups", "Signups", "New workspaces, excluding our own test accounts."),
        def(
            "activated",
            "Activated teams",
            "Teams that sent a first invoice within 7 days of signup."
        ),
        def(
            "weekly_active",
            "Weekly active teams",
            "Teams that created or approved an invoice that week."
        ),
        def("paying", "Paying customers", "Teams on a paid plan at the end of the week."),
        def("mrr", "MRR", "Monthly recurring revenue at week end, after discounts.", "usd"),
    ];
    const series: number[][] = [
        [118, 131, 126, 162],
        [41, 44, 39, 38],
        [212, 220, 231, 236],
        [27, 28, 30, 31],
        [9800, 10150, 10900, 11240],
    ];
    const lastWeek = addDaysIso(weekStartOf(parseIsoDate(today)!), -7);
    const observations = definitions.flatMap((d, m) =>
        series[m]!.map((value, i) => {
            const periodStart = addDaysIso(lastWeek, -7 * (3 - i));
            const source = d.unit === "usd" || d.key === "paying" ? "Stripe" : "PostHog";
            const at = stamp(addDaysIso(periodStart, 7));
            return makeObservation(
                d,
                { value, periodStart, periodEnd: addDaysIso(periodStart, 6), source },
                at
            );
        })
    );
    // Two fictional source observations disagree about last week's signups.
    const signups = observations.filter(o => o.metricKey === "signups");
    const stripe = signups[3]!;
    stripe.source = "Stripe export";
    const posthog = makeObservation(
        definitions[0]!,
        { ...stripe, value: 149, source: "PostHog" },
        stripe.createdAt
    );
    observations.push(posthog);

    const commitments = [
        makeCommitment({
            title: "Interview five teams stalled at bank connection",
            owner: "Maya",
            dueOn: ago(1),
            test: "Five customer calls logged",
            shared: true,
        }),
    ];

    const deadline = (title: string, dueOn: string, note: string | null = null): DeadlineDto => ({
        id: id("dl"),
        title,
        dueOn,
        note,
        createdAt: stamp(ago(30)),
    });
    const deadlines = [
        deadline("Applications close: Series A prep cohort", ago(3)),
        deadline(
            "Monthly program report",
            addDaysIso(today, 5),
            "One page: numbers, decisions, asks"
        ),
        deadline("Demo day rehearsal", addDaysIso(today, 12), "Ten minutes with the partners"),
    ];

    return { evidence, definitions, observations, commitments, deadlines };
}

let world: World | null = null;
const w = () => (world ??= seed());

// ---------------------------------------------------------------------------
// Derived views: the parts of the service layer the screens read
// ---------------------------------------------------------------------------

const byDesc =
    <T>(key: (t: T) => string) =>
    (a: T, b: T) =>
        key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0;

function lastEntryAt(): string | null {
    return (
        [...w().evidence, ...w().observations]
            .map(x => x.createdAt)
            .sort()
            .pop() ?? null
    );
}

function daysSince(iso: string | null): number | null {
    return iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000)) : null;
}

function signalsFor(weekStart: string, today: string): WeeklySignals {
    const { evidence, definitions, observations, commitments } = w();
    const since = addDaysIso(today, -14);
    const signals: WeeklySignals = {
        weekStart,
        since,
        computedAt: new Date().toISOString(),
        metricChanges: [],
        metricConflicts: [],
        metricsWithoutData: [],
        newEvidence: [],
        recentEvidenceIds: [],
        overdueCommitmentIds: [],
        dueThisWeekCommitmentIds: [],
        resolvedCommitmentIds: [],
        daysSinceLastEntry: daysSince(lastEntryAt()),
    };
    const point = (o: MetricObservationDto) => ({
        observationId: o.id,
        value: o.value,
        periodStart: o.periodStart,
        periodEnd: o.periodEnd,
    });
    for (const d of definitions) {
        const rows = observations.filter(o => o.metricId === d.id).sort(byDesc(o => o.periodEnd));
        const latest = rows[0];
        if (!latest || latest.periodEnd < since) {
            signals.metricsWithoutData.push({ metricId: d.id, key: d.key, name: d.name });
            continue;
        }
        const twin = rows.find(o => o !== latest && o.periodStart === latest.periodStart);
        if (twin && twin.value !== latest.value) {
            const side = (o: MetricObservationDto) => ({ ...point(o), source: o.source });
            signals.metricConflicts.push({
                metricId: d.id,
                key: d.key,
                name: d.name,
                a: side(latest),
                b: side(twin),
            });
        }
        const previous = rows.find(o => o.periodEnd < latest.periodStart) ?? null;
        const delta = previous ? latest.value - previous.value : null;
        const pct = previous && previous.value !== 0 ? (delta ?? 0) / previous.value : null;
        signals.metricChanges.push({
            metricId: d.id,
            key: d.key,
            name: d.name,
            unit: d.unit,
            definition: d.definition,
            latest: point(latest),
            previous: previous ? point(previous) : null,
            delta,
            pct,
            direction: delta === null ? "new" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
            notable: pct !== null && Math.abs(pct) >= 0.2,
        });
    }
    const recent = evidence.filter(e => e.observedAt >= since);
    const kinds = new Map<VantageEvidenceKind, number>();
    for (const e of recent) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    signals.newEvidence = [...kinds].map(([kind, count]) => ({ kind, count }));
    signals.recentEvidenceIds = recent.filter(e => e.kind === "interview").map(e => e.id);
    for (const c of commitments) {
        if (c.status !== "open") {
            if (c.resolvedAt && c.resolvedAt >= stamp(since))
                signals.resolvedCommitmentIds.push(c.id);
        } else if (c.dueOn < today) signals.overdueCommitmentIds.push(c.id);
        else if (c.dueOn <= addDaysIso(weekStart, 6)) signals.dueThisWeekCommitmentIds.push(c.id);
    }
    return signals;
}

function overview(): OverviewDto {
    const today = todayIso();
    const agendaWeek = weekStartOf(parseIsoDate(today)!);
    const signals = signalsFor(agendaWeek, today);
    const open = w().commitments.filter(c => c.status === "open");
    const check = new Set([...signals.overdueCommitmentIds, ...signals.dueThisWeekCommitmentIds]);
    return {
        today,
        agendaWeek,
        agendaWeekEnd: addDaysIso(agendaWeek, 6),
        agenda: null,
        previousAgenda: null,
        signals,
        checkIns: open.filter(c => check.has(c.id)),
        recentEvidence: w()
            .evidence.filter(e => e.observedAt >= signals.since)
            .sort(byDesc(e => e.observedAt))
            .slice(0, 8),
        counts: {
            evidenceThisWindow: signals.newEvidence.reduce((n, e) => n + e.count, 0),
            openCommitments: open.length,
            metricsWithData: signals.metricChanges.length,
        },
        lastEntryAt: lastEntryAt(),
        daysSinceLastEntry: signals.daysSinceLastEntry,
    };
}

function triage(): TriageDto {
    const today = todayIso();
    const shared = w().commitments.filter(c => c.shared);
    const days = daysSince(lastEntryAt());
    return {
        today,
        helpRequests: [],
        missedCommitments: shared.filter(
            c => c.status === "missed" || (c.status === "open" && c.dueOn < today)
        ),
        dueSoon: shared.filter(
            c => c.status === "open" && c.dueOn >= today && c.dueOn <= addDaysIso(today, 14)
        ),
        deadlines: w()
            .deadlines.filter(d => d.dueOn >= addDaysIso(today, -7))
            .sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1)),
        lastEntryAt: lastEntryAt(),
        daysSinceLastEntry: days,
        quiet: days === null || days > 7,
    };
}

/** The import's happy path: `metric,value,period_start[,period_end][,source]`. */
function importCsv(csv: string, source: string | null) {
    const [head = "", ...lines] = csv.trim().split(/\r?\n/);
    const cols = head.split(",").map(c => c.trim().toLowerCase());
    const cell = (row: string[], name: string) => row[cols.indexOf(name)]?.trim() ?? "";
    const result = {
        imported: 0,
        problems: [] as { line: number; message: string }[],
        createdMetrics: [] as string[],
    };
    lines.forEach((line, i) => {
        const row = line.split(",");
        const metric = cell(row, "metric");
        const value = Number(cell(row, "value"));
        const periodStart = cell(row, "period_start") || cell(row, "period");
        if (!metric || !Number.isFinite(value) || !ISO_DATE.test(periodStart)) {
            result.problems.push({ line: i + 2, message: "Needs a metric, a number and a date" });
            return;
        }
        let def = w().definitions.find(
            d => d.key === metric || d.name.toLowerCase() === metric.toLowerCase()
        );
        if (!def) {
            def = {
                id: id("md"),
                key: metric,
                name: metric,
                definition: "",
                unit: "count",
                createdAt: new Date().toISOString(),
            };
            w().definitions.push(def);
            result.createdMetrics.push(metric);
        }
        const periodEnd = cell(row, "period_end") || periodStart;
        w().observations.push(
            makeObservation(def, {
                value,
                periodStart,
                periodEnd,
                source: cell(row, "source") || source,
            })
        );
        result.imported++;
    });
    return result;
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const missing = () => json({ error: "That is not here." }, 404);
const observationsNewestFirst = () => [...w().observations].sort(byDesc(o => o.periodEnd));
const find = <T extends { id: string }>(list: T[], key: string | undefined) =>
    list.find(x => x.id === key);

/**
 * Answers a `/api/vantage/*` request, plus the permissions lookup the
 * Program group waits on. Anything else returns null and goes to the
 * network. `admin` is whether the preview person holds `settings.manage`.
 */
export async function simulateVantage(
    url: URL,
    init: RequestInit | undefined,
    admin: boolean
): Promise<Response | null> {
    if (url.pathname === "/api/fetchUserInfo") {
        return json({
            role: admin ? "owner" : "member",
            roleName: admin ? "Owner" : "Member",
            membershipStatus: "active",
            companyId: 1,
            company: "Harborlight (fictional preview)",
            permissions: admin ? ["settings.manage", "documents.upload"] : ["documents.upload"],
        });
    }
    const [api, tool, ...rest] = url.pathname.split("/").filter(Boolean);
    if (api !== "api" || tool !== "vantage") return null;

    if (rest[0] === "reviews") return simulateWeeklyReview(url, init, admin);
    const method = (init?.method ?? "GET").toUpperCase();
    const body: Record<string, unknown> =
        typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const str = (key: string): string => {
        const value = body[key];
        return typeof value === "string" ? value : "";
    };
    const now = new Date().toISOString();
    // Mutable supporting records use this fixture's own `xx_123` identifiers.
    const route = `${method} ${rest.map(s => (/^[a-z]{2}_\d+$/.test(s) ? ":id" : s)).join("/")}`;
    const key = rest[1];
    const W = w();
    switch (route) {
        case "GET overview":
            return json(overview());
        case "GET triage":
            return json(triage());

        case "GET evidence": {
            const kind = url.searchParams.get("kind");
            const since = url.searchParams.get("since");
            const evidence = W.evidence
                .filter(e => (!kind || e.kind === kind) && (!since || e.observedAt >= since))
                .sort(byDesc(e => `${e.observedAt}${e.createdAt}`));
            return json({ evidence });
        }
        case "POST evidence": {
            if (!str("title").trim()) return json({ error: "Give it a title." }, 400);
            const evidence = makeEvidence(body as unknown as EvidenceInput);
            W.evidence.push(evidence);
            return json({ evidence }, 201);
        }
        case "PATCH evidence/:id": {
            const evidence = find(W.evidence, key);
            return evidence ? json({ evidence: Object.assign(evidence, body) }) : missing();
        }
        case "DELETE evidence/:id":
            W.evidence = W.evidence.filter(e => e.id !== key);
            return json({ ok: true });

        case "GET metrics":
            return json({ definitions: W.definitions, observations: observationsNewestFirst() });
        case "POST metrics": {
            const name = str("name").trim();
            if (!name) return json({ error: "Name the metric." }, 400);
            const definition: MetricDefinitionDto = {
                id: id("md"),
                key: str("key") || name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                name,
                definition: str("definition"),
                unit: str("unit") || "count",
                createdAt: now,
            };
            W.definitions.push(definition);
            return json({ definition }, 201);
        }
        case "PATCH metrics/:id": {
            const definition = find(W.definitions, key);
            if (!definition) return missing();
            Object.assign(definition, body);
            for (const o of W.observations) if (o.metricId === key) o.metricName = definition.name;
            return json({ definition });
        }
        case "DELETE metrics/:id":
            W.definitions = W.definitions.filter(d => d.id !== key);
            W.observations = W.observations.filter(o => o.metricId !== key);
            return json({ ok: true });
        case "POST metrics/import":
            return json(importCsv(str("csv"), str("source") || null));
        case "POST metrics/observations": {
            const def = find(W.definitions, str("metricId"));
            if (!def) return json({ error: "Pick a metric." }, 400);
            const o = body as { value: number; periodStart: string; periodEnd: string };
            W.observations.push({
                ...makeObservation(def, { ...o, source: str("source") || null }),
                note: str("note") || null,
            });
            return json({ observations: observationsNewestFirst() }, 201);
        }
        case "DELETE metrics/observations/:id":
            W.observations = W.observations.filter(o => o.id !== rest[2]);
            return json({ ok: true });

        case "GET commitments": {
            const status = url.searchParams.get("status");
            return json({ commitments: W.commitments.filter(c => !status || c.status === status) });
        }
        case "POST commitments": {
            if (!str("title").trim() || !str("owner").trim()) {
                return json({ error: "A commitment needs a title and an owner." }, 400);
            }
            const requestKey = new Headers(init?.headers).get("Idempotency-Key");
            const encoded = JSON.stringify(body);
            const requests = (W.commitmentRequests ??= new Map<
                string,
                { body: string; commitment: CommitmentDto }
            >());
            const prior = requestKey ? requests.get(requestKey) : undefined;
            if (prior)
                return prior.body === encoded
                    ? json({ commitment: prior.commitment }, 201)
                    : json({ error: "idempotency_conflict" }, 409);
            const commitment = makeCommitment({
                title: str("title"),
                owner: str("owner"),
                dueOn: str("dueOn"),
                test: str("test") || null,
                shared: body.shared === true,
            });
            W.commitments.push(commitment);
            if (requestKey) requests.set(requestKey, { body: encoded, commitment });
            return json({ commitment }, 201);
        }
        case "PATCH commitments/:id": {
            const commitment = find(W.commitments, key);
            if (!commitment) return missing();
            if (
                body.expectedContentVersion !== undefined &&
                body.expectedContentVersion !== commitment.contentVersion
            )
                return json({ error: "stale_commitment" }, 409);
            Object.assign(commitment, body);
            commitment.contentVersion++;
            if (str("status")) commitment.resolvedAt = str("status") === "open" ? null : now;
            return json({ commitment });
        }
        case "DELETE commitments/:id":
            W.commitments = W.commitments.filter(c => c.id !== key);
            return json({ ok: true });

        case "GET deadlines":
            return json({ deadlines: W.deadlines });
        case "POST deadlines": {
            // The one write the real API gates on settings.manage.
            if (!admin) return json({ error: "Only an administrator can add deadlines." }, 403);
            const deadline: DeadlineDto = {
                id: id("dl"),
                title: str("title"),
                dueOn: str("dueOn"),
                note: str("note") || null,
                createdAt: now,
            };
            W.deadlines.push(deadline);
            return json({ deadline }, 201);
        }
        case "DELETE deadlines/:id":
            W.deadlines = W.deadlines.filter(d => d.id !== key);
            return json({ ok: true });
    }
    return missing();
}
