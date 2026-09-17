/**
 * In-memory stand-in for `/api/prospects/*`, shaped exactly like the client
 * contract in `~/app/employer/tools/prospects/api`. It implements the rules
 * the UI relies on — legal stage moves with reasons, outreach refusals,
 * exclusions, a run that progresses in real time and adds companies when it
 * completes — so the screens behave as they will against the real backend.
 */
import type {
    CompaniesView,
    CompanyDetail,
    CompanyRow,
    DealDto,
    DealRow,
    HomeDto,
    PersonRow,
    RunDto,
    RunStep,
    SalesStage,
    SegmentDto,
    SegmentSummary,
    SourceRow,
    SourceYield,
    StageMove,
    StepStatus,
    TodoItem,
} from "~/app/employer/tools/prospects/api";

import {
    COMPANIES,
    FIT_THRESHOLD,
    PAST_RUNS,
    SEGMENTS,
    SOURCES,
    type WorldCompany,
    type WorldRunRecord,
    type WorldSegment,
    type WorldSource,
} from "./world";

const ALL_STAGES: SalesStage[] = [
    "lead",
    "qualified",
    "contacted",
    "meeting",
    "proposal",
    "negotiating",
    "won",
    "lost",
    "nurture",
];
const ORDER: SalesStage[] = [
    "lead",
    "qualified",
    "contacted",
    "meeting",
    "proposal",
    "negotiating",
    "won",
];
const IN_MOTION = new Set<SalesStage>(["contacted", "meeting", "proposal", "negotiating"]);
const STALE_AFTER: Partial<Record<SalesStage, number>> = {
    qualified: 14,
    contacted: 7,
    meeting: 10,
    proposal: 10,
    negotiating: 14,
};
const DAY = 86_400_000;
const STAGE_WORD: Record<SalesStage, string> = {
    lead: "Lead",
    qualified: "Qualified",
    contacted: "Contacted",
    meeting: "Meeting",
    proposal: "Proposal",
    negotiating: "Negotiating",
    won: "Won",
    lost: "Not a fit",
    nurture: "Nurture",
};

/** The main segment owns every company in the world; the draft owns none. */
const HOME_SEGMENT = "seg-fulfilment";

// ── Run timeline (ms since start) ─────────────────────────────────────────
const T = {
    sourcesEnd: 8000,
    shortlistEnd: 9000,
    signalsEnd: 9800,
    profilesEnd: 16000,
    peopleEnd: 18500,
    done: 19000,
    usd: 0.34,
    credits: 28,
    profiles: 25,
    peopleFor: 10,
};

interface LiveRun {
    id: string;
    segmentId: string;
    startedAt: number;
    stoppedAt: number | null;
    /** Sources as they were when the run started. */
    sources: WorldSource[];
    applied: boolean;
}

interface Store {
    companies: WorldCompany[];
    segments: WorldSegment[];
    sources: WorldSource[];
    pastRuns: WorldRunRecord[];
    liveRuns: LiveRun[];
    campaigns: number;
    seq: number;
}

let clock: () => number = () => Date.now();
/** Tests drive time explicitly. */
export function setSimulatorClock(fn: () => number): void {
    clock = fn;
}

function seed(): Store {
    return {
        companies: structuredClone(COMPANIES),
        segments: structuredClone(SEGMENTS),
        sources: structuredClone(SOURCES),
        pastRuns: structuredClone(PAST_RUNS),
        liveRuns: [],
        campaigns: 0,
        seq: 1,
    };
}

let store: Store = seed();

export function resetSimulator(): void {
    store = seed();
}

// ── Helpers ───────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

const err = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    json({ error, ...extra }, status);

const nowIso = () => new Date(clock()).toISOString();

/** A non-empty string from an untyped patch, else null. */
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function inSegment(c: WorldCompany, segmentId: string): boolean {
    return segmentId === HOME_SEGMENT && !c.reserve;
}

function sourceMeta(id: string): { label: string; kind: SourceRow["kind"] } {
    const s = store.sources.find(x => x.id === id);
    return { label: s?.label ?? id, kind: s?.kind ?? "api" };
}

