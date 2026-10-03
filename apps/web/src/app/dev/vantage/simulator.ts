/**
 * An in-memory stand-in for `/api/vantage/*`, so `/dev/vantage` renders
 * every Vantage screen populated, with no database, session or model. The
 * shapes are the real wire types (`tools/vantage/api.ts` re-exports the
 * vertical's DTOs), so a field the screens start reading that this does not
 * send is a type error here, not a blank cell in the preview.
 *
 * Dates are relative to today, so the week always looks current: a draft
 * agenda for the meeting ahead, last week's held one, a late commitment, a
 * notable metric swing and two sources disagreeing about signups. The data
 * lives for the page load; a reload starts over.
 */
import type {
    AgendaDto,
    AgendaSummaryDto,
    CommitmentDto,
    DeadlineDto,
    DecisionInput,
    EvidenceDto,
    EvidenceInput,
    MetricDefinitionDto,
    MetricObservationDto,
    OverviewDto,
    TopicDto,
    TopicInput,
    TopicPatch,
    TriageDto,
    VantageEvidenceKind,
    VantageEvidenceRef,
    WeeklySignals,
} from "~/app/employer/tools/vantage/api";
import { addDaysIso, todayIso } from "~/app/employer/tools/vantage/_lib/format";

interface World {
    /**
     * `?fresh=1`: the coming week's draft is held back until something asks
     * for it, so the preview shows Vantage drafting the week on arrival.
     */
    pendingDraft: AgendaDto | null;
    evidence: EvidenceDto[];
    definitions: MetricDefinitionDto[];
    observations: MetricObservationDto[];
    agendas: AgendaDto[];
    commitments: CommitmentDto[];
    deadlines: DeadlineDto[];
}

let seq = 100;
const id = (prefix: string) => `${prefix}_${++seq}`;
const stamp = (iso: string) => new Date(`${iso}T10:00:00`).toISOString();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Monday of the week containing `iso`. */
function mondayOf(iso: string): string {
    const day = new Date(`${iso}T12:00:00`).getDay();
    return addDaysIso(iso, -(day === 0 ? 6 : day - 1));
}

/** The meeting being prepared: this week until Wednesday, next week from Thursday (the vertical's rule). */
function agendaWeekFor(today: string): string {
    const day = new Date(`${today}T12:00:00`).getDay();
    return day === 0 || day >= 4 ? addDaysIso(mondayOf(today), 7) : mondayOf(today);
}

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

function makeTopic(
    agendaId: string,
    position: number,
    t: Partial<TopicDto> & Pick<TopicDto, "title">
): TopicDto {
    return {
        id: id("tp"),
        agendaId,
        position,
        status: "suggested",
        origin: "rules",
        facts: [],
        whyItMatters: "",
        decisionQuestion: "",
        proposedNextStep: "",
        proposedOwner: null,
        proposedDue: null,
        helpRequested: null,
        unknowns: [],
        conflicts: [],
        rationale: null,
        shared: false,
        decision: null,
        decidedAt: null,
        commitmentId: null,
        ...t,
    };
}

function makeAgenda(weekStart: string, a: Partial<AgendaDto> = {}): AgendaDto {
    return {
        id: id("ag"),
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
        status: "draft",
        summary: null,
        signals: null,
        modelMetadata: { mode: "rules", fallback: "no-model" },
        generatedAt: new Date().toISOString(),
        heldAt: null,
        createdAt: new Date().toISOString(),
        topics: [],
        ...a,
    };
}

const evRef = (e: EvidenceDto): VantageEvidenceRef => ({
    ref: `ev:${e.id}`,
    label: e.title,
    date: e.observedAt,
});
const obsRef = (o: MetricObservationDto): VantageEvidenceRef => ({
    ref: `obs:${o.id}`,
    label: `${o.metricName} ${o.value.toLocaleString()} (${o.source ?? "no source"})`,
    date: o.periodEnd,
});

