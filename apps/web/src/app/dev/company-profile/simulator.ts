/**
 * An in-memory stand-in for `/api/company/profile*`, for the dev harness and
 * the Proposals harness. Each fixture is one state the page has to draw;
 * mutations change the fixture so a click visibly does something, and a
 * rebuild walks through "building" — sources read one by one — before it
 * lands, so the page's polling is exercised too.
 */
import type {
    CompanyProfileDto,
    ProfileEntryDto,
    ProfileEvidenceDto,
    ProfileFactDto,
    ProfileSourceDto,
    SourceOverride,
} from "~/lib/company-profile/dto";

export const PROFILE_FIXTURES = [
    "ready",
    "nothing",
    "building",
    "failed",
    "stale",
    "viewer",
    "empty",
] as const;
export type ProfileFixture = (typeof PROFILE_FIXTURES)[number];

export function isProfileFixture(value: string | null | undefined): value is ProfileFixture {
    return (PROFILE_FIXTURES as readonly string[]).includes(value ?? "");
}

const HOUR = 3_600_000;
const BUILD_MS = 7000;

const iso = (msAgo: number, now: number) => new Date(now - msAgo).toISOString();
const href = (documentId: number) => `/employer/documents?source=d${documentId}`;

function source(
    documentId: number,
    title: string,
    folder: string,
    role: ProfileSourceDto["role"],
    reason: string | null,
    extra: Partial<ProfileSourceDto> = {}
): ProfileSourceDto {
    const override = extra.override ?? null;
    return {
        documentId,
        title,
        folder,
        role,
        roleBy: role === "no_content" ? "rules" : role ? "model" : null,
        reason,
        override,
        counted: override ? override === "about_us" : role === "about_us",
        facts: 0,
        status: "done",
        error: null,
        href: href(documentId),
        ...extra,
    };
}

function counts(sources: ProfileSourceDto[]): CompanyProfileDto["counts"] {
    const pending = sources.filter(s => !s.counted && s.status === "pending").length;
    const counted = sources.filter(s => s.counted).length;
    return {
        sources: sources.length,
        counted,
        setAside: sources.length - counted - pending,
        pending,
    };
}

const EMPTY_CONTENT = {
    summary: null,
    summaryCites: [],
    applicantType: null,
    focusAreas: [],
    geography: [],
    markets: [],
    facts: [],
    people: [],
    services: [],
    projects: [],
    legal: [],
    evidence: [],
} satisfies Partial<CompanyProfileDto>;

