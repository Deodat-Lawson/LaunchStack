/**
 * In-memory `/api/proposals/*` for the preview harness: a literacy nonprofit
 * with a built profile, a handful of found funders, three applications in
 * different states, a small library, and runs that advance in real time
 * and change the world when they finish — funders appear, a request
 * becomes sections, sections get drafts, a review lands. The profile itself
 * is the shared company profile, simulated in ../company-profile.
 */
import type {
    ApplicationDetail,
    ApplicationRow,
    ApplicationStatus,
    CountsDto,
    EvidenceDto,
    FunderRow,
    FunderStatus,
    HomeDto,
    LibraryItemDto,
    ProfileStatus,
    ApplicantType,
    RequirementDto,
    RunDto,
    RunKind,
    RunStepDto,
    SectionDto,
    SourceOption,
} from "~/app/employer/tools/proposals/api";

const DAY = 86_400_000;

/**
 * The organisation profile the home summarises. Proposals no longer builds
 * or serves it: it is the shared company profile at `/api/company/profile`
 * (see ../company-profile/simulator). The home still reports its status
 * and size, which is all this is kept for.
 */
interface SimProfile {
    status: ProfileStatus;
    error: string | null;
    builtAt: string | null;
    summary: string | null;
    applicantType: ApplicantType | null;
    focusAreas: string[];
    geography: string[];
    facts: Array<{
        key: string;
        label: string;
        value: string;
        cites: number[];
        source: "documents" | "profile" | "manual";
    }>;
    evidence: EvidenceDto[];
    builtFrom: { documents: number; snippets: number } | null;
    sources: number;
}

type World = {
    profile: SimProfile;
    funders: FunderRow[];
    applications: ApplicationDetail[];
    library: LibraryItemDto[];
    runs: LiveRun[];
    seq: number;
};

interface LiveRun {
    dto: RunDto;
    startedAt: number;
    /** ms after start at which each step completes. */
    plan: number[];
    applied: boolean;
    input: {
        applicationId?: string;
        sectionIds?: string[];
        keywords?: string[];
        preset?: string;
        instruction?: string;
    };
}

let clock: () => number = () => Date.now();
export function setProposalsSimClock(fn: () => number): void {
    clock = fn;
}
const nowIso = () => new Date(clock()).toISOString();
/** A string from an untyped body, else empty. */
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const day = (offsetDays: number) => new Date(clock() + offsetDays * DAY).toISOString().slice(0, 10);
const daysLeft = (d: string | null) =>
    d
        ? Math.round(
              (new Date(`${d}T00:00:00Z`).getTime() - new Date(nowIso().slice(0, 10)).getTime()) /
                  DAY
          )
        : null;

const EVIDENCE: EvidenceDto[] = [
    {
        n: 1,
        documentId: 101,
        title: "Annual report 2025",
        page: 2,
        quote: "Founded in 2014, Riverbend Literacy runs after-school reading programmes in 6 Portland elementary schools, serving 420 children a year.",
        url: null,
        href: "/employer/documents?source=d101",
    },
    {
        n: 2,
        documentId: 101,
        title: "Annual report 2025",
        page: 7,
        quote: "In 2025, 78% of participants gained at least one reading level; 91% of families reported reading together more often.",
        url: null,
        href: "/employer/documents?source=d101",
    },
    {
        n: 3,
        documentId: 102,
        title: "Meyer Trust proposal 2024",
        page: 1,
        quote: "Our FY2025 budget is $1.18m: 58% foundation grants, 27% individual donors, 15% school district contracts.",
        url: null,
        href: "/employer/documents?source=d102",
    },
    {
        n: 4,
        documentId: 103,
        title: "Strategic plan 2026–2028",
        page: 4,
        quote: "By 2028 we will reach 1,000 children a year across Multnomah County, adding a summer programme in 2026.",
        url: null,
        href: "/employer/documents?source=d103",
    },
    {
        n: 5,
        documentId: 104,
        title: "Board roster",
        page: 1,
        quote: "Executive Director Maya Chen (12 years in K-5 education); a board of nine including two former principals.",
        url: null,
        href: "/employer/documents?source=d104",
    },
];

function seedProfile(): SimProfile {
    return {
        status: "ready",
        error: null,
        builtAt: new Date(clock() - 3 * DAY).toISOString(),
        summary:
            "Riverbend Literacy is a Portland nonprofit that runs after-school reading programmes in six elementary schools, reaching about 420 children a year with trained volunteer tutors.",
        applicantType: "nonprofit",
        focusAreas: ["youth literacy", "after-school programmes", "family engagement"],
        geography: ["Portland, Oregon", "Multnomah County"],
        facts: [
            {
                key: "mission",
                label: "Mission",
                value: "Every child in Portland reads at grade level by the end of third grade.",
                cites: [1],
                source: "documents",
            },
            { key: "founded", label: "Founded", value: "2014", cites: [1], source: "documents" },
            {
                key: "programs",
                label: "Programmes",
                value: "After-school reading in 6 elementary schools, three afternoons a week, with trained volunteer tutors.",
                cites: [1],
                source: "documents",
            },
            {
                key: "outcomes",
                label: "Outcomes",
                value: "78% of participants gained a reading level in 2025; 91% of families read together more often.",
                cites: [2],
                source: "documents",
            },
            {
                key: "annual_budget",
                label: "Annual budget",
                value: "$1.18m in FY2025 — 58% foundation grants, 27% individual donors, 15% district contracts.",
                cites: [3],
                source: "documents",
            },
            {
                key: "leadership",
                label: "Leadership",
                value: "Executive Director Maya Chen, 12 years in K-5 education; a board of nine.",
                cites: [5],
                source: "documents",
            },
            {
                key: "plans",
                label: "Plans",
                value: "Reach 1,000 children a year by 2028; a summer programme launches in 2026.",
                cites: [4],
                source: "documents",
            },
        ],
        evidence: EVIDENCE,
        builtFrom: { documents: 4, snippets: 5 },
        sources: 14,
    };
}