// ---------------------------------------------------------------------------
// The seed: a two-founder B2B invoicing startup in a program
// ---------------------------------------------------------------------------

function seed(): World {
    const today = todayIso();
    const week = agendaWeekFor(today);
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
    const [betaEv, northwind, stall, , , claim, acme] = evidence as [EvidenceDto, ...EvidenceDto[]];

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
    const lastWeek = addDaysIso(mondayOf(today), -7);
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
    // Two sources disagreeing about last week's signups: the overview's conflict row and topic 2.
    const signups = observations.filter(o => o.metricKey === "signups");
    const [prevSignups, stripe] = [signups[2]!, signups[3]!];
    stripe.source = "Stripe export";
    const posthog = makeObservation(
        definitions[0]!,
        { ...stripe, value: 149, source: "PostHog" },
        stripe.createdAt
    );
    observations.push(posthog);
    const activated = observations.filter(o => o.metricKey === "activated").slice(-2);

    // Last week's meeting, held, with the decisions that opened this week's check-ins.
    const held = makeAgenda(addDaysIso(week, -7), {
        status: "held",
        summary: "Approvals are the wedge; onboarding is the leak.",
        heldAt: stamp(addDaysIso(week, -6)),
        modelMetadata: { mode: "rules" },
    });
    const beta = makeCommitment({
        agendaId: held.id,
        title: "Ship Slack approvals beta to three pilot teams",
        owner: "Ravi",
        dueOn: ago(2),
        test: "Three teams approve an invoice in Slack",
        status: "done",
        outcome: "Live for Northwind, Acme and Kestrel",
        shared: true,
        resolvedAt: stamp(ago(1)),
    });
    const calls = makeCommitment({
        agendaId: held.id,
        title: "Interview five teams that stalled at bank connection",
        owner: "Maya",
        dueOn: ago(1),
        test: "Five calls logged as evidence",
        shared: true,
    });
    held.topics = [
        makeTopic(held.id, 0, {
            title: "Northwind wants approvals in Slack",
            status: "kept",
            shared: true,
            decision: "Build Slack approvals as a beta for three pilots",
            decidedAt: held.heldAt,
            commitmentId: beta.id,
        }),
        makeTopic(held.id, 1, {
            title: "Onboarding drop-off after signup",
            status: "kept",
            decision: "Talk to teams that stalled before changing the flow",
            decidedAt: held.heldAt,
            commitmentId: calls.id,
        }),
        makeTopic(held.id, 2, {
            title: "A founding engineer this quarter?",
            status: "kept",
            origin: "founder",
            decision: "Not before the seed closes",
            decidedAt: held.heldAt,
        }),
        // Talked about, not decided: Vantage offers its next step as a commit.
        makeTopic(held.id, 3, {
            title: "Duplicate invoices from the CSV import",
            status: "kept",
            origin: "ai",
            facts: [
                {
                    text: "Two pilot teams reported duplicate invoices after a CSV import.",
                    refs: [],
                },
            ],
            whyItMatters: "A duplicate invoice reaches the customer's customer.",
            decisionQuestion: "Fix the import now, or pull CSV import until it is fixed?",
            proposedNextStep: "Add a duplicate check on invoice number before import",
            proposedOwner: "Ravi",
            proposedDue: addDaysIso(week, 2),
            rationale: "A repeated bug report from pilot teams.",
        }),
    ];
    [beta, calls].forEach((c, i) =>
        Object.assign(c, { topicId: held.topics[i]!.id, topicTitle: held.topics[i]!.title })
    );
    const older = makeAgenda(addDaysIso(week, -14), {
        status: "closed",
        summary: "Pricing settled; pilots next.",
        heldAt: stamp(addDaysIso(week, -13)),
    });
    older.topics = [
        makeTopic(older.id, 0, {
            title: "Annual plan as the default",
            status: "kept",
            decision: "Keep annual as the default",
            decidedAt: older.heldAt,
        }),
    ];

    // The meeting ahead: a draft showing every part a topic can have.
    const draft = makeAgenda(week, {
        summary:
            "More teams arrive and fewer reach a first invoice. Acme's rollout hinges on SSO, and the deck's growth number is ahead of the data.",
        modelMetadata: { mode: "ai", model: "preview" },
        generatedAt: stamp(ago(1)),
    });
    // Drafted by the model, as on a deployment with a chat model configured;
    // the signups conflict below is the rules' kind of topic and says so.
    const t = (position: number, fields: Partial<TopicDto> & Pick<TopicDto, "title">) =>
        makeTopic(draft.id, position, { origin: "ai", ...fields });
    draft.topics = [
        t(0, {
            title: "Signups up 29%, activation down",
            facts: [
                {
                    text: `Signups went from ${prevSignups.value} to ${stripe.value} week over week.`,
                    refs: [obsRef(prevSignups), obsRef(stripe)],
                },
                {
                    text: `Activated teams went from ${activated[0]!.value} to ${activated[1]!.value}.`,
                    refs: activated.map(obsRef),
                },
                {
                    text: "Most teams that did not activate stopped at bank connection.",
                    refs: [evRef(stall!)],
                },
            ],
            whyItMatters:
                "More people arrive and fewer reach a first invoice; paid acquisition would widen the leak.",
            decisionQuestion: "Do we pause the paid signup test until activation recovers?",
            proposedNextStep: "Let half of new signups invoice before connecting a bank",
            proposedOwner: "Ravi",
            proposedDue: addDaysIso(week, 4),
            unknowns: ["Whether the extra signups came from Product Hunt or the paid test"],
            rationale: "A notable change: signups +29% while activation fell.",
        }),
        t(1, {
            title: "Two numbers for last week's signups",
            origin: "rules",
            facts: [
                {
                    text: "Stripe and PostHog disagree about signups for one week.",
                    refs: [obsRef(stripe), obsRef(posthog)],
                },
            ],
            conflicts: [
                {
                    text: `Stripe export says ${stripe.value}; PostHog says ${posthog.value}.`,
                    refs: [obsRef(stripe), obsRef(posthog)],
                },
            ],
            whyItMatters: "Every growth number in the update depends on which one counts.",
            decisionQuestion: "Which source defines the signups metric?",
            proposedNextStep: "Write the definition down and backfill four weeks from one source",
            proposedOwner: "Maya",
            proposedDue: addDaysIso(week, 2),
            rationale: "Two observations for one metric and period disagree.",
        }),
        t(2, {
            title: "Acme's rollout hinges on SSO",
            status: "kept",
            shared: true,
            facts: [
                {
                    text: "Acme's IT will not approve a rollout without SAML SSO.",
                    refs: [evRef(acme!)],
                },
                { text: "The Slack approvals beta is live for Acme.", refs: [evRef(betaEv)] },
            ],
            whyItMatters: "140 seats is more than the current paying base, gated on one feature.",
            decisionQuestion: "Build SAML now, or buy it from an auth vendor?",
            proposedNextStep: "Price two SSO vendors against an in-house estimate",
            proposedOwner: "Ravi",
            proposedDue: addDaysIso(week, 3),
            helpRequested: "An intro to someone who has shipped SAML for a mid-market customer.",
            unknowns: ["Acme's deadline for the rollout decision"],
            rationale: "An interview names a blocker to the largest open deal.",
        }),
        t(3, {
            title: "The deck's growth claim is ahead of the data",
            facts: [
                {
                    text: "The seed deck claims 40% week-over-week signup growth.",
                    refs: [evRef(claim!)],
                },
                {
                    text: "Measured growth was 29% last week, negative the week before.",
                    refs: [obsRef(stripe)],
                },
                {
                    text: "Investors asked about growth on two of the last three calls.",
                    refs: [],
                    unsupported: true,
                },
            ],
            whyItMatters:
                "A deck number the data does not back is the first thing diligence finds.",
            decisionQuestion: "Correct the deck now, or restate the claim as monthly growth?",
            proposedNextStep: "Replace slide 6 with the four-week series and its source",
            proposedOwner: "Maya",
            proposedDue: addDaysIso(week, 1),
            rationale: "A claim in evidence conflicts with recorded metrics.",
        }),
        t(4, {
            title: "Northwind keeps asking about NetSuite",
            status: "dismissed",
            facts: [
                {
                    text: "NetSuite came up twice on the Northwind call.",
                    refs: [evRef(northwind!)],
                },
            ],
            decisionQuestion: "Scope a NetSuite sync?",
            rationale: "A repeated request in an interview.",
        }),
    ];

    const commitments = [
        beta,
        calls,
        makeCommitment({
            title: "Send the September investor update",
            owner: "Maya",
            dueOn: addDaysIso(today, 2),
            test: "Sent to the investor list",
        }),
        makeCommitment({
            title: "Fix duplicate invoices in CSV import",
            owner: "Ravi",
            dueOn: ago(6),
            status: "missed",
            outcome: "Fix slipped behind the beta",
            shared: true,
            resolvedAt: stamp(ago(4)),
        }),
        makeCommitment({
            title: "Draft a SOC 2 readiness checklist",
            owner: "Ravi",
            dueOn: addDaysIso(today, 9),
            shared: true,
        }),
        makeCommitment({
            title: "Close the pricing-page experiment",
            owner: "Maya",
            dueOn: ago(15),
            status: "dropped",
            outcome: "Superseded by the annual default",
            resolvedAt: stamp(ago(13)),
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

    const fresh =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("fresh") === "1";
    return {
        pendingDraft: fresh ? draft : null,
        evidence,
        definitions,
        observations,
        agendas: fresh ? [held, older] : [draft, held, older],
        commitments,
        deadlines,
    };
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
    const agendaWeek = agendaWeekFor(today);
    const signals = signalsFor(agendaWeek, today);
    const open = w().commitments.filter(c => c.status === "open");
    const check = new Set([...signals.overdueCommitmentIds, ...signals.dueThisWeekCommitmentIds]);
    return {
        today,
        agendaWeek,
        agendaWeekEnd: addDaysIso(agendaWeek, 6),
        agenda: w().agendas.find(a => a.weekStart === agendaWeek) ?? null,
        previousAgenda: w().agendas.find(a => a.weekStart === addDaysIso(agendaWeek, -7)) ?? null,
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
        helpRequests: w().agendas.flatMap(a =>
            a.topics
                .filter(t => t.shared && t.helpRequested && !t.decision)
                .map(topic => ({ topic, weekStart: a.weekStart, agendaId: a.id }))
        ),
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

const summary = (a: AgendaDto): AgendaSummaryDto => ({
    id: a.id,
    weekStart: a.weekStart,
    weekEnd: a.weekEnd,
    status: a.status,
    topicCount: a.topics.filter(t => t.status !== "dismissed").length,
    decidedCount: a.topics.filter(t => t.decision).length,
    generatedAt: a.generatedAt,
    heldAt: a.heldAt,
});

/**
 * "Prepare": a rules draft from the notable metric changes and the late
 * commitments. The rules are deterministic, so a week that still has
 * untouched suggestions would get the same ones again; only a week without
 * any gets new topics. Kept and edited topics always stay.
 */
function prepare(weekStart: string): AgendaDto {
    const held = w().pendingDraft;
    if (held && held.weekStart === weekStart && !w().agendas.some(a => a.weekStart === weekStart)) {
        w().pendingDraft = null;
        held.generatedAt = new Date().toISOString();
        w().agendas.push(held);
        return held;
    }
    const existing = w().agendas.find(a => a.weekStart === weekStart);
    const agenda =
        existing ??
        makeAgenda(weekStart, { summary: "Drafted from the numbers and what was promised." });
    if (!existing) w().agendas.push(agenda);
    if (!agenda.topics.some(t => t.status === "suggested")) {
        const signals = signalsFor(weekStart, todayIso());
        const fresh: (Partial<TopicDto> & Pick<TopicDto, "title">)[] = [
            ...signals.metricChanges
                .filter(c => c.notable)
                .map(c => ({
                    title: `${c.name} ${c.direction === "up" ? "jumped" : "fell"} ${Math.abs(Math.round((c.pct ?? 0) * 100))}%`,
                    facts: [
                        {
                            text: `${c.name} went from ${c.previous?.value} to ${c.latest.value}.`,
                            refs: [],
                        },
                    ],
                    decisionQuestion: `What do we do about ${c.name.toLowerCase()}?`,
                    rationale: "A notable metric change.",
                })),
            ...w()
                .commitments.filter(c => signals.overdueCommitmentIds.includes(c.id))
                .map(c => ({
                    title: `Late: ${c.title}`,
                    facts: [
                        {
                            text: `${c.owner} committed to this for ${c.dueOn}.`,
                            refs: [{ ref: `cm:${c.id}`, label: c.title, date: c.dueOn }],
                        },
                    ],
                    decisionQuestion: "Recommit with a new date, or drop it?",
                    rationale: "An overdue commitment.",
                })),
        ];
        agenda.topics = [
            ...agenda.topics,
            ...fresh
                .filter(f => !agenda.topics.some(t => t.title === f.title))
                .map(f => makeTopic(agenda.id, 0, f)),
        ].map((topic, position) => ({ ...topic, position }));
    }
    agenda.generatedAt = new Date().toISOString();
    return agenda;
}

function weeklyUpdate(agenda: AgendaDto, includePrivate: boolean): string {
    const topics = agenda.topics.filter(
        t => t.status !== "dismissed" && (includePrivate || t.shared)
    );
    return [
        `# Weekly update — week of ${agenda.weekStart}`,
        agenda.summary ?? "",
        ...topics.map(t =>
            [
                `## ${t.title}`,
                ...t.facts.map(f => `- ${f.text}`),
                `**Decision:** ${t.decision ?? t.decisionQuestion}`,
                t.helpRequested ? `**Help wanted:** ${t.helpRequested}` : "",
            ].join("\n")
        ),
    ].join("\n\n");
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
            company: "Ledgerline (preview)",
            permissions: admin ? ["settings.manage", "documents.upload"] : ["documents.upload"],
        });
    }
    const [api, tool, ...rest] = url.pathname.split("/").filter(Boolean);
    if (api !== "api" || tool !== "vantage") return null;

    // A short wait, so skeletons and busy states show the way they do live.
    await new Promise(resolve => setTimeout(resolve, 180));
    const method = (init?.method ?? "GET").toUpperCase();
    const body: Record<string, unknown> =
        typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const str = (key: string): string => {
        const value = body[key];
        return typeof value === "string" ? value : "";
    };
    const now = new Date().toISOString();
    // "PATCH topics/:id", "DELETE metrics/observations/:id": ids are this file's own `xx_123`.
    const route = `${method} ${rest.map(s => (/^[a-z]{2}_\d+$/.test(s) ? ":id" : s)).join("/")}`;
    const key = rest[1];
    const W = w();
    const agenda = find(W.agendas, key);
    const owner = W.agendas.find(a => a.topics.some(t => t.id === key));
    const topic = owner?.topics.find(t => t.id === key);

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

        case "GET agendas": {
            const param = url.searchParams.get("week");
            const week =
                param && ISO_DATE.test(param) ? mondayOf(param) : agendaWeekFor(todayIso());
            return json({
                week,
                agenda: W.agendas.find(a => a.weekStart === week) ?? null,
                agendas: [...W.agendas].sort(byDesc(a => a.weekStart)).map(summary),
            });
        }
        case "POST agendas": {
            const week = ISO_DATE.test(str("weekStart"))
                ? mondayOf(str("weekStart"))
                : agendaWeekFor(todayIso());
            // A model call takes a few seconds; let the drafting state show.
            await new Promise(resolve => setTimeout(resolve, 2400));
            return json({ agenda: prepare(week) }, 201);
        }
        case "GET agendas/:id":
            return agenda ? json({ agenda }) : missing();
        case "PATCH agendas/:id": {
            if (!agenda) return missing();
            agenda.status = str("status") as AgendaDto["status"];
            if (agenda.status === "held") agenda.heldAt ??= now;
            return json({ agenda });
        }
        case "POST agendas/:id/topics": {
            if (!agenda) return missing();
            if (!str("title").trim()) return json({ error: "Give the topic a title." }, 400);
            const created = makeTopic(agenda.id, agenda.topics.length, {
                ...(body as unknown as TopicInput),
                origin: "founder",
                status: "kept",
            });
            agenda.topics.push(created);
            return json({ topic: created }, 201);
        }
        case "POST agendas/:id/reorder": {
            if (!agenda) return missing();
            const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
            agenda.topics = agenda.topics.map(t =>
                ids.includes(t.id) ? { ...t, position: ids.indexOf(t.id) } : t
            );
            return json({ agenda });
        }
        case "GET agendas/:id/update": {
            if (!agenda) return missing();
            const includePrivate = url.searchParams.get("private") === "1";
            return json({ markdown: weeklyUpdate(agenda, includePrivate) });
        }

        case "PATCH topics/:id": {
            if (!topic) return missing();
            const patch = body as TopicPatch;
            // As the real store does: an edit to a suggestion makes it the
            // founder's, so regenerating leaves it alone.
            const status = patch.status ?? (topic.status === "suggested" ? "kept" : topic.status);
            return json({ topic: Object.assign(topic, patch, { status }) });
        }
        case "DELETE topics/:id":
            if (owner) owner.topics = owner.topics.filter(t => t.id !== key);
            return json({ ok: true });
        case "POST topics/:id/decide": {
            if (!owner || !topic) return missing();
            const input = body as unknown as DecisionInput;
            if (!str("decision").trim()) return json({ error: "Write the decision down." }, 400);
            Object.assign(topic, { decision: input.decision, decidedAt: now });
            if (topic.status === "suggested") topic.status = "kept";
            if (input.commitment) {
                const c = makeCommitment({
                    ...input.commitment,
                    agendaId: owner.id,
                    topicId: topic.id,
                    topicTitle: topic.title,
                });
                W.commitments.push(c);
                topic.commitmentId = c.id;
            }
            return json({ topic });
        }

        case "DELETE topics/:id/decide": {
            if (!owner || !topic) return missing();
            const commitment = url.searchParams.get("commitment");
            Object.assign(topic, { decision: null, decidedAt: null });
            if (commitment)
                W.commitments = W.commitments.filter(
                    c => !(c.id === commitment && c.topicId === topic.id)
                );
            topic.commitmentId = W.commitments.find(c => c.topicId === topic.id)?.id ?? null;
            return json({ topic });
        }

        case "GET commitments": {
            const status = url.searchParams.get("status");
            return json({ commitments: W.commitments.filter(c => !status || c.status === status) });
        }
        case "POST commitments": {
            if (!str("title").trim() || !str("owner").trim()) {
                return json({ error: "A commitment needs a title and an owner." }, 400);
            }
            const commitment = makeCommitment({
                title: str("title"),
                owner: str("owner"),
                dueOn: str("dueOn"),
                test: str("test") || null,
                shared: body.shared === true,
            });
            W.commitments.push(commitment);
            return json({ commitment }, 201);
        }
        case "PATCH commitments/:id": {
            const commitment = find(W.commitments, key);
            if (!commitment) return missing();
            Object.assign(commitment, body);
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