/** A LaunchStack-like profile: everything the page can show, once. */
function readyProfile(now: number): CompanyProfileDto {
    const evidence: ProfileEvidenceDto[] = [
        {
            n: 1,
            documentId: 41,
            title: "LaunchStack pitch deck 2026.pdf",
            page: 2,
            quote: "We give small teams the research and writing staff they cannot hire, grounded in their own documents.",
            href: href(41),
        },
        {
            n: 2,
            documentId: 42,
            title: "Product overview.md",
            page: null,
            quote: "Studio puts chat, sources and tools side by side, and every answer cites the passage it came from.",
            href: href(42),
        },
        {
            n: 3,
            documentId: 43,
            title: "Certificate of incorporation.pdf",
            page: 1,
            quote: "LaunchStack, Inc., incorporated in 2024; principal office Baltimore, Maryland. Chief Executive Officer: Maya Chen.",
            href: href(43),
        },
        {
            n: 4,
            documentId: 44,
            title: "Team handbook.docx",
            page: 3,
            quote: "We are six people. Four of us write code, led by Jonas Reyes.",
            href: href(44),
        },
        {
            n: 5,
            documentId: 45,
            title: "Investor update, August 2026.pdf",
            page: 1,
            quote: "42 paying workspaces, most of them nonprofits and seed-stage startups.",
            // A source this viewer cannot open: the title is not a link.
            href: null,
        },
    ];
    const facts: ProfileFactDto[] = [
        {
            path: "company.headquarters",
            label: "Headquarters",
            value: "Baltimore, Maryland",
            cites: [3],
            source: "documents",
        },
        {
            path: "company.founded_year",
            label: "Founded",
            value: "2024",
            cites: [3],
            source: "documents",
        },
        {
            path: "profile.facts.mission",
            label: "Mission",
            value: "Give small teams the research and writing staff they cannot hire, grounded in their own documents.",
            cites: [1],
            source: "documents",
        },
        {
            path: "company.size",
            label: "Team",
            value: "Six people, four of them engineers",
            cites: [4],
            source: "documents",
        },
        {
            path: "profile.facts.customers",
            label: "Customers",
            value: "42 paying workspaces as of August 2026, mostly nonprofits and seed-stage startups",
            cites: [5],
            source: "documents",
        },
        {
            path: "profile.facts.annual_budget",
            label: "Annual budget",
            value: "$480k in FY2026",
            cites: [],
            source: "manual",
        },
    ];
    const people: ProfileEntryDto[] = [
        {
            path: "people.0",
            name: "Maya Chen",
            detail: "Founder and chief executive",
            detailPath: "people.0.role",
            cites: [3],
            source: "documents",
        },
        {
            path: "people.1",
            name: "Jonas Reyes",
            detail: "Leads engineering",
            detailPath: "people.1.role",
            cites: [4],
            source: "documents",
        },
    ];
    const services: ProfileEntryDto[] = [
        {
            path: "services.0",
            name: "Studio",
            detail: "Chat, sources and tools side by side; every answer cites the passage it came from.",
            detailPath: "services.0.description",
            cites: [2],
            source: "documents",
        },
        {
            path: "services.1",
            name: "Proposals",
            detail: "Finds funders that fit and drafts applications from what the sources prove.",
            detailPath: "services.1.description",
            cites: [2],
            source: "documents",
        },
        {
            path: "services.2",
            name: "Templated drafts",
            detail: null,
            detailPath: "services.2.description",
            cites: [],
            source: "documents",
        },
    ];
    const sources: ProfileSourceDto[] = [
        source(
            41,
            "LaunchStack pitch deck 2026.pdf",
            "Pitch",
            "about_us",
            "LaunchStack's own pitch deck.",
            { facts: 2 }
        ),
        source(
            42,
            "Product overview.md",
            "Product",
            "about_us",
            "Describes LaunchStack's product.",
            { facts: 3 }
        ),
        source(
            43,
            "Certificate of incorporation.pdf",
            "Legal",
            "about_us",
            "LaunchStack's incorporation filing.",
            { facts: 3 }
        ),
        source(44, "Team handbook.docx", "Team", "about_us", "LaunchStack's internal handbook.", {
            facts: 2,
        }),
        source(
            45,
            "Investor update, August 2026.pdf",
            "Investors",
            "third_party",
            "Reads like a newsletter from an investor about their portfolio.",
            { override: "about_us", facts: 1 }
        ),
        source(
            46,
            "2312.06648v3.pdf",
            "Research",
            "third_party",
            "A research paper by authors at the University of Washington, Tencent AI Lab, UPenn and CMU — not about LaunchStack."
        ),
        source(47, "Roadmap brainstorm", "Mindmaps", "no_content", "An empty test mindmap."),
    ];
    return {
        status: "ready",
        error: null,
        builtAt: iso(3 * HOUR, now),
        stale: false,
        name: "LaunchStack",
        summary:
            "LaunchStack is a document workspace for small teams: it reads a company's own files — proposals, reports, decks — and answers, drafts and cites from them.",
        summaryCites: [1, 2],
        applicantType: "for_profit",
        focusAreas: ["Document AI", "Grant writing"],
        geography: ["United States"],
        markets: ["Nonprofits", "Seed-stage startups"],
        facts,
        people,
        services,
        projects: [],
        legal: [
            {
                path: "legal.0",
                name: "Hosting agreement with Northwind Cloud",
                detail: "Two-year hosting agreement, renews each January.",
                detailPath: "legal.0.summary",
                cites: [],
                source: "documents",
            },
        ],
        evidence,
        sources,
        counts: counts(sources),
        canEdit: true,
    };
}