function funder(
    partial: Partial<FunderRow> & { id: string; title: string; funder: string }
): FunderRow {
    return {
        source: "grants_gov",
        url: `https://www.grants.gov/search-results-detail/${partial.id}`,
        summary: null,
        closesOn: null,
        daysLeft: null,
        status: "candidate",
        amountMin: null,
        amountMax: null,
        eligibility: "Nonprofit organizations with 501(c)(3) status",
        fit: null,
        why: [],
        concerns: [],
        applicationId: null,
        foundAt: new Date(clock() - DAY).toISOString(),
        ...partial,
    };
}

function seedFunders(): FunderRow[] {
    return [
        funder({
            id: "f-ed",
            title: "Literacy Innovation Program",
            funder: "Department of Education",
            closesOn: day(41),
            amountMin: 50_000,
            amountMax: 250_000,
            fit: 86,
            why: [
                "Names K-5 reading programmes with measured outcomes",
                "Nonprofits eligible; Oregon in scope",
            ],
            concerns: ["Federal reporting every quarter"],
            summary:
                "Supports evidence-based reading interventions for K-5 students in Title I schools.",
            status: "saved",
        }),
        funder({
            id: "f-meyer",
            source: "web",
            title: "Community Grants — Education",
            funder: "Meyer Memorial Trust",
            url: "https://mmt.org/apply",
            closesOn: day(19),
            amountMax: 150_000,
            fit: 82,
            why: ["Oregon funder focused on equitable education", "Past grantee"],
            concerns: [],
            summary: "Multi-year support for Oregon organisations advancing educational equity.",
        }),
        funder({
            id: "f-imls",
            title: "Laura Bush 21st Century Librarian",
            funder: "Institute of Museum and Library Services",
            closesOn: day(70),
            amountMax: 500_000,
            fit: 41,
            why: ["Literacy adjacent"],
            concerns: ["Meant for libraries and library schools, not after-school programmes"],
        }),
        funder({
            id: "f-nea",
            title: "Arts Education Projects",
            funder: "National Endowment for the Arts",
            closesOn: day(12),
            amountMax: 100_000,
            fit: 22,
            why: [],
            concerns: ["Arts education, not reading", "Requires an arts partner"],
        }),
        funder({
            id: "f-oct",
            source: "web",
            title: "Oregon Community Foundation — Community Grants",
            funder: "Oregon Community Foundation",
            url: "https://oregoncf.org/grants",
            closesOn: day(55),
            amountMax: 60_000,
            fit: 74,
            why: ["Oregon-wide funder with a youth focus"],
            concerns: ["Smaller awards; one application per year"],
        }),
        funder({
            id: "f-past",
            title: "Summer Reading Initiative",
            funder: "Oregon Department of Education",
            closesOn: day(-9),
            amountMax: 80_000,
            fit: 68,
            why: ["Matches the planned summer programme"],
            concerns: ["Closed this cycle"],
            status: "dismissed",
        }),
    ];
}

function section(
    partial: Partial<SectionDto> & { id: string; key: string; question: string }
): SectionDto {
    return {
        guidance: null,
        wordLimit: null,
        required: true,
        status: "empty",
        draft: null,
        cites: [],
        gaps: [],
        evidence: [],
        libraryItemIds: [],
        draftedAt: null,
        ...partial,
        words: partial.draft ? partial.draft.trim().split(/\s+/).length : 0,
    };
}

const MEYER_SECTIONS: SectionDto[] = [
    section({
        id: "s-need",
        key: "statement-of-need",
        question: "Describe the need your project addresses.",
        guidance: "Use local data. Name who is affected and how you know.",
        wordLimit: 300,
        status: "approved",
        draft: "In Multnomah County, 43% of third graders read below grade level, and the gap is widest in the six Title I schools where we work. Since 2014 we have served 420 children a year there, three afternoons a week, because a child who cannot read by the end of third grade is four times less likely to finish high school. Families tell us the same thing our data shows: 91% of them read together more often once their child joins.",
        cites: [1, 2],
        evidence: EVIDENCE,
        draftedAt: new Date(clock() - 2 * DAY).toISOString(),
    }),
    section({
        id: "s-approach",
        key: "project-description",
        question: "Describe the project, its activities and timeline.",
        guidance: "Be specific about what happens, when, and for whom.",
        wordLimit: 500,
        status: "drafted",
        draft: "We will open two more school sites in September 2026 and launch a six-week summer programme in July, reaching 640 children in the grant year. Each site runs three afternoons a week with a site lead and eight trained volunteer tutors at a 1:3 ratio.",
        cites: [1, 4],
        gaps: ["Names of the two new schools", "Summer programme dates"],
        evidence: EVIDENCE,
        draftedAt: new Date(clock() - DAY).toISOString(),
    }),
    section({
        id: "s-outcomes",
        key: "outcomes-and-evaluation",
        question: "What outcomes will you measure and how?",
        wordLimit: 250,
    }),
    section({
        id: "s-budget",
        key: "budget-narrative",
        question: "Explain the budget and how the grant will be spent.",
        wordLimit: 300,
    }),
    section({
        id: "s-capacity",
        key: "organizational-capacity",
        question: "Describe your organisation's capacity to deliver.",
        wordLimit: 200,
    }),
];

const MEYER_REQUIREMENTS: RequirementDto[] = [
    {
        id: "eligibility:501c3",
        kind: "eligibility",
        text: "501(c)(3) organisation based in Oregon",
        done: true,
        sectionKey: null,
    },
    {
        id: "eligibility:budget",
        kind: "eligibility",
        text: "Annual budget under $5m",
        done: false,
        sectionKey: null,
    },
    {
        id: "deadline",
        kind: "deadline",
        text: `Submit by ${day(19)}`,
        done: false,
        sectionKey: null,
    },
    {
        id: "budget",
        kind: "budget",
        text: "Request at most $150,000",
        done: false,
        sectionKey: null,
    },
    ...MEYER_SECTIONS.map<RequirementDto>(s => ({
        id: `section:${s.key}`,
        kind: "section",
        text: `Answer: ${s.question}${s.wordLimit ? ` (${s.wordLimit} words)` : ""}`,
        done: s.status === "approved",
        sectionKey: s.key,
    })),
    {
        id: "attachment:budget",
        kind: "attachment",
        text: "Project budget (their template)",
        done: false,
        sectionKey: null,
    },
    {
        id: "attachment:irs",
        kind: "attachment",
        text: "IRS determination letter",
        done: true,
        sectionKey: null,
    },
    {
        id: "attachment:financials",
        kind: "attachment",
        text: "Most recent audited financial statements",
        done: false,
        sectionKey: null,
    },
    {
        id: "format:portal",
        kind: "format",
        text: "Submit through the MMT portal as PDF",
        done: false,
        sectionKey: null,
    },
];

