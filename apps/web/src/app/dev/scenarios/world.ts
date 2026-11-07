/**
 * What the Scenarios harness shows: whole runs written out to the last round
 * ("scripts"), which `scenarios-sim.ts` then slices by time so a run in
 * progress grows round by round.
 *
 * One run is written by hand — a price rise for a bookkeeping product, twelve
 * people, eight rounds, an event added halfway — so the report, the feed and
 * the people read like the real thing. Everything else (a run in progress, a
 * run you start, a post test) comes from `generateScript`, which makes a
 * plausible network for any subject from a seed. All shapes are the wire
 * contract's (`~/lib/scenarios/types`).
 */
import { toolTabHref } from "~/lib/tool-app/locations";
import type {
    ScenarioComment,
    ScenarioFileOption,
    ScenarioKind,
    ScenarioPerson,
    ScenarioPost,
    ScenarioReception,
    ScenarioReport,
    ScenarioRoundStats,
    ScenarioSource,
    ScenarioSourceOptions,
    ScenarioSources,
    Stance,
} from "~/lib/scenarios/types";

/** A run as it stands after its last round. */
export interface Script {
    brief: string;
    sources: ScenarioSource[];
    people: ScenarioPerson[];
    /** Every post, oldest first; the opening post is round 0. */
    posts: ScenarioPost[];
    rounds: ScenarioRoundStats[];
    report: ScenarioReport;
    reception: ScenarioReception | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** A small seeded PRNG (mulberry32), so a run looks the same on every poll. */
export function rng(seed: number): () => number {
    let a = seed >>> 0 || 1;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function hashText(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const clampStance = (n: number): Stance => Math.max(-2, Math.min(2, Math.round(n))) as Stance;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function pick<T>(rand: () => number, items: readonly T[]): T {
    return items[Math.floor(rand() * items.length)]!;
}

/** Stats for each round, from who stood where and what was posted. */
export function roundStats(people: ScenarioPerson[], posts: ScenarioPost[], rounds: number) {
    const stats: ScenarioRoundStats[] = [];
    for (let r = 1; r <= rounds; r++) {
        const inRound = posts.filter(p => p.round === r);
        const comments = posts.flatMap(p => p.comments).filter(c => c.round === r);
        const active = new Set([
            ...inRound.filter(p => p.authorKind === "agent").map(p => p.authorId),
            ...comments.map(c => c.authorId),
        ]);
        const stances = people.map(p => p.stanceHistory[r] ?? p.stance);
        const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
        for (const s of stances) counts[s + 2] = (counts[s + 2] ?? 0) + 1;
        stats.push({
            round: r,
            active: active.size,
            posts: inRound.length,
            comments: comments.length,
            likes: inRound.reduce((n, p) => n + p.likes, 0),
            dislikes: inRound.reduce((n, p) => n + p.dislikes, 0),
            shares: inRound.reduce((n, p) => n + p.shares, 0),
            follows: Math.round(active.size * 0.6 + (r % 3)),
            meanStance: Math.round(mean(stances) * 100) / 100,
            stanceCounts: counts,
        });
    }
    return stats;
}

/** Posts and comments per person, from the posts so far. */
export function countActivity(people: ScenarioPerson[], posts: ScenarioPost[]): ScenarioPerson[] {
    return people.map(person => ({
        ...person,
        posts: posts.filter(p => p.authorId === person.id).length,
        comments: posts.flatMap(p => p.comments).filter(c => c.authorId === person.id).length,
    }));
}

function factionsOf(people: ScenarioPerson[]): ScenarioReport["factions"] {
    const total = people.length || 1;
    const group = (test: (s: Stance) => boolean) => people.filter(p => test(p.stance));
    const supportive = group(s => s > 0);
    const neutral = group(s => s === 0);
    const critical = group(s => s < 0);
    return [
        {
            stance: "supportive" as const,
            label: "Came round to it",
            text: "Thought it was reasonable, or decided the benefit outweighed the cost once the details were clear.",
            share: supportive.length / total,
            agentIds: supportive.map(p => p.id),
        },
        {
            stance: "neutral" as const,
            label: "Waiting to see",
            text: "Not affected yet, or wanted numbers before taking a side.",
            share: neutral.length / total,
            agentIds: neutral.map(p => p.id),
        },
        {
            stance: "critical" as const,
            label: "Against it",
            text: "Felt it was decided without them, or found a cheaper or simpler alternative.",
            share: critical.length / total,
            agentIds: critical.map(p => p.id),
        },
    ].filter(f => f.agentIds.length > 0);
}

// ── The sources the form can offer ────────────────────────────────────────

const DAY_MS = 86_400_000;

/** A file the form offers, added `days` ago; ready and not the company's unless said. */
function file(
    id: number,
    title: string,
    folder: string | null,
    days: number,
    more: Partial<ScenarioFileOption> = {}
): ScenarioFileOption {
    return {
        id,
        title,
        folder,
        mimeType: null,
        addedAt: new Date(Date.now() - days * DAY_MS).toISOString(),
        status: "ready",
        aboutCompany: false,
        ...more,
    };
}

export const SOURCE_OPTIONS: ScenarioSourceOptions = {
    documents: [
        file(340, "Q4 plan — draft.docx", "Company", 0.02, {
            status: "processing",
            aboutCompany: false,
        }),
        file(336, "Pricing & plans 2026.pdf", "Company", 1, { aboutCompany: true }),
        file(334, "Pitch deck — seed extension.pptx", "Company", 3, { aboutCompany: true }),
        file(330, "Brand voice guide.md", "Marketing", 4),
        file(322, "Website analytics summary.pdf", null, 6),
        file(318, "Customer advisory board minutes.docx", "Research", 8),
        file(312, "Press kit.pdf", "Marketing", 9, { aboutCompany: true }),
        file(305, "Sales call notes — accounting firms.docx", "Sales", 11),
        file(301, "Roadmap spring 2027.md", "Product", 12, { aboutCompany: true }),
        file(299, "Scanned lease agreement.pdf", "Legal", 13, { status: "failed" }),
        file(290, "Partner programme terms.pdf", "Partners", 15),
        file(288, "Competitor teardown — Tallybook.md", "Marketing", 18),
        file(271, "Onboarding survey results.xlsx", "Research", 21),
        file(263, "Support tickets export (Sept).csv", "Support", 25),
        file(251, "Board update — October.pdf", "Company", 27, { aboutCompany: true }),
        file(240, "Pricing page copy v4.md", "Marketing", 30),
        file(212, "Customer interviews — September.pdf", "Research", 34),
        file(198, "Churn notes Q3.docx", "Research", 40),
    ],
    prospects: 42,
    brandComments: 18,
    companyProfile: true,
    canUpload: true,
};

/** The evidence rows a new run is built from, as the server would list them. */
export function sourcesFor(
    input: ScenarioSources,
    documents: readonly ScenarioFileOption[] = SOURCE_OPTIONS.documents
): ScenarioSource[] {
    const out: ScenarioSource[] = [];
    const next = () => `E${out.length + 1}`;
    for (const id of input.documentIds) {
        const doc = documents.find(d => d.id === id);
        if (!doc) continue;
        out.push({
            id: next(),
            kind: "document",
            label: doc.title,
            excerpt: "Passages about the situation were taken from this file.",
            href: `/employer/documents?source=${doc.id}`,
            redacted: false,
        });
    }
    if (input.searchFiles) {
        out.push({
            id: next(),
            kind: "search",
            label: "Churn notes Q3.docx",
            excerpt:
                "Most cancellations came in the first 60 days; price was named in 4 of 31 exit surveys.",
            href: "/employer/documents?source=198",
            redacted: false,
        });
        out.push({
            id: next(),
            kind: "search",
            label: "Customer advisory board minutes.docx",
            excerpt:
                "Members asked for fewer surprises in billing and a longer notice period for changes.",
            href: "/employer/documents?source=318",
            redacted: false,
        });
    }
    if (input.prospects) {
        out.push({
            id: next(),
            kind: "prospect",
            label: "Northwind Advisory",
            excerpt: "Fractional CFO firm, 14 people, Lisbon. Keeps the books for 60+ startups.",
            href: toolTabHref("growth", "/prospects/companies/12"),
            redacted: false,
        });
        out.push({
            id: next(),
            kind: "prospect",
            label: "Harbor Co-op Grocers",
            excerpt:
                "Member-owned grocery co-op with three stores. Asked about multi-entity invoicing.",
            href: toolTabHref("growth", "/prospects/companies/19"),
            redacted: false,
        });
    }
    if (input.brandComments) {
        out.push({
            id: next(),
            kind: "brand_comment",
            label: "Comment on “Bank feeds are back”",
            excerpt:
                "Love the bank feeds. Please don't turn this into another tool that charges per invoice.",
            href: toolTabHref("growth", "/brand/engagement"),
            redacted: false,
        });
    }
    if (input.companyProfile) {
        out.push({
            id: next(),
            kind: "company_profile",
            label: "Company profile: pricing and customers",
            excerpt:
                "Starter $29/month, Growth $79/month. 2,140 paying workspaces, 71% on Starter.",
            href: null,
            redacted: false,
        });
    }
    if (input.notes.trim()) {
        const text = input.notes.trim().replace(/\s+/g, " ");
        out.push({
            id: next(),
            kind: "notes",
            label: "Pasted material",
            excerpt: text.length > 220 ? `${text.slice(0, 218)}…` : text,
            href: null,
            redacted: false,
        });
    }
    return out;
}

// ── The hand-written run ──────────────────────────────────────────────────

export const PRICE_RUN_SUBJECT =
    "We raise the Starter plan from $29 to $35 a month for new customers from January 1. Existing customers keep $29 for 12 months.";

export const PRICE_RUN_EVENT =
    "Ledgerline confirms: Starter keeps unlimited invoices at $35, and anyone who signs up before January 1 keeps $29 for 12 months.";

export const PRICE_RUN_SOURCES_USED: ScenarioSources = {
    documentIds: [212, 251],
    searchFiles: true,
    prospects: true,
    brandComments: true,
    companyProfile: true,
    notes: "Competitor note: Tallybook announced a $25 starter tier last week, capped at 20 invoices a month.",
};

const PRICE_SOURCES: ScenarioSource[] = [
    {
        id: "E1",
        kind: "document",
        label: "Customer interviews — September.pdf",
        excerpt:
            "Three of the five café owners compare us with spreadsheets, not other software. One said: “If it goes over $30 I'll have to think about it.”",
        href: "/employer/documents?source=212",
        redacted: false,
    },
    {
        // A file the creator picked that this viewer cannot open.
        id: "E2",
        kind: "document",
        label: "",
        excerpt: null,
        href: null,
        redacted: true,
    },
    {
        id: "E3",
        kind: "search",
        label: "Churn notes Q3.docx",
        excerpt:
            "Most cancellations in Q3 came in the first 60 days; price was mentioned in 4 of 31 exit surveys. Onboarding was mentioned in 17.",
        href: "/employer/documents?source=198",
        redacted: false,
    },
    {
        id: "E4",
        kind: "prospect",
        label: "Northwind Advisory",
        excerpt: "Fractional CFO firm, 14 people, Lisbon. Keeps the books for 60+ startups.",
        href: toolTabHref("growth", "/prospects/companies/12"),
        redacted: false,
    },
    {
        id: "E5",
        kind: "prospect",
        label: "Harbor Co-op Grocers",
        excerpt:
            "Member-owned grocery co-op with three stores. Asked for multi-entity invoicing in May.",
        href: toolTabHref("growth", "/prospects/companies/19"),
        redacted: false,
    },
    {
        id: "E6",
        kind: "brand_comment",
        label: "Comment on “Bank feeds are back”",
        excerpt:
            "Love the bank feeds. Please don't turn this into another tool that charges per invoice.",
        href: toolTabHref("growth", "/brand/engagement"),
        redacted: false,
    },
    {
        id: "E7",
        kind: "company_profile",
        label: "Company profile: pricing and customers",
        excerpt: "Starter $29/month, Growth $79/month. 2,140 paying workspaces, 71% on Starter.",
        href: null,
        redacted: false,
    },
    {
        id: "E8",
        kind: "notes",
        label: "Pasted material",
        excerpt:
            "Competitor note: Tallybook announced a $25 starter tier last week, capped at 20 invoices a month.",
        href: null,
        redacted: false,
    },
];

const PRICE_BRIEF =
    "Ledgerline sells bookkeeping and invoicing to small businesses: Starter at $29 a month and Growth at $79 [E7]. Most paying workspaces are on Starter [E7]. Café and shop owners compare it with spreadsheets rather than other software, and some named $30 as their limit [E1]. Early cancellations rarely cite price; onboarding comes up far more [E3]. A competitor has just launched a $25 tier capped at 20 invoices a month [E8], and some customers are wary of per-invoice charges [E6].";

/** What a person spends and would pay; a seed without one leaves it all null. */
type Wallet = Pick<
    ScenarioPerson,
    | "currentSolution"
    | "budget"
    | "buyingRole"
    | "switchingCost"
    | "firstObjection"
    | "wouldPay"
    | "objection"
>;

type PersonSeed = Omit<
    ScenarioPerson,
    | "stance"
    | "startStance"
    | "posts"
    | "comments"
    | "activity"
    | "followers"
    | "following"
    | keyof Wallet
> & { activity?: number } & Partial<Wallet>;

function person(seed: PersonSeed, index: number): ScenarioPerson {
    const history = seed.stanceHistory;
    return {
        ...seed,
        currentSolution: seed.currentSolution ?? null,
        budget: seed.budget ?? null,
        buyingRole: seed.buyingRole ?? null,
        switchingCost: seed.switchingCost ?? null,
        firstObjection: seed.firstObjection ?? null,
        wouldPay: seed.wouldPay ?? null,
        objection: seed.objection ?? null,
        startStance: history[0]!,
        stance: history[history.length - 1]!,
        activity: seed.activity ?? 0.4 + ((index * 7) % 5) / 10,
        followers: 40 + ((index * 53) % 400),
        following: 20 + ((index * 31) % 120),
        posts: 0,
        comments: 0,
    };
}

/** What each person in the price-rise run spends and would pay, after the last round. */
const PRICE_WALLETS: Record<string, Wallet> = {
    a1: {
        currentSolution: "Ledgerline Growth for her own practice",
        budget: "funded",
        buyingRole: "influences",
        switchingCost: "high",
        firstObjection: "My clients will ask me why they're paying more for the same thing.",
        wouldPay: "maybe",
        objection: "I can't recommend Starter to clients who send ten invoices a month.",
    },
    a2: {
        currentSolution: "Ledgerline Starter",
        budget: "tight",
        buyingRole: "decides",
        switchingCost: "medium",
        firstObjection: "Thirty dollars was my line.",
        wouldPay: "maybe",
        objection: "Thirty-five is over my line once the price hold ends.",
    },
    a3: {
        currentSolution: "Ledgerline Growth across four startups",
        budget: "funded",
        buyingRole: "decides",
        switchingCost: "high",
        firstObjection: "Will the extra money go into the product?",
        wouldPay: "yes",
        objection: null,
    },
    a4: {
        currentSolution: "Ledgerline Growth",
        budget: "funded",
        buyingRole: "decides",
        switchingCost: "high",
        firstObjection: "Is Growth next?",
        wouldPay: "yes",
        objection: null,
    },
    a5: {
        currentSolution: "Ledgerline Starter, one workspace per store",
        budget: "tight",
        buyingRole: "influences",
        switchingCost: "high",
        firstObjection: "Paying more before multi-entity invoicing ships.",
        wouldPay: "maybe",
        objection: "Only worth it if multi-entity invoicing ships in spring.",
    },
    a6: {
        currentSolution: "nothing",
        budget: "none",
        buyingRole: "uses",
        switchingCost: "low",
        firstObjection: "Is this a price rise or a push onto the capped plan?",
        wouldPay: "no",
        objection: null,
    },
    a7: {
        currentSolution: "Recommends Ledgerline or a spreadsheet",
        budget: "none",
        buyingRole: "influences",
        switchingCost: "low",
        firstObjection: "New businesses watch every dollar.",
        wouldPay: "maybe",
        objection: null,
    },
    a8: {
        currentSolution: "Tallybook",
        budget: "tight",
        buyingRole: "decides",
        switchingCost: "medium",
        firstObjection: "Why switch when the capped plan is cheaper?",
        wouldPay: "no",
        objection: "The capped plan covers everything I send.",
    },
    a9: {
        currentSolution: "Ledgerline Growth",
        budget: "funded",
        buyingRole: "influences",
        switchingCost: "medium",
        firstObjection: "Price isn't why people leave.",
        wouldPay: "maybe",
        objection: "Fix onboarding before charging more.",
    },
    a10: {
        currentSolution: "A spreadsheet and PDF invoices",
        budget: "tight",
        buyingRole: "decides",
        switchingCost: "low",
        firstObjection: "Ten dollars a month for six invoices?",
        wouldPay: "no",
        objection: "Ten dollars is ten dollars.",
    },
    a11: {
        currentSolution: "Ledgerline, as a partner",
        budget: "funded",
        buyingRole: "uses",
        switchingCost: "high",
        firstObjection: "Will customers blame us for the increase?",
        wouldPay: "yes",
        objection: null,
    },
    a12: {
        currentSolution: "nothing",
        budget: "none",
        buyingRole: "uses",
        switchingCost: "low",
        firstObjection: "Is there a story here?",
        wouldPay: "no",
        objection: null,
    },
};

const PRICE_PEOPLE: ScenarioPerson[] = [
    {
        id: "a1",
        name: "Maya Lindqvist",
        handle: "mayabooks",
        role: "Bookkeeper with a three-person practice",
        bio: "Keeps the books for about forty cafés and shops. Recommends software to clients and hears about it when prices change.",
        interests: ["client retention", "bank feeds", "pricing"],
        grounding: "grounded",
        sources: ["E1", "E6"],
        stanceHistory: [0, -1, -1, -2, -1, -1, -1, -1, -1],
        lastThought:
            "If the price hold is real I can live with it, but I won't push Starter on new clients who send ten invoices a month.",
    },
    {
        id: "a2",
        name: "Tomás Reyes",
        handle: "tomas.cafe",
        role: "Café owner, on Starter since 2024",
        bio: "Runs a café with eleven staff. Does his own invoicing on Sunday evenings.",
        interests: ["cash flow", "time saved", "simple tools"],
        grounding: "grounded",
        sources: ["E1"],
        stanceHistory: [0, -1, -2, -2, -1, -1, 0, 0, 0],
        lastThought: "Twelve months at $29 buys me time. I'll decide next winter.",
    },
    {
        id: "a3",
        name: "Priya Natarajan",
        handle: "priyacfo",
        role: "Fractional CFO at Northwind Advisory",
        bio: "Manages finance for a portfolio of early-stage startups and picks the tools they run on.",
        interests: ["automation", "reliability", "reporting"],
        grounding: "grounded",
        sources: ["E4"],
        stanceHistory: [1, 1, 1, 1, 2, 2, 2, 2, 2],
        lastThought:
            "Six dollars is noise next to the hours bank feeds save. I'd rather they keep building.",
    },
    {
        id: "a4",
        name: "Jonah Weiss",
        handle: "jonahweiss",
        role: "Runs a design agency, on the Growth plan",
        bio: "Twelve-person studio. Cares about invoices going out on time and nothing else.",
        interests: ["agency ops", "invoicing"],
        grounding: "grounded",
        sources: ["E2", "E7"],
        stanceHistory: [0, 0, 0, 0, 1, 1, 1, 1, 1],
        lastThought: "Doesn't touch my plan. If it pays for reliability, fine.",
    },
    {
        id: "a5",
        name: "Aiko Tanaka",
        handle: "aiko.ops",
        role: "Operations lead at Harbor Co-op Grocers",
        bio: "Runs the back office for a three-store grocery co-op. Has been asking for multi-entity invoicing.",
        interests: ["multi-entity", "co-ops", "roadmap"],
        grounding: "grounded",
        sources: ["E5"],
        stanceHistory: [0, 0, -1, -1, -1, 0, 1, 1, 1],
        lastThought: "If multi-entity invoicing ships in spring, $35 is easy to justify.",
    },
    {
        id: "a6",
        name: "Dev Malhotra",
        handle: "devwrites",
        role: "Writes a newsletter about small-business software",
        bio: "Invented to fill a gap: nobody in the records writes about the market from outside it.",
        interests: ["pricing", "market trends"],
        grounding: "invented",
        sources: [],
        stanceHistory: [0, 0, 0, -1, 0, 0, 1, 1, 1],
        lastThought:
            "The break-even against the capped plan is about 14 invoices. That's the story.",
    },
    {
        id: "a7",
        name: "Grace Owusu",
        handle: "graceadvises",
        role: "Small-business advisor at a chamber of commerce",
        bio: "Invented to fill a gap: someone who advises new businesses before they choose any tool.",
        interests: ["new businesses", "costs"],
        grounding: "invented",
        sources: [],
        stanceHistory: [0, 0, 0, 0, 0, 1, 1, 1, 1],
        lastThought: "For a new business, switching later costs more than six dollars a month.",
    },
    {
        id: "a8",
        name: "Leo Fischer",
        handle: "leo.fischer",
        role: "Freelance consultant who uses Tallybook",
        bio: "Sets up accounting for freelancers and has started moving some of them to the cheaper competitor.",
        interests: ["freelancers", "low cost"],
        grounding: "grounded",
        sources: ["E8"],
        stanceHistory: [-1, -1, -2, -2, -2, -2, -2, -1, -1],
        lastThought:
            "Most of my clients send fewer than twelve invoices. The cap doesn't bite them.",
    },
    {
        id: "a9",
        name: "Sana Qureshi",
        handle: "sanaq",
        role: "Accountant at a twelve-person firm",
        bio: "Recommends software to clients who are setting up. Reads exit surveys for a living.",
        interests: ["evidence", "client onboarding"],
        grounding: "grounded",
        sources: ["E3", "E7"],
        stanceHistory: [0, 0, -1, -1, 0, 0, 0, 0, 0],
        lastThought:
            "Price isn't why people leave. Onboarding is. I'd want to see that fixed first.",
    },
    {
        id: "a10",
        name: "Ben Carter",
        handle: "benmakes",
        role: "Freelance designer comparing invoicing tools",
        bio: "Invented to fill a gap: a new customer the price rise actually applies to.",
        interests: ["freelancing", "low volume"],
        grounding: "invented",
        sources: [],
        stanceHistory: [0, -1, -1, -1, -1, -2, -2, -2, -2],
        lastThought: "I send six invoices a month. Ten dollars is ten dollars.",
    },
    {
        id: "a11",
        name: "Inês Duarte",
        handle: "ines.cs",
        role: "Customer success lead at a Ledgerline partner",
        bio: "Answers customers' questions for an implementation partner; reads every comment on the company's posts.",
        interests: ["customer questions", "clarity"],
        grounding: "grounded",
        sources: ["E6", "E1"],
        stanceHistory: [0, 1, 1, 1, 1, 1, 1, 1, 1],
        lastThought: "Most of the anger was about something that doesn't apply to them.",
    },
    {
        id: "a12",
        name: "Rafael Costa",
        handle: "rafacosta",
        role: "Reporter covering small-business tech",
        bio: "Invented to fill a gap: the press, which the records don't cover.",
        interests: ["small business", "software prices"],
        grounding: "invented",
        sources: [],
        stanceHistory: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        lastThought: "The first day looked like a revolt. It wasn't.",
    },
].map((seed, i) => person({ ...seed, ...PRICE_WALLETS[seed.id] } as PersonSeed, i));

const byId = new Map(PRICE_PEOPLE.map(p => [p.id, p]));

function c(id: string, authorId: string, round: number, text: string): ScenarioComment {
    const author = byId.get(authorId)!;
    return {
        id,
        authorId,
        authorName: author.name,
        authorHandle: author.handle,
        round,
        text,
    };
}

function p(
    id: string,
    authorId: string,
    round: number,
    text: string,
    extra: Partial<ScenarioPost> = {}
): ScenarioPost {
    const narrator = authorId === "narrator";
    const author = byId.get(authorId);
    return {
        id,
        authorId,
        authorName: narrator ? "Narrator" : author!.name,
        authorHandle: narrator ? "narrator" : author!.handle,
        authorKind: narrator ? "narrator" : "agent",
        round,
        kind: narrator ? (round === 0 ? "seed" : "event") : "post",
        text,
        root: null,
        likes: 1 + ((id.length * 7 + round * 3) % 5),
        dislikes: (round * 5 + id.length) % 3,
        shares: (round + id.length) % 3,
        comments: [],
        ...extra,
    };
}

function rootOf(post: ScenarioPost): ScenarioPost["root"] {
    return { id: post.id, authorHandle: post.authorHandle, text: post.text };
}

function pricePosts(): ScenarioPost[] {
    const posts: ScenarioPost[] = [];
    const add = (post: ScenarioPost) => {
        posts.push(post);
        return post;
    };
    const find = (id: string) => posts.find(x => x.id === id)!;

    add(
        p(
            "p1",
            "narrator",
            0,
            "Ledgerline announces: from January 1, the Starter plan costs $35 a month for new customers, up from $29. Existing customers keep $29 for 12 months.",
            { likes: 4, dislikes: 2, shares: 3 }
        )
    );
    // Round 1: first reactions.
    add(
        p(
            "p2",
            "a1",
            1,
            "Telling my clients about Starter going to $35. Most of them chose it because it was under $30. Not a great week to be the person who recommended it.",
            {
                likes: 6,
                shares: 2,
                comments: [
                    c("c1", "a2", 1, "I'm one of those clients. $29 was the whole reason."),
                    c(
                        "c2",
                        "a11",
                        1,
                        "Existing customers stay at $29 for a year, if that helps your clients."
                    ),
                ],
            }
        )
    );
    add(
        p(
            "p3",
            "a3",
            1,
            "$6 a month for bank feeds that actually work is fine by me. I bill more than that for ten minutes of reconciling by hand.",
            {
                likes: 5,
                comments: [
                    c("c3", "a6", 1, "Is that true for a café doing 40 invoices a month though?"),
                ],
            }
        )
    );
    add(
        p(
            "p4",
            "a12",
            1,
            "Small-business software prices are creeping up across the board. Ledgerline is the latest: Starter goes from $29 to $35 for new sign-ups. Anyone affected want to talk?",
            { likes: 2, shares: 1 }
        )
    );
    add(
        p(
            "p5",
            "a2",
            1,
            "$35. I said in an interview that $30 was my limit. Guess nobody read it.",
            {
                kind: "quote",
                root: rootOf(find("p1")),
                likes: 7,
                dislikes: 1,
                shares: 2,
            }
        )
    );
    // Round 2: the competitor enters.
    add(
        p(
            "p6",
            "a8",
            2,
            "Tallybook launched a $25 starter tier last week. Just saying. Switched two clients already.",
            {
                likes: 6,
                dislikes: 2,
                shares: 4,
                comments: [
                    c("c4", "a1", 2, "Capped at 20 invoices though, isn't it?"),
                    c("c5", "a8", 2, "Most of my clients send 12."),
                ],
            }
        )
    );
    add(
        p(
            "p7",
            "a5",
            2,
            "We'd pay more if multi-entity invoicing were in it. Three stores, three sets of books. Nobody has mentioned that.",
            {
                likes: 4,
                comments: [c("c6", "a4", 2, "+1, that's the feature that would justify it.")],
            }
        )
    );
    add(
        p(
            "p8",
            "a9",
            2,
            "Before anyone panics: early cancellations rarely mention price. Onboarding is where people leave. A $6 change won't move that much; a confusing announcement might.",
            {
                likes: 5,
                comments: [
                    c("c7", "a6", 2, "Source?"),
                    c(
                        "c8",
                        "a9",
                        2,
                        "Our firm's exit surveys, and it matches what Ledgerline's own churn notes say."
                    ),
                ],
            }
        )
    );
    add(p("p9", "a10", 2, "", { kind: "repost", root: rootOf(find("p6")), likes: 0, shares: 1 }));
    // Round 3: the critical peak.
    add(
        p(
            "p10",
            "a1",
            3,
            "I won't be recommending Starter to new clients after January. $35 for a café doing ten invoices a month is too much when there's a $25 option.",
            {
                likes: 9,
                dislikes: 2,
                shares: 5,
                comments: [
                    c("c9", "a8", 3, "Exactly this."),
                    c(
                        "c10",
                        "a3",
                        3,
                        "The $25 one caps you at 20 invoices. Your cafés will hit that in a busy month."
                    ),
                    c("c11", "a2", 3, "Ten invoices is me."),
                ],
            }
        )
    );
    add(p("p11", "a2", 3, "", { kind: "repost", root: rootOf(find("p10")), likes: 0, shares: 2 }));
    add(
        p(
            "p12",
            "a6",
            3,
            "Counting the replies today: most are about new customers, but almost everyone replying is an existing one. Interesting mismatch.",
            {
                likes: 4,
                comments: [c("c12", "a7", 3, "People defend the people they recommend to.")],
            }
        )
    );
    add(
        p(
            "p13",
            "a11",
            3,
            "To clear something up: if you're on Starter today, nothing changes for 12 months. The new price is for new sign-ups.",
            {
                likes: 6,
                shares: 4,
                comments: [c("c13", "a1", 3, "Then say that first. The announcement buried it.")],
            }
        )
    );
    add(
        p("p14", "a10", 3, "I'm a customer in waiting. Was about to sign up. Now I'm comparing.", {
            likes: 3,
        })
    );
    // Round 4: the event added halfway.
    add(p("p15", "narrator", 4, PRICE_RUN_EVENT, { likes: 7, dislikes: 0, shares: 6 }));
    add(
        p(
            "p16",
            "a3",
            4,
            "Unlimited invoices at $35 against 20 invoices at $25. That's the comparison people should be making.",
            { kind: "quote", root: rootOf(find("p15")), likes: 8, shares: 3 }
        )
    );
    add(
        p("p17", "a2", 4, "OK, twelve months at $29 buys me time. Not happy, not leaving.", {
            likes: 5,
            comments: [c("c14", "a11", 4, "That's fair. Thanks for staying.")],
        })
    );
    add(
        p(
            "p18",
            "a4",
            4,
            "For an agency the increase is a rounding error. What I care about is that bank feeds stay reliable.",
            { likes: 3 }
        )
    );
    // Round 5.
    add(
        p(
            "p19",
            "a5",
            5,
            "Asked their support about multi-entity invoicing: “on the roadmap for spring.” If that lands, $35 is easy to justify for us.",
            { likes: 4, comments: [c("c15", "a9", 5, "Get it in writing.")] }
        )
    );
    add(
        p(
            "p20",
            "a7",
            5,
            "For the new businesses I advise, $35 a month is still less than an hour with a bookkeeper. The real cost is switching later.",
            { likes: 5, shares: 2 }
        )
    );
    add(
        p("p21", "a8", 5, "Still think $25 wins for most freelancers. Not everyone runs a café.", {
            likes: 3,
            dislikes: 2,
        })
    );
    // Round 6: the break-even.
    add(
        p(
            "p22",
            "a6",
            6,
            "Wrote it up: $35 with unlimited invoices against $25 capped at 20. If you send more than about 14 invoices a month, the cap costs you more than the difference.",
            {
                likes: 11,
                shares: 7,
                comments: [c("c16", "a12", 6, "Can I quote this?"), c("c17", "a6", 6, "Go ahead.")],
            }
        )
    );
    add(
        p("p23", "a10", 6, "I send 6 a month. The cap doesn't matter to me; the $10 does.", {
            kind: "quote",
            root: rootOf(find("p22")),
            likes: 4,
            shares: 1,
        })
    );
    add(
        p(
            "p24",
            "a1",
            6,
            "Fine. I'll tell clients on the fence to sign up before January. Still think the announcement should have led with the price hold.",
            { likes: 6, shares: 1 }
        )
    );
    // Round 7.
    add(
        p(
            "p25",
            "a12",
            7,
            "Story's up: Ledgerline's price rise lands softer than the first day suggested. Existing customers are protected; freelancers who send few invoices are the ones looking elsewhere.",
            { likes: 5, shares: 4 }
        )
    );
    add(
        p(
            "p26",
            "a9",
            7,
            "Our firm will keep recommending Ledgerline to clients with more than 15 invoices a month. Below that, it's a closer call.",
            { likes: 4 }
        )
    );
    add(p("p27", "a11", 7, "", { kind: "repost", root: rootOf(find("p22")), likes: 0, shares: 1 }));
    // Round 8: settling.
    add(
        p(
            "p28",
            "a3",
            8,
            "Final word from me: the price is fine, the communication wasn't. Lead with who it doesn't affect.",
            { likes: 7, shares: 2 }
        )
    );
    add(
        p(
            "p29",
            "a8",
            8,
            "Two more of my clients asked about Tallybook this week. Both send under ten invoices.",
            { likes: 2, dislikes: 1 }
        )
    );
    add(p("p30", "a5", 8, "We're staying. Waiting on multi-entity invoicing.", { likes: 3 }));
    return posts;
}

const PRICE_REPORT_BASE: Omit<ScenarioReport, "factions"> = {
    headline:
        "Existing customers settled once the 12-month price hold was clear; freelancers who send few invoices kept looking at the $25 alternative.",
    summary:
        "The first two rounds were dominated by bookkeepers and existing customers reacting to a price they would not actually pay. Criticism peaked in round 3, when a bookkeeper who recommends the product to about forty clients said she would stop. The event in round 4 — current customers keep $29 for 12 months and Starter keeps unlimited invoices — turned most of the conversation. By round 8 half the people were supportive. The critics left were freelancers who send fewer than ten invoices a month, for whom the competitor's capped $25 plan is cheaper.",
    dynamics: [
        {
            text: "Existing customers argued on behalf of the new customers they recommend to; very few of the critics would pay the new price themselves.",
            postIds: ["p2", "p12", "p13"],
        },
        {
            text: "The $25 competitor tier drove the critical wave, and its invoice cap is what took the air out of it.",
            postIds: ["p6", "p10", "p16", "p22"],
        },
        {
            text: "One feature — multi-entity invoicing — came up again and again as the thing that would make $35 easy to accept.",
            postIds: ["p7", "p19", "p30"],
        },
    ],
    turningPoints: [
        {
            round: 3,
            text: "A bookkeeper said she would stop recommending Starter to new clients; it was the most shared post of the run.",
            postIds: ["p10"],
        },
        {
            round: 4,
            text: "The event confirming the 12-month price hold and unlimited invoices. Three critics moved toward neutral within a round.",
            postIds: ["p15", "p17"],
        },
        {
            round: 6,
            text: "A newsletter writer worked out the break-even at about 14 invoices a month, and the argument narrowed to low-volume freelancers.",
            postIds: ["p22", "p23"],
        },
    ],
    watchFor: [
        "Whether bookkeepers and accountants who recommend you change what they tell new businesses.",
        "Sign-ups from freelancers who send fewer than ten invoices a month, against the $25 alternative.",
        "Questions about multi-entity invoicing in support and sales calls.",
        "Whether the announcement's first line says who is not affected.",
    ],
};

export function priceScript(): Script {
    const posts = pricePosts();
    const people = countActivity(PRICE_PEOPLE, posts);
    return {
        brief: PRICE_BRIEF,
        sources: PRICE_SOURCES,
        people,
        posts,
        rounds: roundStats(people, posts, 8),
        report: {
            ...PRICE_REPORT_BASE,
            factions: [
                {
                    stance: "supportive",
                    label: "Fine with it",
                    text: "See $6 as small next to the time the product saves; care more about reliability and the roadmap.",
                    share: 6 / 12,
                    agentIds: ["a3", "a4", "a5", "a6", "a7", "a11"],
                },
                {
                    stance: "neutral",
                    label: "Waiting to see",
                    text: "Protected by the price hold or still undecided; they will judge in a year.",
                    share: 3 / 12,
                    agentIds: ["a2", "a9", "a12"],
                },
                {
                    stance: "critical",
                    label: "Looking elsewhere",
                    text: "Low-volume freelancers and the bookkeeper who advises them; the capped $25 plan is cheaper for them.",
                    share: 3 / 12,
                    agentIds: ["a1", "a8", "a10"],
                },
            ],
        },
        reception: null,
    };
}

// ── Any subject ───────────────────────────────────────────────────────────

const FIRST = [
    "Amara",
    "Lukas",
    "Noor",
    "Mateo",
    "Hana",
    "Oskar",
    "Zara",
    "Felix",
    "Leila",
    "Jonas",
    "Mei",
    "Arjun",
    "Sofia",
    "Kwame",
    "Elif",
    "Tobias",
    "Ana",
    "Yusuf",
    "Clara",
    "Ravi",
    "Ingrid",
    "Diego",
    "Nadia",
    "Emil",
    "Farah",
    "Hugo",
    "Lena",
    "Omar",
    "Yara",
    "Sven",
    "Imani",
    "Pablo",
    "Keiko",
    "Marek",
    "Ayla",
    "Theo",
    "Rosa",
    "Kofi",
    "Vera",
    "Idris",
] as const;

const LAST = [
    "Okafor",
    "Berg",
    "Haddad",
    "Silva",
    "Kimura",
    "Novak",
    "Mensah",
    "Varga",
    "Rahman",
    "Lund",
    "Moreau",
    "Iyer",
    "Costa",
    "Adeyemi",
    "Kaya",
    "Brandt",
    "Rossi",
    "Nakamura",
    "Petrov",
    "Ali",
    "Jensen",
    "Ortega",
    "Hassan",
    "Weber",
    "Chen",
    "Dubois",
    "Kowalski",
    "Sato",
    "Nkemelu",
    "Park",
] as const;

const ROLES: ReadonlyArray<{ role: string; bio: string; interests: string[] }> = [
    {
        role: "Owns a small retail shop",
        bio: "Runs the shop with two part-timers and does the admin at night.",
        interests: ["cash flow", "simple tools"],
    },
    {
        role: "Bookkeeper for local businesses",
        bio: "Keeps the books for a few dozen small businesses and recommends the tools they use.",
        interests: ["client retention", "accuracy"],
    },
    {
        role: "Operations manager at a 40-person company",
        bio: "Owns the processes nobody else wants to own, and the budget for the tools behind them.",
        interests: ["process", "budgets"],
    },
    {
        role: "Founder of a 12-person agency",
        bio: "Juggles clients, hiring and invoices; wants the back office to stay out of the way.",
        interests: ["growth", "time saved"],
    },
    {
        role: "Freelance designer",
        bio: "Works alone and watches every subscription.",
        interests: ["low cost", "freelancing"],
    },
    {
        role: "Finance lead at a nonprofit",
        bio: "Answers to a board and a grant budget; changes need a reason on paper.",
        interests: ["compliance", "predictability"],
    },
    {
        role: "Industry analyst",
        bio: "Follows the market from outside and writes about what changes.",
        interests: ["market trends", "pricing"],
    },
    {
        role: "Customer success manager at a partner",
        bio: "Hears customers' questions first and has to answer them.",
        interests: ["clarity", "support"],
    },
    {
        role: "Procurement lead at a mid-size firm",
        bio: "Compares vendors for a living and keeps a spreadsheet of every renewal date.",
        interests: ["contracts", "alternatives"],
    },
    {
        role: "Reporter covering small business",
        bio: "Looks for the story behind an announcement.",
        interests: ["small business", "news"],
    },
    {
        role: "Long-time customer",
        bio: "Has used the product for years and remembers every change.",
        interests: ["stability", "loyalty"],
    },
    {
        role: "Prospective customer",
        bio: "Is choosing between a few options right now.",
        interests: ["comparisons", "first impressions"],
    },
];

const POST_LINES: Record<"for" | "mixed" | "against", readonly string[]> = {
    for: [
        "Honestly, this makes sense to me. Explained well, most people will get it.",
        "I'm for it. The people who stay are the ones who get the most out of it anyway.",
        "People are overreacting. This is a reasonable call.",
        "Good move. I'd have done the same in their position.",
        "Fine by me, as long as it's explained clearly and early.",
        "Read it twice. The trade-off is worth it for us.",
        "Glad someone finally made this decision instead of putting it off.",
    ],
    mixed: [
        "Waiting for the details before I decide. Who does this actually affect?",
        "Curious how this plays out for the smallest customers.",
        "Does anyone have numbers on this? Hard to judge from one announcement.",
        "Could go either way. Depends entirely on how it's rolled out.",
        "Not for or against yet. The second announcement will tell us more than the first.",
        "Asked our account manager. Still no clear answer on timing.",
    ],
    against: [
        "Not happy about this. Nobody asked the people it affects.",
        "This feels rushed. I'll be looking at alternatives.",
        "If this goes ahead as written, I'm out. There are other options.",
        "Bad timing, and worse communication.",
        "Every change like this makes it harder to recommend them.",
        "We planned our year around the old terms. Now what?",
    ],
};

const COMMENT_LINES: Record<"for" | "mixed" | "against", readonly string[]> = {
    for: ["Agreed.", "Same here, it's reasonable.", "Fair point.", "This is the right take."],
    mixed: ["Depends on the details.", "Good question.", "I'd like numbers too.", "Not sure yet."],
    against: [
        "Strongly disagree.",
        "Same, I'm looking elsewhere.",
        "This is the problem.",
        "Nobody asked for this.",
    ],
};

const mood = (s: Stance) => (s > 0 ? "for" : s < 0 ? "against" : "mixed");

export interface GenerateOptions {
    seed: number;
    subject: string;
    agents: number;
    rounds: number;
    sources: ScenarioSource[];
    kind: ScenarioKind;
    /** Post tests: the draft is the opening post. */
    draft?: { text: string; networks: string[] } | null;
}

/** A plausible network for any subject: people, rounds of posts, a report. */
export function generateScript(o: GenerateOptions): Script {
    const rand = rng(o.seed);
    const agents = Math.max(1, o.agents);
    const usable = o.sources.filter(s => !s.redacted);

    // People. Names are unique combinations; most are grounded when there is
    // something to ground them in.
    const used = new Set<string>();
    const people: ScenarioPerson[] = [];
    for (let i = 0; i < agents; i++) {
        let name = "";
        for (let tries = 0; tries < 50; tries++) {
            name = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
            if (!used.has(name)) break;
        }
        if (used.has(name)) name = `${name} ${i + 1}`;
        used.add(name);
        const role = ROLES[(i + Math.floor(rand() * ROLES.length)) % ROLES.length]!;
        const grounded = o.sources.length > 0 && rand() < 0.72;
        const cited = grounded
            ? [...new Set([pick(rand, o.sources).id, pick(rand, o.sources).id])].slice(
                  0,
                  1 + Math.floor(rand() * 2)
              )
            : [];
        const start = clampStance(
            [-2, -1, -1, 0, 0, 0, 1, 1, 2][Math.floor(rand() * 9)]! + (o.draft ? 0.4 : 0)
        );
        const history: Stance[] = [start];
        for (let r = 1; r <= o.rounds; r++) {
            const prev = history[r - 1]!;
            const roll = rand();
            const drift = roll < 0.16 ? -1 : roll > 0.8 ? 1 : 0;
            history.push(clampStance(prev + drift));
        }
        const handle = name
            .toLowerCase()
            .replace(/[^a-z]+/g, ".")
            .replace(/\.+$/, "");
        people.push({
            id: `g${o.seed % 1000}-${i + 1}`,
            name,
            handle,
            role: role.role,
            bio: grounded
                ? role.bio
                : `Invented to fill a gap: ${role.bio.charAt(0).toLowerCase()}${role.bio.slice(1)}`,
            interests: role.interests,
            grounding: grounded ? "grounded" : "invented",
            sources: cited,
            startStance: start,
            stance: history[history.length - 1]!,
            stanceHistory: history,
            activity: Math.round((0.2 + rand() * 0.7) * 100) / 100,
            followers: 20 + Math.floor(rand() * 900),
            following: 10 + Math.floor(rand() * 200),
            posts: 0,
            comments: 0,
            lastThought: null,
            // Set from the index and stance, not `rand`, so the rest of the script draws the same.
            currentSolution: i % 4 === 0 ? "nothing" : "A spreadsheet",
            budget: (["tight", "none", "funded"] as const)[i % 3]!,
            buyingRole: (["decides", "influences", "uses"] as const)[i % 3]!,
            switchingCost: (["medium", "low", "high"] as const)[i % 3]!,
            firstObjection: null,
            wouldPay: history[history.length - 1]! > 0 ? "maybe" : "no",
            objection: null,
        });
    }

    // Posts.
    const posts: ScenarioPost[] = [];
    let n = 0;
    const postId = () => `s${o.seed % 1000}-p${++n}`;
    const commentId = () => `s${o.seed % 1000}-c${++n}`;
    const seed: ScenarioPost = o.draft
        ? {
              id: postId(),
              authorId: "brand",
              authorName: "Your draft",
              authorHandle: "you",
              authorKind: "brand",
              round: 0,
              kind: "seed",
              text: o.draft.text,
              root: null,
              likes: 0,
              dislikes: 0,
              shares: 0,
              comments: [],
          }
        : {
              id: postId(),
              authorId: "narrator",
              authorName: "Narrator",
              authorHandle: "narrator",
              authorKind: "narrator",
              round: 0,
              kind: "seed",
              text: o.subject,
              root: null,
              likes: 2 + Math.floor(rand() * 5),
              dislikes: Math.floor(rand() * 3),
              shares: 1 + Math.floor(rand() * 3),
              comments: [],
          };
    posts.push(seed);
    const perRound = Math.max(1, Math.min(10, Math.round(agents * 0.18)));
    for (let r = 1; r <= o.rounds; r++) {
        const order = [...people].sort((a, b) => b.activity * rand() - a.activity * rand());
        const posters = order.slice(0, perRound);
        for (const author of posters) {
            const stance = author.stanceHistory[r]!;
            const earlier = posts.filter(x => x.round < r && x.kind !== "repost");
            const roll = rand();
            const kind: ScenarioPost["kind"] =
                roll < 0.14 && earlier.length > 0
                    ? "repost"
                    : roll < 0.28 && earlier.length > 0
                      ? "quote"
                      : "post";
            const root = kind === "post" ? null : pick(rand, earlier);
            const comments: ScenarioComment[] = [];
            const howMany = kind === "repost" ? 0 : Math.floor(rand() * 3.2);
            for (let k = 0; k < howMany; k++) {
                const who = pick(rand, people);
                if (who.id === author.id) continue;
                comments.push({
                    id: commentId(),
                    authorId: who.id,
                    authorName: who.name,
                    authorHandle: who.handle,
                    round: r,
                    text: pick(rand, COMMENT_LINES[mood(who.stanceHistory[r]!)]),
                });
            }
            posts.push({
                id: postId(),
                authorId: author.id,
                authorName: author.name,
                authorHandle: author.handle,
                authorKind: "agent",
                round: r,
                kind,
                text: kind === "repost" ? "" : pick(rand, POST_LINES[mood(stance)]),
                root: root
                    ? { id: root.id, authorHandle: root.authorHandle, text: root.text }
                    : null,
                likes: Math.floor(rand() * 9),
                dislikes: Math.floor(rand() * 3),
                shares: Math.floor(rand() * 4),
                comments,
            });
        }
        // Readers answer the draft under test directly, every round.
        if (o.draft) {
            const readers = people.filter(() => rand() < 0.28).slice(0, 3);
            for (const who of readers) {
                const s = who.stanceHistory[r]!;
                seed.comments.push({
                    id: commentId(),
                    authorId: who.id,
                    authorName: who.name,
                    authorHandle: who.handle,
                    round: r,
                    text: pick(rand, DRAFT_COMMENTS[mood(s)]),
                });
                if (s > 0) seed.likes++;
                if (s < 0 && rand() < 0.5) seed.dislikes++;
                if (s > 0 && rand() < 0.3) seed.shares++;
            }
            for (const who of people) {
                if (who.stanceHistory[r]! > 0 && rand() < 0.22) seed.likes++;
            }
        }
    }

    const lastThoughts = people.map(person => ({
        ...person,
        lastThought: pick(rand, THOUGHTS[mood(person.stance)]),
    }));
    const counted = countActivity(lastThoughts, posts);
    const rounds = roundStats(counted, posts, o.rounds);
    const reception = o.draft ? receptionOf(seed, counted) : null;
    return {
        brief: briefFor(o.subject, usable),
        sources: o.sources,
        people: counted,
        posts,
        rounds,
        report: reportFor(o.subject, counted, posts, rounds, reception),
        reception,
    };
}

const DRAFT_COMMENTS: Record<"for" | "mixed" | "against", readonly string[]> = {
    for: [
        "This is useful, thanks for sharing.",
        "Exactly what we needed. Sending it to the team.",
        "Good to see this spelled out.",
        "Love it. When does it roll out?",
    ],
    mixed: [
        "Interesting. How does this work for smaller teams?",
        "Is there a page with the details?",
        "Not sure I follow the second part.",
        "Curious what it costs.",
    ],
    against: [
        "Feels like a lot of words for a small change.",
        "Another announcement, same problems.",
        "Not convinced. Show me the numbers.",
    ],
};

const THOUGHTS: Record<"for" | "mixed" | "against", readonly string[]> = {
    for: [
        "It's a reasonable change and the reasons hold up.",
        "I'd tell a friend this is fine.",
        "Better than the alternative.",
    ],
    mixed: [
        "I'll wait for the second announcement.",
        "Doesn't affect me yet.",
        "I need to see what it means in practice.",
    ],
    against: [
        "They didn't ask the people this lands on.",
        "I'm comparing alternatives this week.",
        "The reasons don't add up for someone my size.",
    ],
};

function receptionOf(seed: ScenarioPost, people: ScenarioPerson[]): ScenarioReception {
    const exposed = people.length;
    const commenters = new Set(seed.comments.map(x => x.authorId)).size;
    const engaged = Math.min(exposed, commenters + seed.likes + seed.shares);
    return {
        postId: seed.id,
        exposed,
        engaged,
        engagementRate: exposed ? engaged / exposed : 0,
        likes: seed.likes,
        dislikes: seed.dislikes,
        comments: seed.comments.length,
        shares: seed.shares,
        startingSentiment: Math.round(mean(people.map(x => x.startStance)) * 100) / 100,
        sentiment: Math.round(mean(people.map(x => x.stance)) * 100) / 100,
    };
}

function briefFor(subject: string, sources: ScenarioSource[]): string {
    if (sources.length === 0) {
        return `The situation: ${subject} Nothing from the workspace's records was given, so everyone in this run was invented.`;
    }
    const cites = sources
        .slice(0, 4)
        .map(s => `${s.label} [${s.id}]`)
        .join("; ");
    return `The situation: ${subject} Everyone knew what the workspace's records say about it: ${cites}.`;
}

function reportFor(
    subject: string,
    people: ScenarioPerson[],
    posts: ScenarioPost[],
    rounds: ScenarioRoundStats[],
    reception: ScenarioReception | null
): ScenarioReport {
    const end = mean(people.map(x => x.stance));
    const start = mean(people.map(x => x.startStance));
    const loudest = [...posts]
        .filter(x => x.authorKind === "agent" && x.text)
        .sort((a, b) => b.likes + b.shares * 2 - (a.likes + a.shares * 2))
        .slice(0, 3);
    // The round where the mean moved most from the round before.
    const means = [start, ...rounds.map(r => r.meanStance)];
    let swingRound = 0;
    let swingSize = -1;
    for (let r = 1; r < means.length; r++) {
        const delta = Math.abs(means[r]! - means[r - 1]!);
        if (delta > swingSize) {
            swingSize = delta;
            swingRound = r;
        }
    }
    const direction =
        end - start > 0.15
            ? "warmed to it"
            : end - start < -0.15
              ? "cooled on it"
              : "held roughly where they started";
    const headline = reception
        ? `Readers ${reception.engagementRate >= 0.35 ? "responded well" : reception.engagementRate >= 0.15 ? "responded, but not widely" : "mostly scrolled past"}: ${reception.comments} commented, and the mood ${reception.sentiment > reception.startingSentiment + 0.05 ? "warmed" : reception.sentiment < reception.startingSentiment - 0.05 ? "cooled" : "held steady"} over ${rounds.length} rounds.`
        : end > 0.4
          ? "Most people came round to it; a critical minority held out."
          : end < -0.4
            ? "Most people were against it, and the criticism grew louder over the rounds."
            : "Opinion split: neither side won the argument by the last round.";
    const factions = factionsOf(people);
    return {
        headline,
        summary: `Over ${rounds.length} rounds, ${people.length} people reacted to: “${subject}” Overall they ${direction}. The most shared posts set the tone, and replies tended to follow whoever answered first.`,
        dynamics: loudest.length
            ? [
                  {
                      text: "A few early posts drew most of the replies and shares, and later posts answered them rather than the situation itself.",
                      postIds: loudest.map(x => x.id),
                  },
              ]
            : [],
        turningPoints:
            swingRound > 0
                ? [
                      {
                          round: swingRound,
                          text: `The biggest change in mood came in round ${swingRound}.`,
                          postIds: posts
                              .filter(x => x.round === swingRound && x.authorKind === "agent")
                              .slice(0, 2)
                              .map(x => x.id),
                      },
                  ]
                : [],
        factions,
        watchFor: [
            "Who answers first when this is announced, and whether they are the people it affects.",
            "Questions that come up more than once; they are what the announcement left out.",
            "Whether the people who recommend you to others repeat it, or argue with it.",
        ],
    };
}