/** LaunchStack Dev as it is today: a research paper, test mindmaps and an empty PDF. */
function nothingProfile(now: number): CompanyProfileDto {
    const paper =
        "A research paper by authors at the University of Washington, Tencent AI Lab, UPenn and CMU — not about LaunchStack Dev.";
    const sources: ProfileSourceDto[] = [
        source(12, "2312.06648v3.pdf", "Research", "third_party", paper),
        source(13, "Untitled mindmap", "Mindmaps", "no_content", "An empty test mindmap."),
        source(14, "Test mindmap", "Mindmaps", "no_content", "An empty test mindmap."),
        source(15, "Mindmap test 2", "Mindmaps", "no_content", "An empty test mindmap."),
        source(16, "Scan 2026-09-30.pdf", "Uploads", "no_content", "A PDF with no text in it."),
    ];
    return {
        status: "ready",
        error: null,
        builtAt: iso(2 * HOUR, now),
        stale: false,
        name: "LaunchStack Dev",
        ...EMPTY_CONTENT,
        sources,
        counts: counts(sources),
        canEdit: true,
    };
}

function fixture(state: ProfileFixture, now: number): CompanyProfileDto {
    switch (state) {
        case "ready":
            return readyProfile(now);
        case "nothing":
            return nothingProfile(now);
        case "stale":
            return { ...readyProfile(now), stale: true, builtAt: iso(9 * 24 * HOUR, now) };
        case "viewer":
            return { ...readyProfile(now), canEdit: false };
        case "failed": {
            const sources = readyProfile(now).sources.map(s =>
                s.documentId === 44
                    ? {
                          ...s,
                          status: "failed" as const,
                          role: null,
                          roleBy: null,
                          counted: false,
                          reason: null,
                          error: "The file is password-protected.",
                      }
                    : { ...s, facts: 0 }
            );
            return {
                ...readyProfile(now),
                ...EMPTY_CONTENT,
                status: "failed",
                error: "Building the profile stopped: the model provider did not answer. Nothing you had was lost.",
                builtAt: null,
                sources,
                counts: counts(sources),
            };
        }
        case "empty":
            return {
                ...readyProfile(now),
                ...EMPTY_CONTENT,
                status: "empty",
                builtAt: null,
                sources: [],
                counts: counts([]),
            };
        case "building":
            // A first build: nothing to show until it lands.
            return { ...readyProfile(now), builtAt: null };
    }
}

interface World {
    state: ProfileFixture;
    profile: CompanyProfileDto;
    /** While set, GET answers a building view of `profile` until `until`. */
    build: { startedAt: number; until: number } | null;
}

let world: World | null = null;

function startBuild(w: World, now: number) {
    w.build = { startedAt: now, until: now + BUILD_MS };
}

export function resetCompanyProfileSim(state: ProfileFixture, now = Date.now()): void {
    world = { state, profile: fixture(state, now), build: null };
    if (state === "building") startBuild(world, now);
}

function current(state: ProfileFixture, now: number): World {
    if (!world || world.state !== state) resetCompanyProfileSim(state, now);
    const w = world!;
    if (w.build && now >= w.build.until) {
        w.build = null;
        w.profile = {
            ...w.profile,
            status: "ready",
            error: null,
            stale: false,
            builtAt: new Date(now).toISOString(),
        };
    }
    return w;
}

/** What a GET answers while a build is running: sources read one by one, facts not yet in. */
function view(w: World, now: number): CompanyProfileDto {
    if (!w.build) return w.profile;
    const { startedAt, until } = w.build;
    const n = w.profile.sources.length;
    const done = Math.floor(((now - startedAt) / (until - startedAt)) * n);
    const sources = w.profile.sources.map((s, i) =>
        i < done
            ? s
            : {
                  ...s,
                  status: "pending" as const,
                  role: null,
                  roleBy: null,
                  reason: null,
                  counted: s.override === "about_us",
                  facts: 0,
              }
    );
    const previous = w.profile.builtAt;
    return {
        ...w.profile,
        // A first build has nothing to show yet; a rebuild keeps showing the last one.
        ...(previous ? {} : EMPTY_CONTENT),
        status: "building",
        error: null,
        sources,
        counts: counts(sources),
    };
}

/** Keep only the excerpts something still cites, as the server does. */
function pruneEvidence(p: CompanyProfileDto): CompanyProfileDto {
    const cited = new Set<number>([
        ...p.summaryCites,
        ...p.facts.flatMap(f => f.cites),
        ...[...p.people, ...p.services, ...p.projects, ...p.legal].flatMap(e => e.cites),
    ]);
    return { ...p, evidence: p.evidence.filter(e => cited.has(e.n)) };
}