function readiness(app: Pick<ApplicationDetail, "sectionList" | "requirements">): number {
    const credit = { empty: 0, drafted: 0.6, edited: 0.85, approved: 1 } as const;
    const required = app.sectionList.filter(s => s.required);
    const s = required.length
        ? required.reduce((sum, x) => sum + credit[x.status], 0) / required.length
        : null;
    const checklist = app.requirements.filter(r => r.kind !== "section");
    const c = checklist.length ? checklist.filter(r => r.done).length / checklist.length : null;
    if (s === null && c === null) return 0;
    if (s === null) return Math.round(c! * 100);
    if (c === null) return Math.round(s * 100);
    return Math.round((s * 0.7 + c * 0.3) * 100);
}

function application(
    partial: Partial<ApplicationDetail> & { id: string; title: string }
): ApplicationDetail {
    const base: ApplicationDetail = {
        funder: null,
        status: "draft",
        deadline: null,
        daysLeft: null,
        readiness: 0,
        sections: { total: 0, written: 0, approved: 0 },
        blockers: 0,
        updatedAt: new Date(clock() - DAY).toISOString(),
        opportunityId: null,
        requestText: null,
        requestUrl: null,
        requestDocumentId: null,
        requestSummary: null,
        amountMin: null,
        amountMax: null,
        requirements: [],
        sectionList: [],
        review: null,
        notes: null,
        exportedDocumentId: null,
        exportedHref: null,
        ...partial,
    };
    return refresh(base);
}

function refresh(app: ApplicationDetail): ApplicationDetail {
    const requirements = app.requirements.map(r =>
        r.kind === "section"
            ? {
                  ...r,
                  done: app.sectionList.find(s => s.key === r.sectionKey)?.status === "approved",
              }
            : r
    );
    return {
        ...app,
        requirements,
        daysLeft: daysLeft(app.deadline),
        readiness: app.review ? app.review.readiness : readiness({ ...app, requirements }),
        sections: {
            total: app.sectionList.length,
            written: app.sectionList.filter(s => s.status !== "empty").length,
            approved: app.sectionList.filter(s => s.status === "approved").length,
        },
        blockers: app.review?.findings.filter(f => f.severity === "blocker").length ?? 0,
    };
}

function seedApplications(): ApplicationDetail[] {
    return [
        application({
            id: "app-meyer",
            title: "Meyer Memorial Trust — Community Grants 2026",
            funder: "Meyer Memorial Trust",
            status: "in_progress",
            deadline: day(19),
            opportunityId: "f-meyer",
            requestUrl: "https://mmt.org/apply",
            requestText:
                "Community Grants — Education\nMeyer Memorial Trust invites Oregon 501(c)(3) organisations with budgets under $5m to apply for up to $150,000 …\n\n1. Describe the need your project addresses (300 words)\n2. Describe the project, its activities and timeline (500 words)\n3. What outcomes will you measure and how? (250 words)\n4. Explain the budget (300 words)\n5. Describe your organisation's capacity (200 words)\n\nAttach: project budget, IRS letter, audited financials. Submit as PDF via the portal.",
            requestSummary:
                "Multi-year support for Oregon organisations advancing educational equity; up to $150,000; five narrative questions with word limits; three attachments; PDF via portal.",
            amountMax: 150_000,
            requirements: MEYER_REQUIREMENTS,
            sectionList: MEYER_SECTIONS,
        }),
        application({
            id: "app-ed",
            title: "Literacy Innovation Program",
            funder: "Department of Education",
            status: "draft",
            deadline: day(41),
            opportunityId: "f-ed",
            requestUrl: "https://www.grants.gov/search-results-detail/f-ed",
        }),
        application({
            id: "app-ocf",
            title: "OCF Community Grant 2025",
            funder: "Oregon Community Foundation",
            status: "awarded",
            deadline: day(-120),
            requirements: [
                {
                    id: "eligibility:or",
                    kind: "eligibility",
                    text: "Oregon organisation",
                    done: true,
                    sectionKey: null,
                },
            ],
            sectionList: [
                section({
                    id: "s-ocf-1",
                    key: "mission",
                    question: "Describe your mission and history.",
                    status: "approved",
                    draft: "Riverbend Literacy was founded in 2014 so that every child in Portland reads at grade level by the end of third grade. We run after-school reading programmes in six elementary schools with trained volunteer tutors.",
                    cites: [1],
                    evidence: EVIDENCE,
                }),
            ],
            review: {
                readiness: 100,
                summary: "Complete and submitted.",
                findings: [],
                reviewedAt: new Date(clock() - 100 * DAY).toISOString(),
            },
            exportedDocumentId: 120,
            exportedHref: "/employer/documents?source=d120",
            updatedAt: new Date(clock() - 90 * DAY).toISOString(),
        }),
    ];
}

function seedLibrary(): LibraryItemDto[] {
    return [
        {
            id: "lib-mission",
            question: "Describe your mission and history.",
            answer: "Riverbend Literacy was founded in 2014 so that every child in Portland reads at grade level by the end of third grade. We run after-school reading programmes in six elementary schools with trained volunteer tutors, three afternoons a week.",
            tags: ["mission", "history"],
            evidence: [EVIDENCE[0]!],
            sourceApplicationId: "app-ocf",
            sourceApplicationTitle: "OCF Community Grant 2025",
            uses: 3,
            updatedAt: new Date(clock() - 90 * DAY).toISOString(),
        },
        {
            id: "lib-outcomes",
            question: "What outcomes have you achieved?",
            answer: "In 2025, 78% of participants gained at least one reading level and 91% of families reported reading together more often, measured with DIBELS at intake and exit and a family survey each spring.",
            tags: ["outcomes", "evaluation"],
            evidence: [EVIDENCE[1]!],
            sourceApplicationId: "app-ocf",
            sourceApplicationTitle: "OCF Community Grant 2025",
            uses: 1,
            updatedAt: new Date(clock() - 80 * DAY).toISOString(),
        },
        {
            id: "lib-dei",
            question: "How does your organisation approach equity?",
            answer: "Our six sites are all Title I schools; 71% of the children we serve are from households below 185% of the federal poverty line, and our tutor recruitment prioritises the neighbourhoods we serve.",
            tags: ["equity"],
            evidence: [],
            sourceApplicationId: null,
            sourceApplicationTitle: null,
            uses: 0,
            updatedAt: new Date(clock() - 30 * DAY).toISOString(),
        },
    ];
}