function staleDays(c: WorldCompany): number | null {
    const after = STALE_AFTER[c.stage];
    if (!after) return null;
    const since = new Date(c.lastActivityAt ?? c.stageChangedAt).getTime();
    const days = Math.floor((clock() - since) / DAY);
    return days > after ? days : null;
}

function initials(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0]!.toUpperCase())
        .join("");
}

function moveReason(c: WorldCompany, to: SalesStage): string | null {
    if (to === c.stage) return "Current stage";
    if (c.excluded) return "Excluded companies cannot move";
    if (c.stage === "won" && to !== "nurture") return "Won deals stay won";
    if (to === "lost" || to === "nurture") return null;
    const ti = ORDER.indexOf(to);
    const ci = ORDER.indexOf(c.stage);
    if (ci >= 0 && ti < ci) return null;
    if (ti >= ORDER.indexOf("contacted") && !c.ownerName) return "Needs an owner";
    if (ti >= ORDER.indexOf("meeting") && !c.nextStep) return "Needs a next step";
    if (to === "won" && c.stage !== "proposal" && c.stage !== "negotiating")
        return "Needs a proposal first";
    return null;
}

function allowedMoves(c: WorldCompany): StageMove[] {
    return ALL_STAGES.map(stage => ({ stage, reason: moveReason(c, stage) }));
}

function toDeal(c: WorldCompany): DealDto {
    return {
        id: `deal-${c.id}`,
        companyId: c.id,
        stage: c.stage,
        ownerName: c.ownerName,
        ownerInitials: c.ownerName ? initials(c.ownerName) : null,
        nextStep: c.nextStep,
        nextStepAt: c.nextStepAt,
        stageChangedAt: c.stageChangedAt,
        lastActivityAt: c.lastActivityAt,
        staleDays: staleDays(c),
        allowedMoves: allowedMoves(c),
    };
}

function toRow(c: WorldCompany): CompanyRow {
    return {
        id: c.id,
        name: c.name,
        domain: c.domain,
        hq: c.hq,
        country: c.country,
        sizeBand: c.sizeBand,
        archetype: c.archetype,
        why: c.why,
        fit: c.fit,
        fitThreshold: FIT_THRESHOLD,
        stage: c.stage,
        staleDays: staleDays(c),
        people: c.people.length,
        lastActivityAt: c.lastActivityAt,
        foundVia: c.foundVia.map(f => ({
            sourceId: f.sourceId,
            ...sourceMeta(f.sourceId),
            url: f.url,
            at: f.at,
        })),
        isNew: c.isNew,
        excluded: c.excluded,
        excludedReason: c.excludedReason,
    };
}

function toPerson(c: WorldCompany, p: WorldCompany["people"][number]): PersonRow {
    return {
        id: p.id,
        companyId: c.id,
        companyName: c.name,
        name: p.name,
        initials: initials(p.name),
        title: p.title,
        seniority: p.seniority,
        email: p.email,
        emailStatus: p.emailStatus,
        source: p.source,
        sourceUrl: p.sourceUrl,
        blockedReason: c.excluded ? `Company excluded: ${c.excludedReason ?? "by you"}` : null,
    };
}

function toDetail(c: WorldCompany): CompanyDetail {
    return {
        ...toRow(c),
        about: c.about,
        whyFit: c.whyFit,
        openQuestions: c.openQuestions,
        signals: c.signals,
        evidence: c.evidence,
        people: c.people.map(p => toPerson(c, p)),
        deal: toDeal(c),
        fitBreakdown: c.fitBreakdown,
        profileDocumentTitle: c.profiledAt ? `${c.name} — profile` : null,
        profiledAt: c.profiledAt,
    };
}

function segmentCounts(segmentId: string): SegmentSummary["counts"] {
    const mine = store.companies.filter(c => inSegment(c, segmentId) && !c.excluded);
    return {
        companies: mine.length,
        people: mine.reduce((sum, c) => sum + c.people.length, 0),
        deals: mine.filter(c => c.stage !== "lead").length,
        sources: store.sources.filter(s => s.enabled && s.available).length,
    };
}