function patchFact(
    p: CompanyProfileDto,
    path: string,
    value: string,
    label?: string
): CompanyProfileDto | string {
    const text = value.trim();
    const fact = p.facts.find(f => f.path === path);
    if (fact) {
        const facts = text
            ? p.facts.map(f =>
                  f.path === path ? { ...f, value: text, cites: [], source: "manual" as const } : f
              )
            : p.facts.filter(f => f.path !== path);
        return pruneEvidence({ ...p, facts });
    }
    for (const kind of ["people", "services", "projects", "legal"] as const) {
        // Clearing an entry's name takes it off the profile, as the server does.
        if (!text && p[kind].some(e => `${e.path}.name` === path))
            return pruneEvidence({ ...p, [kind]: p[kind].filter(e => `${e.path}.name` !== path) });
        if (p[kind].some(e => e.detailPath === path)) {
            const entries = p[kind].map(e =>
                e.detailPath === path
                    ? { ...e, detail: text || null, cites: [], source: "manual" as const }
                    : e
            );
            return pruneEvidence({ ...p, [kind]: entries });
        }
    }
    if (!path.startsWith("profile.facts.")) return `Unknown fact: ${path}`;
    if (!text) return p;
    if (!label?.trim()) return "A new fact needs a label";
    return {
        ...p,
        facts: [
            ...p.facts,
            { path, label: label.trim(), value: text, cites: [], source: "manual" },
        ],
    };
}

function setOverride(
    p: CompanyProfileDto,
    documentId: number,
    override: SourceOverride | null
): CompanyProfileDto | string {
    if (!p.sources.some(s => s.documentId === documentId)) return "No such source";
    const sources = p.sources.map(s =>
        s.documentId === documentId
            ? {
                  ...s,
                  override,
                  counted: override ? override === "about_us" : s.role === "about_us",
              }
            : s
    );
    // The facts were built from the old decision: a rebuild would differ.
    return { ...p, sources, counts: counts(sources), stale: p.status === "ready" ? true : p.stale };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

const LATENCY_MS = 350;

/**
 * Answers a `/api/company/profile*` request, or returns null for anything
 * else so the caller can pass it on.
 */
export async function simulateCompanyProfile(
    url: URL,
    init: RequestInit | undefined,
    state: ProfileFixture,
    now = Date.now()
): Promise<Response | null> {
    if (!url.pathname.startsWith("/api/company/profile")) return null;
    await new Promise(resolve => setTimeout(resolve, LATENCY_MS));
    const w = current(state, now);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = (() => {
        try {
            return typeof init?.body === "string"
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : {};
        } catch {
            return {};
        }
    })();
    const forbidden = () => json({ error: "Only an admin can change the company profile." }, 403);

    if (url.pathname === "/api/company/profile") {
        if (method === "GET") return json({ profile: view(w, now) });
        if (method === "POST") {
            if (w.profile.sources.length === 0)
                return json({ error: "There are no sources to read yet." }, 409);
            if (!w.build) startBuild(w, now);
            if (w.state === "failed") {
                // What a successful retry finds.
                w.profile = { ...readyProfile(now), builtAt: null, canEdit: w.profile.canEdit };
            }
            return json({ profile: view(w, now) }, 202);
        }
    }

    if (url.pathname === "/api/company/profile/facts" && method === "PATCH") {
        if (!w.profile.canEdit) return forbidden();
        const next = patchFact(
            w.profile,
            typeof body.path === "string" ? body.path : "",
            typeof body.value === "string" ? body.value : "",
            typeof body.label === "string" ? body.label : undefined
        );
        if (typeof next === "string") return json({ error: next }, 400);
        w.profile = next;
        return json({ profile: view(w, now) });
    }

    const match = /^\/api\/company\/profile\/sources\/(\d+)$/.exec(url.pathname);
    if (match && method === "PATCH") {
        if (!w.profile.canEdit) return forbidden();
        const override = body.override;
        if (override !== null && override !== "about_us" && override !== "set_aside") {
            return json({ error: "override must be about_us, set_aside or null" }, 400);
        }
        const next = setOverride(w.profile, Number(match[1]), override);
        if (typeof next === "string") return json({ error: next }, 404);
        w.profile = next;
        return json({ profile: view(w, now) });
    }

    return json({ error: "Not found" }, 404);
}