function seed(): World {
    return {
        profile: seedProfile(),
        funders: seedFunders(),
        applications: seedApplications(),
        library: seedLibrary(),
        runs: [],
        seq: 1,
    };
}

let world: World = seed();
export function resetProposalsSim(): void {
    world = seed();
}

// ── Helpers ───────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const err = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    json({ error, ...extra }, status);

async function readBody(init?: RequestInit): Promise<Record<string, unknown>> {
    if (!init?.body) return {};
    try {
        const parsed: unknown = JSON.parse(typeof init.body === "string" ? init.body : "{}");
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

const SOURCES: SourceOption[] = [
    {
        id: 101,
        title: "Annual report 2025",
        folder: "Reports",
        updatedAt: new Date(clock() - 20 * DAY).toISOString(),
    },
    {
        id: 102,
        title: "Meyer Trust proposal 2024",
        folder: "Proposals",
        updatedAt: new Date(clock() - 300 * DAY).toISOString(),
    },
    {
        id: 105,
        title: "ED Literacy Innovation NOFO 2026",
        folder: "Calls",
        updatedAt: new Date(clock() - 2 * DAY).toISOString(),
    },
];

function toRow(app: ApplicationDetail): ApplicationRow {
    const { requirements: _r, sectionList: _s, review: _v, ...row } = refresh(app);
    void _r;
    void _s;
    void _v;
    return row;
}

const OPEN = new Set<ApplicationStatus>(["draft", "in_progress", "in_review", "ready"]);

function counts(): CountsDto {
    return {
        profileReady: world.profile.status === "ready",
        funders: world.funders.filter(f => f.status === "saved" || f.status === "applied").length,
        applications: world.applications.filter(a => OPEN.has(a.status)).length,
        library: world.library.length,
    };
}

// ── Runs ──────────────────────────────────────────────────────────────────

const STEPS: Record<RunKind, Array<[string, string]>> = {
    funders: [
        ["plan", "Planning the search"],
        ["search", "Searching Grants.gov and the web"],
        ["score", "Scoring fit"],
        ["save", "Saving funders"],
    ],
    extract: [
        ["read", "Reading the request"],
        ["extract", "Extracting requirements"],
        ["checklist", "Building the checklist"],
    ],
    draft: [["draft", "Drafting sections"]],
    rewrite: [["rewrite", "Rewriting"]],
    review: [
        ["check", "Checking the checklist"],
        ["review", "Reviewing the drafts"],
    ],
};
const PACE: Record<RunKind, number[]> = {
    funders: [1500, 4500, 7000, 7500],
    extract: [1200, 4000, 4500],
    draft: [6000],
    rewrite: [3500],
    review: [1000, 5000],
};

function startRun(kind: RunKind, input: LiveRun["input"], labels: string[] = []): RunDto {
    const steps: RunStepDto[] =
        kind === "draft" && labels.length
            ? labels.map((label, i) => ({
                  id: `draft:${i}`,
                  label,
                  status: "waiting",
                  detail: null,
              }))
            : STEPS[kind].map(([id, label]) => ({ id, label, status: "waiting", detail: null }));
    const plan =
        kind === "draft" && labels.length ? labels.map((_, i) => 2500 * (i + 1)) : PACE[kind];
    const dto: RunDto = {
        id: `run-${world.seq++}`,
        kind,
        status: "running",
        applicationId: input.applicationId ?? null,
        startedAt: nowIso(),
        completedAt: null,
        steps,
        headline: null,
        error: null,
        credits: 0,
    };
    world.runs.unshift({ dto, startedAt: clock(), plan, applied: false, input });
    return dto;
}

function settleRuns(): void {
    for (const run of world.runs) {
        if (run.dto.status !== "running") continue;
        const elapsed = clock() - run.startedAt;
        run.dto.steps = run.dto.steps.map((step, i) => {
            const at = run.plan[i] ?? run.plan[run.plan.length - 1]!;
            const before = i === 0 ? 0 : (run.plan[i - 1] ?? 0);
            if (elapsed >= at)
                return { ...step, status: "done", detail: step.detail ?? stepDetail(run, i) };
            if (elapsed >= before) return { ...step, status: "running" };
            return step;
        });
        if (elapsed >= run.plan[run.plan.length - 1]! && !run.applied) {
            run.applied = true;
            run.dto.status = "completed";
            run.dto.completedAt = nowIso();
            run.dto.credits = {
                funders: 2000,
                extract: 1000,
                draft: 1500 * Math.max(1, run.input.sectionIds?.length ?? 1),
                rewrite: 1000,
                review: 2000,
            }[run.dto.kind];
            run.dto.headline = applyRun(run);
        }
    }
}

function stepDetail(run: LiveRun, i: number): string | null {
    switch (run.dto.kind) {
        case "funders":
            return i === 0
                ? (run.input.keywords?.join(", ") ??
                      "youth literacy, after-school, family engagement")
                : i === 1
                  ? "Grants.gov: 4 · Web: 3"
                  : i === 2
                    ? "7 scored"
                    : "3 funders";
        case "extract":
            return i === 0 ? "1,842 characters" : i === 1 ? "4 sections" : "9 items";
        case "draft":
            return "2 citations";
        case "rewrite":
            return null;
        case "review":
            return i === 0 ? "5 of 13 done" : "4 findings";
    }
}

function applyRun(run: LiveRun): string {
    const app = run.input.applicationId
        ? world.applications.find(a => a.id === run.input.applicationId)
        : null;
    switch (run.dto.kind) {
        case "funders": {
            const fresh: FunderRow[] = [
                funder({
                    id: `f-new-${world.seq++}`,
                    title: "Youth Literacy Partnerships",
                    funder: "Dollar General Literacy Foundation",
                    source: "web",
                    url: "https://www.dgliteracy.org/grant-programs/",
                    closesOn: day(33),
                    amountMax: 25_000,
                    fit: 79,
                    why: ["Funds after-school literacy for K-12", "Simple application"],
                    concerns: ["Smaller award"],
                    foundAt: nowIso(),
                }),
                funder({
                    id: `f-new-${world.seq++}`,
                    title: "Full-Service Community Schools",
                    funder: "Department of Education",
                    closesOn: day(58),
                    amountMin: 250_000,
                    amountMax: 500_000,
                    fit: 63,
                    why: ["School-based services in Title I schools"],
                    concerns: ["Requires a district as lead applicant"],
                    foundAt: nowIso(),
                }),
                funder({
                    id: `f-new-${world.seq++}`,
                    title: "Reading Is Fundamental — Community Grants",
                    funder: "Reading Is Fundamental",
                    source: "web",
                    url: "https://www.rif.org/",
                    closesOn: day(24),
                    amountMax: 15_000,
                    fit: 71,
                    why: ["Books and literacy programming for children"],
                    concerns: [],
                    foundAt: nowIso(),
                }),
            ];
            world.funders = [...fresh, ...world.funders];
            return `${fresh.length + 4} funders found, ${fresh.filter(f => (f.fit ?? 0) >= 70).length + 2} strong fits`;
        }
        case "extract": {
            if (!app) return "No application";
            const sections: SectionDto[] = [
                section({
                    id: `s-${world.seq++}`,
                    key: "project-narrative",
                    question:
                        "Project narrative: describe the intervention and the evidence behind it.",
                    guidance: "Cite research; describe fidelity measures.",
                    wordLimit: 1500,
                }),
                section({
                    id: `s-${world.seq++}`,
                    key: "need-for-project",
                    question: "Describe the need for the project in the schools you will serve.",
                    wordLimit: 750,
                }),
                section({
                    id: `s-${world.seq++}`,
                    key: "management-plan",
                    question: "Management plan and timeline.",
                    wordLimit: 500,
                }),
                section({
                    id: `s-${world.seq++}`,
                    key: "evaluation-plan",
                    question: "Evaluation plan with performance measures.",
                    wordLimit: 750,
                }),
            ];
            app.sectionList = sections;
            app.requirements = [
                {
                    id: "eligibility:501c3",
                    kind: "eligibility",
                    text: "Nonprofit with 501(c)(3) status or an LEA partner",
                    done: false,
                    sectionKey: null,
                },
                {
                    id: "eligibility:title1",
                    kind: "eligibility",
                    text: "Serve students in Title I schools",
                    done: false,
                    sectionKey: null,
                },
                {
                    id: "deadline",
                    kind: "deadline",
                    text: `Submit by ${app.deadline}`,
                    done: false,
                    sectionKey: null,
                },
                {
                    id: "budget",
                    kind: "budget",
                    text: "Request between $50,000 and $250,000",
                    done: false,
                    sectionKey: null,
                },
                ...sections.map<RequirementDto>(s => ({
                    id: `section:${s.key}`,
                    kind: "section",
                    text: `Answer: ${s.question} (${s.wordLimit} words)`,
                    done: false,
                    sectionKey: s.key,
                })),
                {
                    id: "attachment:budget",
                    kind: "attachment",
                    text: "SF-424A budget form",
                    done: false,
                    sectionKey: null,
                },
                {
                    id: "attachment:letters",
                    kind: "attachment",
                    text: "Letters of commitment from partner schools",
                    done: false,
                    sectionKey: null,
                },
                {
                    id: "format:grants-gov",
                    kind: "format",
                    text: "Submit via Grants.gov Workspace; 12pt font, 1-inch margins",
                    done: false,
                    sectionKey: null,
                },
            ];
            app.requestSummary =
                "Evidence-based reading interventions for K-5 students in Title I schools; $50k–$250k; four narrative sections; SF-424A and letters of commitment; Grants.gov Workspace.";
            app.amountMin = 50_000;
            app.amountMax = 250_000;
            app.updatedAt = nowIso();
            Object.assign(app, refresh(app));
            return `${sections.length} sections, ${app.requirements.length} checklist items`;
        }
        case "draft": {
            if (!app) return "No application";
            const targets = app.sectionList.filter(s =>
                run.input.sectionIds ? run.input.sectionIds.includes(s.id) : s.status === "empty"
            );
            for (const s of targets) {
                s.draft = draftFor(s);
                s.status = "drafted";
                s.cites = [1, 2];
                s.gaps = s.key.includes("budget") ? ["Line-item costs for the two new sites"] : [];
                s.evidence = EVIDENCE;
                s.draftedAt = nowIso();
                s.words = s.draft.trim().split(/\s+/).length;
            }
            if (app.status === "draft") app.status = "in_progress";
            app.updatedAt = nowIso();
            Object.assign(app, refresh(app));
            return `${targets.length} section${targets.length === 1 ? "" : "s"} drafted`;
        }
        case "rewrite": {
            if (!app) return "No application";
            const target = app.sectionList.find(x => x.id === run.input.sectionIds?.[0]);
            if (!target?.draft) return "Nothing to rewrite";
            const before = target.words;
            target.draft = rewriteFor(target, run.input.preset ?? "custom");
            target.words = target.draft.trim().split(/\s+/).length;
            target.status = "drafted";
            target.draftedAt = nowIso();
            app.updatedAt = nowIso();
            Object.assign(app, refresh(app));
            return `Rewritten: ${before} → ${target.words} words`;
        }
        case "review": {
            if (!app) return "No application";
            const findings: ApplicationDetail["review"] extends infer R
                ? R extends { findings: infer F }
                    ? F
                    : never
                : never = [];
            for (const s of app.sectionList) {
                if (s.required && s.status === "empty")
                    findings.push({
                        id: `missing:${s.key}`,
                        severity: "blocker",
                        kind: "missing",
                        sectionKey: s.key,
                        message: `"${s.question}" has no answer yet.`,
                        suggestion: "Draft it from your sources, or write it by hand.",
                    });
                if (s.wordLimit && s.words > s.wordLimit * 1.1)
                    findings.push({
                        id: `over:${s.key}`,
                        severity: "warning",
                        kind: "over_limit",
                        sectionKey: s.key,
                        message: `${s.words} words against a limit of ${s.wordLimit}.`,
                        suggestion: "Cut to the limit.",
                    });
            }
            for (const r of app.requirements)
                if (r.kind === "eligibility" && !r.done)
                    findings.push({
                        id: `elig:${r.id}`,
                        severity: "warning",
                        kind: "eligibility",
                        sectionKey: null,
                        message: `Eligibility not confirmed: ${r.text}`,
                        suggestion: "Tick it once you have checked it.",
                    });
            const drafted = app.sectionList.find(s => s.status === "drafted");
            if (drafted)
                findings.push({
                    id: `weak:${drafted.key}`,
                    severity: "warning",
                    kind: "weak",
                    sectionKey: drafted.key,
                    message: "The timeline names months but not the year each milestone lands in.",
                    suggestion:
                        "Add the year to each milestone and the number of children at each site.",
                });
            const rd = readiness(app);
            app.review = {
                readiness: rd,
                summary: findings.some(f => f.severity === "blocker")
                    ? "The need and approach read well; the unwritten sections would sink it as submitted."
                    : "Solid and specific; the remaining findings are polish.",
                findings,
                reviewedAt: nowIso(),
            };
            if (app.status === "draft" || app.status === "in_progress") app.status = "in_review";
            app.updatedAt = nowIso();
            Object.assign(app, refresh(app));
            return `Readiness ${rd}/100 · ${findings.length} findings${findings.filter(f => f.severity === "blocker").length ? ` · ${findings.filter(f => f.severity === "blocker").length} blockers` : ""}`;
        }
    }
}

/** A believable stand-in for each preset, so the editor's round trip can be watched. */
function rewriteFor(s: SectionDto, preset: string): string {
    const text = (s.draft ?? "").trim();
    const wordsOf = text.split(/\s+/);
    switch (preset) {
        case "tighten": {
            const limit = s.wordLimit ?? Math.max(20, Math.floor(wordsOf.length * 0.7));
            const cut = wordsOf.slice(0, limit).join(" ");
            return /[.!?]$/.test(cut) ? cut : `${cut}.`;
        }
        case "specific":
            return `${text} In 2025 that meant 420 children across six schools, with 78% gaining at least one reading level.`;
        case "plainer":
            return text.replace(/programme/g, "program").replace(/;/g, ".");
        case "stronger":
            return `Seventy-eight percent of the children we tutor gain a reading level within a year. ${text}`;
        default:
            return `${text} (Revised as asked.)`;
    }
}

function draftFor(s: SectionDto): string {
    if (s.key.includes("outcome") || s.key.includes("evaluation"))
        return "We measure reading growth with DIBELS at intake and exit for every child, and family reading habits with a spring survey. In 2025, 78% of participants gained at least one reading level and 91% of families reported reading together more often. For this project we will report the same two measures each term, with a target of 80% of children gaining a level and 85% of families reading together weekly.";
    if (s.key.includes("budget"))
        return "The request funds two site leads ($64,000), tutor training and background checks ($9,500), books and materials for 220 more children ($18,000), and evaluation ($6,000). Our FY2025 budget was $1.18m, 58% from foundations; this grant would be 8% of next year's budget and is matched by district contracts at the two new schools.";
    if (s.key.includes("capacity") || s.key.includes("management"))
        return "Riverbend has run school-based reading programmes since 2014 under Executive Director Maya Chen, who spent twelve years in K-5 education. A board of nine, including two former principals, oversees a staff of six and 140 trained volunteer tutors. Each site is led by a paid site lead; the programme director visits weekly and reviews attendance and assessment data monthly.";
    if (s.key.includes("need"))
        return "In Multnomah County, 43% of third graders read below grade level, and the gap is widest in the Title I schools where we work. Since 2014 we have served 420 children a year across six schools, three afternoons a week. Families tell us what our data shows: 91% of them read together more often once their child joins.";
    return "We will open two more school sites in September 2026 and launch a six-week summer programme in July, reaching 640 children in the grant year. Each site runs three afternoons a week with a site lead and eight trained volunteer tutors at a 1:3 ratio, following the same structured routine our six current sites use.";
}

// ── Dispatch ──────────────────────────────────────────────────────────────

export async function simulateProposals(
    u: URL,
    init: RequestInit | undefined,
    now: number
): Promise<Response | null> {
    void now;
    if (!u.pathname.startsWith("/api/proposals")) return null;
    settleRuns();
    const method = (init?.method ?? "GET").toUpperCase();
    const parts = u.pathname
        .replace(/^\/api\/proposals\/?/, "")
        .split("/")
        .filter(Boolean);
    const [head, id, third, fourth, fifth] = parts;

    if (head === "home") {
        const apps = world.applications.map(toRow);
        const open = apps.filter(a => OPEN.has(a.status));
        const candidates = world.funders.filter(f => f.status === "candidate");
        const strong = candidates.filter(f => (f.fit ?? 0) >= 70);
        const todo: HomeDto["todo"] = [];
        // The real service builds these as the old page URLs; the tab's
        // ToolLink resolves them to its own screens, and so must the harness.
        const page = (path: string) => `/employer/tools/proposals${path}`;
        if (world.profile.status !== "ready")
            todo.push({
                id: "profile",
                title: "Build your organisation profile",
                detail: "Reads your 14 sources once; every draft starts from it.",
                action: { label: "Profile", href: page("/profile") },
            });
        for (const a of open)
            if (a.daysLeft !== null && a.daysLeft <= 7 && a.readiness < 100)
                todo.push({
                    id: `deadline:${a.id}`,
                    title: `${a.title} is due in ${a.daysLeft} days`,
                    detail: `${a.readiness}% ready`,
                    action: { label: "Open", href: page(`/write/${a.id}`) },
                });
        if (strong.length)
            todo.push({
                id: "funders",
                title: `${strong.length} strong-fit funder${strong.length === 1 ? "" : "s"} to decide on`,
                detail: strong
                    .slice(0, 3)
                    .map(f => f.funder)
                    .join(", "),
                action: { label: "Funders", href: page("/funders") },
            });
        for (const a of open)
            if (a.status === "in_progress" && a.sections.total > a.sections.written)
                todo.push({
                    id: `sections:${a.id}`,
                    title: `${a.sections.total - a.sections.written} sections to write for ${a.title}`,
                    detail: a.funder ?? "",
                    action: { label: "Draft", href: page(`/write/${a.id}`) },
                });
        const body: HomeDto = {
            profile: {
                status: world.profile.status,
                builtAt: world.profile.builtAt,
                facts: world.profile.facts.length,
                documents: world.profile.builtFrom?.documents ?? 0,
            },
            todo: todo.slice(0, 6),
            deadlines: open
                .filter(a => a.deadline)
                .sort((a, b) => a.deadline!.localeCompare(b.deadline!)),
            inProgress: open.filter(a => !a.deadline || (a.daysLeft ?? 0) > 7),
            funders: {
                saved: world.funders.filter(f => f.status === "saved").length,
                candidates: candidates.length,
                strong: strong.length,
                top: [...strong, ...candidates.filter(f => (f.fit ?? 0) < 70)].slice(0, 5),
            },
            library: world.library.length,
            lastRunAt: world.runs[0]?.dto.startedAt ?? null,
        };
        return json(body);
    }
    if (head === "counts") return json(counts());
    if (head === "sources") {
        const q = (u.searchParams.get("q") ?? "").toLowerCase();
        return json({ sources: SOURCES.filter(s => !q || s.title.toLowerCase().includes(q)) });
    }
    if (head === "funders") {
        if (!id && method === "GET") {
            const status = u.searchParams.get("status");
            world.funders = world.funders.map(f => ({
                ...f,
                daysLeft: daysLeft(f.closesOn),
                applicationId: world.applications.find(a => a.opportunityId === f.id)?.id ?? null,
            }));
            return json({
                funders: world.funders.filter(f => !status || f.status === status),
                sources: { grantsGov: true, web: true },
            });
        }
        if (!id && method === "POST") {
            const body = await readBody(init);
            const f = funder({
                id: `f-manual-${world.seq++}`,
                source: "manual",
                title: str(body.title),
                funder: str(body.funder),
                url: typeof body.url === "string" ? body.url : null,
                closesOn: typeof body.closesOn === "string" ? body.closesOn : null,
                amountMax: typeof body.amountMax === "number" ? body.amountMax : null,
                status: "saved",
                eligibility: null,
                foundAt: nowIso(),
            });
            world.funders.unshift(f);
            return json({ funder: f }, 201);
        }
        if (id === "search" && method === "POST") {
            const body = await readBody(init);
            const keywords = Array.isArray(body.keywords) ? (body.keywords as string[]) : undefined;
            return json(
                { run: startRun("funders", { keywords: keywords?.length ? keywords : undefined }) },
                202
            );
        }
        const f = world.funders.find(x => x.id === id);
        if (!f) return err(404, "Funder not found");
        if (method === "PATCH") {
            const body = await readBody(init);
            f.status = body.status as FunderStatus;
            return json({ funder: f });
        }
        if (method === "DELETE") {
            world.funders = world.funders.filter(x => x.id !== id);
            return json({ ok: true });
        }
    }
    if (head === "applications") {
        if (!id && method === "GET") return json({ applications: world.applications.map(toRow) });
        if (!id && method === "POST") {
            const body = await readBody(init);
            const opp =
                typeof body.opportunityId === "string"
                    ? world.funders.find(f => f.id === body.opportunityId)
                    : null;
            const text =
                typeof body.requestText === "string"
                    ? body.requestText
                    : typeof body.requestDocumentId === "number"
                      ? "Request text read from the source."
                      : opp?.summary
                        ? `${opp.title}\n${opp.funder}\n\n${opp.summary}`
                        : null;
            const app = application({
                id: `app-${world.seq++}`,
                title: str(body.title).trim() || (opp?.title ?? "Untitled application"),
                funder: (str(body.funder) || null) ?? opp?.funder ?? null,
                deadline: (str(body.deadline) || null) ?? opp?.closesOn ?? null,
                opportunityId: opp?.id ?? null,
                requestText: text,
                requestUrl: (str(body.requestUrl) || null) ?? opp?.url ?? null,
                requestDocumentId:
                    typeof body.requestDocumentId === "number" ? body.requestDocumentId : null,
                updatedAt: nowIso(),
            });
            world.applications.unshift(app);
            if (opp) opp.status = "applied";
            const run =
                app.requestText || app.requestUrl
                    ? startRun("extract", { applicationId: app.id })
                    : null;
            return json({ application: refresh(app), run }, 201);
        }
        const app = world.applications.find(a => a.id === id);
        if (!app) return err(404, "Application not found");
        if (!third) {
            if (method === "GET") return json({ application: refresh(app) });
            if (method === "PATCH") {
                const body = await readBody(init);
                if (typeof body.title === "string") app.title = body.title;
                if ("funder" in body) app.funder = (body.funder as string | null) ?? null;
                if (typeof body.status === "string") app.status = body.status as ApplicationStatus;
                if ("deadline" in body) app.deadline = (body.deadline as string | null) ?? null;
                if ("requestText" in body)
                    app.requestText = (body.requestText as string | null) ?? null;
                if ("requestUrl" in body)
                    app.requestUrl = (body.requestUrl as string | null) ?? null;
                const req = body.requirement as { id: string; done: boolean } | undefined;
                if (req)
                    app.requirements = app.requirements.map(r =>
                        r.id === req.id && r.kind !== "section" ? { ...r, done: req.done } : r
                    );
                app.updatedAt = nowIso();
                Object.assign(app, refresh(app));
                return json({ application: app });
            }
            if (method === "DELETE") {
                world.applications = world.applications.filter(a => a.id !== id);
                return json({ ok: true });
            }
        }
        if (third === "extract" && method === "POST") {
            if (!app.requestText && !app.requestUrl)
                return err(409, "Paste the funder's request or give its URL first", {
                    code: "request_required",
                });
            return json({ run: startRun("extract", { applicationId: app.id }) }, 202);
        }
        if (third === "draft" && method === "POST") {
            const body = await readBody(init);
            const ids = Array.isArray(body.sectionIds) ? (body.sectionIds as string[]) : undefined;
            const targets = app.sectionList.filter(s =>
                ids ? ids.includes(s.id) : s.status === "empty"
            );
            if (targets.length === 0)
                return err(409, "Every section already has a draft", { code: "nothing_to_draft" });
            return json(
                {
                    run: startRun(
                        "draft",
                        { applicationId: app.id, sectionIds: targets.map(t => t.id) },
                        targets.map(t => t.question.slice(0, 80))
                    ),
                },
                202
            );
        }
        if (third === "markdown" && method === "GET") {
            const lines = [`# ${app.title}`, ""];
            lines.push(
                [
                    app.funder ? `**Funder:** ${app.funder}` : null,
                    app.deadline ? `**Deadline:** ${app.deadline}` : null,
                    `**Readiness:** ${app.readiness}/100`,
                ]
                    .filter(Boolean)
                    .join(" · "),
                ""
            );
            for (const sec of app.sectionList) {
                lines.push(`## ${sec.question}`, "");
                lines.push(sec.draft?.trim() ? sec.draft.trim() : "_Not written yet._", "");
            }
            const checklist = app.requirements.filter(r => r.kind !== "section");
            if (checklist.length) {
                lines.push("## Checklist", "");
                for (const r of checklist) lines.push(`- [${r.done ? "x" : " "}] ${r.text}`);
            }
            return json({
                markdown: lines.join("\n"),
                filename: `${app.title.replace(/[^a-zA-Z0-9]+/g, "-")}.md`,
            });
        }
        if (third === "review" && method === "POST")
            return json({ run: startRun("review", { applicationId: app.id }) }, 202);
        if (third === "export" && method === "POST") {
            if (app.sectionList.every(s => !s.draft))
                return err(409, "Nothing has been written yet", { code: "nothing_written" });
            app.exportedDocumentId = 200 + world.seq++;
            app.exportedHref = `/employer/documents?source=d${app.exportedDocumentId}`;
            return json({ application: refresh(app) });
        }
        if (third === "sections") {
            if (!fourth && method === "POST") {
                const body = await readBody(init);
                const question = str(body.question).trim();
                const key =
                    question
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, "")
                        .slice(0, 48) || "section";
                const s = section({
                    id: `s-${world.seq++}`,
                    key,
                    question,
                    wordLimit: typeof body.wordLimit === "number" ? body.wordLimit : null,
                });
                app.sectionList.push(s);
                app.requirements.push({
                    id: `section:${key}`,
                    kind: "section",
                    text: `Answer: ${question}`,
                    done: false,
                    sectionKey: key,
                });
                Object.assign(app, refresh(app));
                return json({ section: s }, 201);
            }
            const s = app.sectionList.find(x => x.id === fourth);
            if (!s) return err(404, "Section not found");
            if (fifth === "rewrite" && method === "POST") {
                if (!s.draft?.trim())
                    return err(409, "Write or draft the answer first, then rewrite it", {
                        code: "nothing_to_rewrite",
                    });
                const body = await readBody(init);
                return json(
                    {
                        run: startRun(
                            "rewrite",
                            {
                                applicationId: app.id,
                                sectionIds: [s.id],
                                preset: str(body.preset) || "custom",
                                instruction: str(body.instruction) || undefined,
                            },
                            [s.question.slice(0, 60)]
                        ),
                    },
                    202
                );
            }
            if (fifth === "library" && method === "POST") {
                if (!s.draft?.trim()) return err(409, "Write the answer before saving it");
                const item: LibraryItemDto = {
                    id: `lib-${world.seq++}`,
                    question: s.question,
                    answer: s.draft.trim(),
                    tags: [],
                    evidence: s.evidence.filter(e => s.cites.includes(e.n)),
                    sourceApplicationId: app.id,
                    sourceApplicationTitle: app.title,
                    uses: 0,
                    updatedAt: nowIso(),
                };
                world.library.unshift(item);
                return json({ item }, 201);
            }
            if (method === "PATCH") {
                const body = await readBody(init);
                if ("draft" in body) {
                    s.draft = (body.draft as string | null) ?? null;
                    s.words = s.draft ? s.draft.trim().split(/\s+/).length : 0;
                    if (!s.draft?.trim()) {
                        s.status = "empty";
                        s.cites = [];
                        s.gaps = [];
                        s.evidence = [];
                    } else if (s.status !== "approved" && !body.status) s.status = "edited";
                }
                if (typeof body.status === "string") {
                    if (body.status === "approved" && !s.draft?.trim())
                        return err(409, "Write the answer before approving it");
                    s.status = body.status as SectionDto["status"];
                }
                if (typeof body.question === "string") s.question = body.question;
                if ("wordLimit" in body) s.wordLimit = (body.wordLimit as number | null) ?? null;
                if (app.status === "draft" && s.status !== "empty") app.status = "in_progress";
                app.updatedAt = nowIso();
                Object.assign(app, refresh(app));
                return json({ section: s });
            }
            if (method === "DELETE") {
                app.sectionList = app.sectionList.filter(x => x.id !== fourth);
                app.requirements = app.requirements.filter(r => r.sectionKey !== s.key);
                Object.assign(app, refresh(app));
                return json({ ok: true });
            }
        }
    }
    if (head === "library") {
        if (!id && method === "GET") return json({ items: world.library });
        if (!id && method === "POST") {
            const body = await readBody(init);
            const item: LibraryItemDto = {
                id: `lib-${world.seq++}`,
                question: str(body.question),
                answer: str(body.answer),
                tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
                evidence: [],
                sourceApplicationId: null,
                sourceApplicationTitle: null,
                uses: 0,
                updatedAt: nowIso(),
            };
            world.library.unshift(item);
            return json({ item }, 201);
        }
        const item = world.library.find(x => x.id === id);
        if (!item) return err(404, "Library item not found");
        if (method === "PATCH") {
            const body = await readBody(init);
            if (typeof body.question === "string") item.question = body.question;
            if (typeof body.answer === "string") item.answer = body.answer;
            if (Array.isArray(body.tags)) item.tags = body.tags as string[];
            item.updatedAt = nowIso();
            return json({ item });
        }
        if (method === "DELETE") {
            world.library = world.library.filter(x => x.id !== id);
            return json({ ok: true });
        }
    }
    if (head === "runs") {
        if (!id) {
            const applicationId = u.searchParams.get("applicationId");
            return json({
                runs: world.runs
                    .map(r => r.dto)
                    .filter(r => !applicationId || r.applicationId === applicationId),
            });
        }
        const run = world.runs.find(r => r.dto.id === id);
        return run ? json({ run: run.dto }) : err(404, "Run not found");
    }
    return err(404, "Not found");
}