function toSegmentSummary(s: WorldSegment): SegmentSummary {
    return {
        id: s.id,
        name: s.name,
        subtitle: s.subtitle,
        headline: s.headline,
        status: s.status,
        counts: segmentCounts(s.id),
    };
}

function toSegment(s: WorldSegment): SegmentDto {
    return {
        ...toSegmentSummary(s),
        derivedAt: s.derivedAt,
        confirmedAt: s.confirmedAt,
        basis: s.basis,
        fields: s.fields,
    };
}

function toSource(s: WorldSource, segmentId: string): SourceRow {
    const latest = store.pastRuns.find(r => r.segmentId === segmentId);
    const y = latest?.sources.find(x => x.sourceId === s.id);
    return {
        id: s.id,
        label: s.label,
        kind: s.kind,
        description: s.description,
        enabled: s.enabled,
        available: s.available,
        requires: s.requires,
        cost: s.cost,
        lastYield:
            latest && y && y.status === "ok"
                ? {
                      found: y.found,
                      newCompanies: y.newCompanies,
                      cost:
                          s.cost === "free"
                              ? "free"
                              : `${Math.max(1, Math.round(y.found / 10))} credits`,
                      at: latest.startedAt,
                  }
                : null,
    };
}

function inDealsVia(sourceId: string, segmentId: string): number {
    return store.companies.filter(
        c =>
            inSegment(c, segmentId) &&
            !c.excluded &&
            (IN_MOTION.has(c.stage) || c.stage === "won") &&
            c.foundVia.some(f => f.sourceId === sourceId)
    ).length;
}

function toYield(rec: WorldRunRecord["sources"][number], segmentId: string): SourceYield {
    const meta = sourceMeta(rec.sourceId);
    return {
        sourceId: rec.sourceId,
        label: meta.label,
        kind: meta.kind,
        found: rec.found,
        newCompanies: rec.newCompanies,
        inDeals: inDealsVia(rec.sourceId, segmentId),
        status: rec.status,
        detail: rec.detail,
    };
}

// ── Runs ──────────────────────────────────────────────────────────────────

function elapsedOf(run: LiveRun): number {
    return (run.stoppedAt ?? clock()) - run.startedAt;
}

function runStatus(run: LiveRun): RunDto["status"] {
    if (run.stoppedAt !== null) return "stopped";
    return elapsedOf(run) >= T.done ? "completed" : "running";
}

function stepStatus(elapsed: number, start: number, end: number, stopped: boolean): StepStatus {
    if (elapsed >= end) return "done";
    if (elapsed >= start) return stopped ? "failed" : "running";
    return "waiting";
}

function sourceChildren(run: LiveRun, elapsed: number): RunStep[] {
    const stopped = run.stoppedAt !== null;
    return run.sources.map(s => {
        if (!s.enabled)
            return {
                id: s.id,
                label: s.label,
                detail: "off for this segment",
                status: "skipped",
                right: null,
            };
        if (!s.available)
            return {
                id: s.id,
                label: s.label,
                detail: `no ${s.requires ?? "key"}`,
                status: "skipped",
                right: null,
            };
        if (!s.run)
            return { id: s.id, label: s.label, detail: null, status: "skipped", right: null };
        const isSignal = s.kind === "signal";
        const start = isSignal ? T.shortlistEnd : 0;
        const end = isSignal ? T.signalsEnd : s.run.finishAtMs;
        const status = stepStatus(elapsed, start, end, stopped);
        const progress = Math.max(0, Math.min(1, (elapsed - start) / (end - start)));
        let right: string | null = null;
        if (status === "done")
            right = isSignal
                ? `${s.run.found} signals`
                : `${s.run.found} found · ${s.run.newCompanies} new`;
        else if (status === "running") right = `${Math.floor(s.run.found * progress)} so far`;
        else if (status === "failed") right = `${Math.floor(s.run.found * progress)} kept`;
        let detail: string | null = s.run.detail ?? null;
        if (s.id === "serper-maps" && status === "running")
            detail = `${Math.max(1, Math.floor(15 * progress))} of 15 cities`;
        if (isSignal && status === "waiting") detail = "after shortlist";
        return { id: s.id, label: s.label, detail, status, right };
    });
}

function fmtDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} s`;
    return `${Math.floor(s / 60)} min ${s % 60} s`;
}

function toRun(run: LiveRun): RunDto {
    const elapsed = elapsedOf(run);
    const stopped = run.stoppedAt !== null;
    const status = runStatus(run);
    const children = sourceChildren(run, elapsed);
    const active = children.filter(c => c.status !== "skipped");
    const doneCount = active.filter(c => c.status === "done").length;
    const sourcesStatus: StepStatus =
        doneCount === active.length
            ? "done"
            : stopped
              ? "failed"
              : elapsed > 0
                ? "running"
                : "waiting";
    const profilesProgress = Math.max(
        0,
        Math.min(1, (elapsed - T.signalsEnd) / (T.profilesEnd - T.signalsEnd))
    );
    const profiled = Math.floor(T.profiles * profilesProgress);
    const steps: RunStep[] = [
        {
            id: "segment",
            label: "Segment confirmed",
            detail: null,
            status: "done",
            right: null,
        },
        {
            id: "sources",
            label: "Sources",
            detail: `${doneCount} of ${active.length} done`,
            status: sourcesStatus,
            right: fmtDuration(Math.min(elapsed, T.sourcesEnd)),
            children,
        },
        {
            id: "shortlist",
            label: "Shortlist",
            detail: null,
            status: stepStatus(elapsed, T.sourcesEnd, T.shortlistEnd, stopped),
            right: elapsed >= T.shortlistEnd ? `${T.profiles} to profile` : null,
        },
        {
            id: "profiles",
            label: "Profiles",
            detail: `${profiled} of ${T.profiles}`,
            status: stepStatus(elapsed, T.signalsEnd, T.profilesEnd, stopped),
            right: null,
        },
        {
            id: "people",
            label: "People",
            detail: `top ${T.peopleFor}`,
            status: stepStatus(elapsed, T.profilesEnd, T.peopleEnd, stopped),
            right: null,
        },
    ];
    const frac = Math.min(1, elapsed / T.done);
    const summary =
        status === "completed" || status === "stopped"
            ? {
                  found: children.reduce(
                      (n, c) =>
                          n +
                          (c.status === "done"
                              ? (run.sources.find(s => s.id === c.id)?.run?.found ?? 0)
                              : 0),
                      0
                  ),
                  newCompanies:
                      status === "completed"
                          ? store.companies.filter(c => c.isNew && !c.reserve).length
                          : 0,
                  profiled: status === "completed" ? T.profiles : profiled,
                  people: status === "completed" ? T.peopleFor : 0,
                  durationMs: elapsed,
                  sources: run.sources.map(s => {
                      const child = children.find(c => c.id === s.id)!;
                      const rec: WorldRunRecord["sources"][number] = {
                          sourceId: s.id,
                          found: child.status === "done" ? (s.run?.found ?? 0) : 0,
                          newCompanies: child.status === "done" ? (s.run?.newCompanies ?? 0) : 0,
                          status: !s.enabled
                              ? "off"
                              : !s.available || !s.run
                                ? "skipped"
                                : child.status === "done"
                                  ? "ok"
                                  : "failed",
                          detail: !s.enabled
                              ? "off"
                              : !s.available
                                ? "no key"
                                : child.status === "done"
                                  ? null
                                  : "stopped",
                      };
                      return toYield(rec, run.segmentId);
                  }),
              }
            : null;
    return {
        id: run.id,
        segmentId: run.segmentId,
        status,
        startedAt: new Date(run.startedAt).toISOString(),
        completedAt:
            status === "completed"
                ? new Date(run.startedAt + T.done).toISOString()
                : stopped
                  ? new Date(run.stoppedAt!).toISOString()
                  : null,
        steps,
        spend: {
            usd: Math.round(T.usd * frac * 100) / 100,
            usdCap: 1,
            credits: Math.round(T.credits * frac),
        },
        caps: "Cap: 25 calls per source, 4 min",
        summary,
        errorMessage: null,
    };
}

/** When a run completes, the reserve companies enter the world as new. */
function applyCompletion(run: LiveRun): void {
    if (run.applied || runStatus(run) !== "completed") return;
    run.applied = true;
    const at = new Date(run.startedAt + T.done).toISOString();
    for (const c of store.companies) {
        if (c.reserve) {
            c.reserve = false;
            c.isNew = true;
            c.stageChangedAt = at;
            c.profiledAt = at;
            for (const f of c.foundVia) f.at = at;
        } else {
            c.isNew = false;
        }
    }
    const dto = toRun(run);
    store.pastRuns.unshift({
        id: run.id,
        segmentId: run.segmentId,
        startedAt: dto.startedAt,
        durationMs: T.done,
        spend: dto.spend,
        found: dto.summary?.found ?? 0,
        newCompanies: dto.summary?.newCompanies ?? 0,
        profiled: T.profiles,
        people: T.peopleFor,
        sources: run.sources.map(s => ({
            sourceId: s.id,
            found: s.enabled && s.available && s.run ? s.run.found : 0,
            newCompanies: s.enabled && s.available && s.run ? s.run.newCompanies : 0,
            status: !s.enabled ? "off" : !s.available ? "skipped" : s.run ? "ok" : "skipped",
            detail: !s.enabled ? "off" : !s.available ? "no key" : null,
        })),
    });
    store.liveRuns = store.liveRuns.filter(r => r.id !== run.id);
}

function settleRuns(): void {
    for (const run of [...store.liveRuns]) applyCompletion(run);
}

function pastToRun(rec: WorldRunRecord): RunDto {
    return {
        id: rec.id,
        segmentId: rec.segmentId,
        status: "completed",
        startedAt: rec.startedAt,
        completedAt: new Date(new Date(rec.startedAt).getTime() + rec.durationMs).toISOString(),
        steps: [],
        spend: rec.spend,
        caps: "Cap: 25 calls per source, 4 min",
        summary: {
            found: rec.found,
            newCompanies: rec.newCompanies,
            profiled: rec.profiled,
            people: rec.people,
            durationMs: rec.durationMs,
            sources: rec.sources.map(s => toYield(s, rec.segmentId)),
        },
        errorMessage: null,
    };
}

// ── Home ──────────────────────────────────────────────────────────────────

function home(segmentId: string): HomeDto | null {
    const seg = store.segments.find(s => s.id === segmentId);
    if (!seg) return null;
    const mine = store.companies.filter(c => inSegment(c, segmentId) && !c.excluded);
    const todo: TodoItem[] = [];

    const fresh = mine.filter(c => c.isNew).sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));
    const freshHigh = fresh.filter(c => (c.fit ?? 0) >= FIT_THRESHOLD);
    if (freshHigh.length > 0) {
        const bySource = new Map<string, number>();
        for (const c of freshHigh) {
            const first = c.foundVia[0];
            if (first) bySource.set(first.sourceId, (bySource.get(first.sourceId) ?? 0) + 1);
        }
        todo.push({
            id: "review-new",
            title: `Review ${freshHigh.length} new high-fit ${freshHigh.length === 1 ? "company" : "companies"} from the last run`,
            detail: [...bySource.entries()]
                .map(([id, n]) => `${sourceMeta(id).label} found ${n}`)
                .join(", "),
            action: { label: "Review", href: "/companies?view=new" },
        });
    }
    const endOfToday = new Date(clock());
    endOfToday.setHours(23, 59, 59, 999);
    const due = mine.filter(
        c => IN_MOTION.has(c.stage) && c.nextStepAt && new Date(c.nextStepAt) <= endOfToday
    );
    if (due.length > 0) {
        todo.push({
            id: "due",
            title: `${due.length} next ${due.length === 1 ? "step is" : "steps are"} due`,
            detail: due.map(c => `${c.name}: ${c.nextStep ?? "follow up"}`).join(" · "),
            action: { label: "Open deals", href: "/deals" },
        });
    }
    const stale = mine.map(c => ({ c, days: staleDays(c) })).filter(x => x.days !== null);
    if (stale.length > 0) {
        todo.push({
            id: "stale",
            title: `${stale.length} ${stale.length === 1 ? "deal has" : "deals have"} gone quiet`,
            detail: stale
                .map(x => `${x.c.name} in ${STAGE_WORD[x.c.stage]} for ${x.days} days`)
                .join(" · "),
            action: { label: "Follow up", href: "/deals" },
        });
    }

    const funnel = ORDER.map(stage => ({
        stage,
        count: mine.filter(c => c.stage === stage).length,
    }));
    const latest = store.pastRuns.find(r => r.segmentId === segmentId) ?? null;
    return {
        segment: toSegmentSummary(seg),
        lastRunAt: latest?.startedAt ?? null,
        todo,
        funnel,
        medianDays: mine.some(c => ["meeting", "proposal", "negotiating", "won"].includes(c.stage))
            ? { from: "contacted", to: "meeting", days: 6 }
            : null,
        yield: latest ? latest.sources.map(s => toYield(s, segmentId)) : [],
        fresh: fresh.slice(0, 4).map(toRow),
    };
}

// ── Router ────────────────────────────────────────────────────────────────

async function readBody(init?: RequestInit): Promise<Record<string, unknown>> {
    const raw = init?.body;
    if (typeof raw !== "string" || raw.length === 0) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/** Answers `/api/prospects/*`; returns null for anything else. */
export async function simulate(url: string, init?: RequestInit): Promise<Response | null> {
    const u = new URL(url, "http://prospects.local");
    if (!u.pathname.startsWith("/api/prospects")) return null;
    const method = (init?.method ?? "GET").toUpperCase();
    const parts = u.pathname
        .replace(/^\/api\/prospects\/?/, "")
        .split("/")
        .filter(Boolean);
    const segmentId = u.searchParams.get("segmentId") ?? HOME_SEGMENT;
    settleRuns();

    // /segments
    if (parts[0] === "segments") {
        if (parts.length === 1) return json({ segments: store.segments.map(toSegmentSummary) });
        const seg = store.segments.find(s => s.id === parts[1]);
        if (!seg) return err(404, "Segment not found");
        if (parts[2] === "confirm" && method === "POST") {
            seg.status = "confirmed";
            seg.confirmedAt = nowIso();
            return json({ segment: toSegment(seg) });
        }
        if (parts[2] === "derive" && method === "POST") {
            seg.derivedAt = nowIso();
            return json({ segment: toSegment(seg) });
        }
        if (method === "PATCH") {
            const body = await readBody(init);
            const fields = (body.fields ?? {}) as Record<string, string | string[]>;
            for (const [key, value] of Object.entries(fields)) {
                const field = seg.fields.find(f => f.key === key);
                if (field?.editable) field.value = value;
            }
            seg.status = "draft";
            seg.confirmedAt = null;
            seg.subtitle = seg.id === HOME_SEGMENT ? seg.subtitle : "Draft · not confirmed";
            return json({ segment: toSegment(seg) });
        }
        return json({ segment: toSegment(seg) });
    }

    if (parts[0] === "home") {
        const dto = home(segmentId);
        return dto ? json(dto) : err(404, "Segment not found");
    }

    // /companies
    if (parts[0] === "companies") {
        if (parts[1] === "exclude" && method === "POST") {
            const body = await readBody(init);
            const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
            const excluded = body.excluded !== false;
            let updated = 0;
            for (const c of store.companies) {
                if (!ids.includes(c.id)) continue;
                c.excluded = excluded;
                c.excludedReason = excluded ? "Excluded by you" : null;
                updated += 1;
            }
            return json({ updated });
        }
        if (parts.length === 1) {
            const view = (u.searchParams.get("view") ?? "all") as CompaniesView;
            const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
            const sort = u.searchParams.get("sort") ?? "fit";
            const mine = store.companies.filter(c => inSegment(c, segmentId));
            const viewFilter = (c: WorldCompany, v: CompaniesView) => {
                switch (v) {
                    case "all":
                        return !c.excluded;
                    case "new":
                        return !c.excluded && c.isNew;
                    case "highfit":
                        return !c.excluded && (c.fit ?? 0) >= FIT_THRESHOLD;
                    case "uncontacted":
                        return !c.excluded && (c.stage === "lead" || c.stage === "qualified");
                    case "excluded":
                        return c.excluded;
                }
            };
            const counts = Object.fromEntries(
                (["all", "new", "highfit", "uncontacted", "excluded"] as CompaniesView[]).map(v => [
                    v,
                    mine.filter(c => viewFilter(c, v)).length,
                ])
            ) as Record<CompaniesView, number>;
            let list = mine.filter(c => viewFilter(c, view));
            if (q)
                list = list.filter(c =>
                    [c.name, c.domain ?? "", c.hq, c.why, c.archetype].some(t =>
                        t.toLowerCase().includes(q)
                    )
                );
            const activity = (c: WorldCompany) =>
                new Date(c.lastActivityAt ?? c.stageChangedAt).getTime();
            list.sort((a, b) =>
                sort === "name"
                    ? a.name.localeCompare(b.name)
                    : sort === "activity"
                      ? activity(b) - activity(a)
                      : (b.fit ?? -1) - (a.fit ?? -1) || a.name.localeCompare(b.name)
            );
            return json({ companies: list.map(toRow), counts });
        }
        const c = store.companies.find(x => x.id === parts[1] && !x.reserve);
        if (!c) return err(404, "Company not found");
        return json({ company: toDetail(c) });
    }

    // /deals
    if (parts[0] === "deals") {
        if (parts.length === 1) {
            const mine = store.companies.filter(c => inSegment(c, segmentId) && !c.excluded);
            const deals: DealRow[] = mine.map(c => ({
                ...toDeal(c),
                companyName: c.name,
                domain: c.domain,
                fit: c.fit,
                fitThreshold: FIT_THRESHOLD,
            }));
            return json({ deals });
        }
        const companyId = parts[1]!.replace(/^deal-/, "");
        const c = store.companies.find(x => x.id === companyId);
        if (!c) return err(404, "Deal not found");
        if (method === "PATCH") {
            const body = await readBody(init);
            if ("ownerName" in body) c.ownerName = text(body.ownerName);
            if ("nextStep" in body) c.nextStep = text(body.nextStep);
            if ("nextStepAt" in body) c.nextStepAt = text(body.nextStepAt);
            if (typeof body.stage === "string") {
                const to = body.stage as SalesStage;
                if (!ALL_STAGES.includes(to)) return err(400, `Unknown stage "${to}"`);
                const reason = moveReason(c, to);
                if (reason) return err(409, `Cannot move to ${to}`, { reason });
                c.stage = to;
                c.stageChangedAt = nowIso();
            }
            c.lastActivityAt = nowIso();
            return json({ deal: toDeal(c) });
        }
        return json({ deal: toDeal(c) });
    }

    // /people
    if (parts[0] === "people") {
        const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
        const status = u.searchParams.get("status");
        let people: PersonRow[] = store.companies
            .filter(c => inSegment(c, segmentId))
            .flatMap(c => c.people.map(p => toPerson(c, p)));
        if (status) people = people.filter(p => p.emailStatus === status);
        if (q)
            people = people.filter(p =>
                [p.name, p.title, p.companyName, p.email ?? ""].some(t =>
                    t.toLowerCase().includes(q)
                )
            );
        people.sort(
            (a, b) => a.companyName.localeCompare(b.companyName) || a.name.localeCompare(b.name)
        );
        return json({ people });
    }

    // /outreach
    if (parts[0] === "outreach" && method === "POST") {
        const body = await readBody(init);
        const ids = Array.isArray(body.personIds) ? (body.personIds as string[]) : [];
        const skipped: Array<{ personId: string; reason: string }> = [];
        const okIds: string[] = [];
        for (const id of ids) {
            const c = store.companies.find(x => x.people.some(p => p.id === id));
            const p = c?.people.find(x => x.id === id);
            if (!c || !p) {
                skipped.push({ personId: id, reason: "Unknown person" });
                continue;
            }
            if (c.excluded) {
                skipped.push({
                    personId: id,
                    reason: `${c.name} is excluded: ${c.excludedReason ?? "by you"}`,
                });
                continue;
            }
            if (p.emailStatus === "guess") {
                skipped.push({ personId: id, reason: "Guessed address, confirm it first" });
                continue;
            }
            if (p.emailStatus === "generic") {
                skipped.push({ personId: id, reason: "Shared inbox" });
                continue;
            }
            okIds.push(id);
            c.lastActivityAt = nowIso();
        }
        if (okIds.length === 0)
            return err(409, "None of the selected people can be contacted yet", { skipped });
        store.campaigns += 1;
        return json(
            { campaignId: `campaign-${store.campaigns}`, people: okIds.length, skipped },
            201
        );
    }

    // /runs
    if (parts[0] === "runs") {
        if (parts.length === 1 && method === "POST") {
            const body = await readBody(init);
            const segId = typeof body.segmentId === "string" ? body.segmentId : segmentId;
            const seg = store.segments.find(s => s.id === segId);
            if (!seg) return err(404, "Segment not found");
            if (seg.status !== "confirmed") return err(409, "Confirm the segment before running");
            if (store.liveRuns.some(r => r.segmentId === segId && runStatus(r) === "running"))
                return err(409, "A run is already in progress for this segment");
            const run: LiveRun = {
                id: `run-${store.seq++}-${clock().toString(36)}`,
                segmentId: segId,
                startedAt: clock(),
                stoppedAt: null,
                sources: structuredClone(store.sources),
                applied: false,
            };
            store.liveRuns.push(run);
            return json({ run: toRun(run) }, 201);
        }
        if (parts.length === 1) {
            const live = store.liveRuns.filter(r => r.segmentId === segmentId).map(toRun);
            const past = store.pastRuns.filter(r => r.segmentId === segmentId).map(pastToRun);
            return json({ runs: [...live, ...past] });
        }
        const live = store.liveRuns.find(r => r.id === parts[1]);
        if (live) {
            if (parts[2] === "stop" && method === "POST") {
                if (live.stoppedAt === null && runStatus(live) === "running")
                    live.stoppedAt = clock();
                return json({ run: toRun(live) });
            }
            return json({ run: toRun(live) });
        }
        const past = store.pastRuns.find(r => r.id === parts[1]);
        if (past) return json({ run: pastToRun(past) });
        return err(404, "Run not found");
    }

    // /sources
    if (parts[0] === "sources") {
        if (parts.length === 1)
            return json({ sources: store.sources.map(s => toSource(s, segmentId)) });
        const s = store.sources.find(x => x.id === decodeURIComponent(parts[1]!));
        if (!s) return err(404, "Source not found");
        if (method === "PATCH") {
            const body = await readBody(init);
            if (!s.available && body.enabled === true)
                return err(409, `Needs ${s.requires ?? "a key"} in the environment`);
            if (typeof body.enabled === "boolean") s.enabled = body.enabled;
        }
        return json({ source: toSource(s, segmentId) });
    }

    return err(404, `No simulated route for ${method} ${u.pathname}`);
}

/** Test seam: how far the reserve has been released. */
export function _debugState(): {
    companies: number;
    reserve: number;
    liveRuns: number;
    pastRuns: number;
} {
    return {
        companies: store.companies.filter(c => !c.reserve).length,
        reserve: store.companies.filter(c => c.reserve).length,
        liveRuns: store.liveRuns.length,
        pastRuns: store.pastRuns.length,
    };
}
