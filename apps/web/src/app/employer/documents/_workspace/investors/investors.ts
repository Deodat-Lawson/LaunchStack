/**
 * The pure half of Investor relations: what the pane shows about a fund,
 * what it asks the chat to write, and the list it saves as a source.
 * Everything here is a function of a search result, so it is tested without
 * rendering anything.
 */
import type { FundProfile, InvestorSearchResult } from "@launchstack/tools/investor-search";

export type { FundProfile, InvestorSearchResult };

/** The windows the search route accepts, in days. */
export const WITHIN_OPTIONS = [
    { days: 30, label: "Last 30 days" },
    { days: 90, label: "Last 90 days" },
    { days: 180, label: "Last 6 months" },
    { days: 365, label: "Last 12 months" },
] as const;

export const US_STATES: ReadonlyArray<readonly [code: string, name: string]> = [
    ["AL", "Alabama"],
    ["AK", "Alaska"],
    ["AZ", "Arizona"],
    ["AR", "Arkansas"],
    ["CA", "California"],
    ["CO", "Colorado"],
    ["CT", "Connecticut"],
    ["DE", "Delaware"],
    ["DC", "District of Columbia"],
    ["FL", "Florida"],
    ["GA", "Georgia"],
    ["HI", "Hawaii"],
    ["ID", "Idaho"],
    ["IL", "Illinois"],
    ["IN", "Indiana"],
    ["IA", "Iowa"],
    ["KS", "Kansas"],
    ["KY", "Kentucky"],
    ["LA", "Louisiana"],
    ["ME", "Maine"],
    ["MD", "Maryland"],
    ["MA", "Massachusetts"],
    ["MI", "Michigan"],
    ["MN", "Minnesota"],
    ["MS", "Mississippi"],
    ["MO", "Missouri"],
    ["MT", "Montana"],
    ["NE", "Nebraska"],
    ["NV", "Nevada"],
    ["NH", "New Hampshire"],
    ["NJ", "New Jersey"],
    ["NM", "New Mexico"],
    ["NY", "New York"],
    ["NC", "North Carolina"],
    ["ND", "North Dakota"],
    ["OH", "Ohio"],
    ["OK", "Oklahoma"],
    ["OR", "Oregon"],
    ["PA", "Pennsylvania"],
    ["RI", "Rhode Island"],
    ["SC", "South Carolina"],
    ["SD", "South Dakota"],
    ["TN", "Tennessee"],
    ["TX", "Texas"],
    ["UT", "Utah"],
    ["VT", "Vermont"],
    ["VA", "Virginia"],
    ["WA", "Washington"],
    ["WV", "West Virginia"],
    ["WI", "Wisconsin"],
    ["WY", "Wyoming"],
];

/** $500M, $21.5M, $750K — how a founder says a fund size. */
export function formatUsd(amount: number): string {
    const abs = Math.abs(amount);
    // Round in tenths, not with toFixed: 21.45 is stored as 21.4499…, and
    // toFixed would call a $21.45M fund $21.4M.
    const trim = (n: number) =>
        n >= 100 ? Math.round(n).toString() : String(Math.round(n * 10 + 1e-9) / 10);
    if (abs >= 1e9) return `$${trim(amount / 1e9)}B`;
    if (abs >= 1e6) return `$${trim(amount / 1e6)}M`;
    if (abs >= 1e3) return `$${trim(amount / 1e3)}K`;
    return `$${Math.round(amount)}`;
}

/**
 * "Raising $500M · nothing closed yet", "Raising $80M · $21M closed",
 * "Size not stated · $1.9B closed". Undefined when the filing was not read.
 */
export function describeRaise(fund: FundProfile): string | undefined {
    if (!fund.detailed) return undefined;
    const target =
        fund.offeringAmount === null || fund.offeringAmount === undefined
            ? "Size not stated"
            : `Raising ${formatUsd(fund.offeringAmount)}`;
    const sold = fund.amountSold ?? 0;
    const closed = sold > 0 ? `${formatUsd(sold)} closed` : "nothing closed yet";
    return `${target} · ${closed}`;
}

/** Largest first by what the fund means to raise; unknown sizes last. */
export function sortFunds(funds: readonly FundProfile[], by: "newest" | "largest"): FundProfile[] {
    const copy = [...funds];
    if (by === "newest") return copy.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
    const size = (f: FundProfile) => Math.max(f.offeringAmount ?? 0, f.amountSold ?? 0);
    return copy.sort((a, b) => size(b) - size(a) || b.filedAt.localeCompare(a.filedAt));
}

/** The people to write to, before any general-partner entity. */
export function peopleOf(fund: FundProfile): FundProfile["managers"] {
    return fund.managers.filter(m => m.kind === "person");
}

/** A web search for the fund's own site — Form D does not carry one. */
export function websiteSearchUrl(fund: FundProfile): string {
    const name = fund.name.replace(/,?\s+(L\.?P\.?|LLC|L\.L\.C\.|Ltd\.?|Inc\.?)$/i, "");
    return `https://duckduckgo.com/?q=${encodeURIComponent(`${name} venture capital`)}`;
}

/**
 * What "Draft intro" asks the chat for. Grounded in the workspace's own
 * sources, and specific about what is known of the fund — and what is not,
 * so the draft does not invent a thesis the filing never stated.
 */
export function introPrompt(fund: FundProfile): string {
    const people = peopleOf(fund);
    const to =
        people.length > 0
            ? `${people[0]!.name}${people[0]!.title ? ` (${people[0]!.title})` : ""}`
            : "the partners";
    const facts = [
        `Fund: ${fund.name}${fund.location ? `, ${fund.location}` : ""}.`,
        `Filed a Form D with the SEC on ${fund.filedAt}${fund.amendment ? " (an amendment)" : ""}.`,
        describeRaise(fund) ? `${describeRaise(fund)}.` : undefined,
        people.length > 1
            ? `Other people named on the filing: ${people
                  .slice(1)
                  .map(p => p.name)
                  .join(", ")}.`
            : undefined,
    ].filter(Boolean);
    return [
        `Draft a short cold intro email to ${to} at ${fund.name}.`,
        "",
        "What we know about them, from their public SEC filing:",
        ...facts.map(f => `- ${f}`),
        "",
        "Use our workspace sources for what we do, our traction and why we are raising. Keep it under 150 words, plain text, with a subject line and one specific ask: a 20-minute call. The filing says nothing about their investment thesis — don't claim to know it; if a reason we fit is a guess, say so in a note after the email.",
    ].join("\n");
}

/** The list as Markdown, to save as a source the chat can cite later. */
export function fundsMarkdown(
    funds: readonly FundProfile[],
    search: { q: string; state: string; withinDays: number },
    now = new Date()
): string {
    const filters = [
        search.q ? `matching "${search.q}"` : undefined,
        search.state ? `in ${search.state}` : undefined,
        `filed in the last ${search.withinDays} days`,
    ]
        .filter(Boolean)
        .join(", ");
    const lines = [
        `# Venture funds raising — ${now.toISOString().slice(0, 10)}`,
        "",
        `Venture capital funds that filed a Form D with the SEC, ${filters}. Source: SEC EDGAR.`,
        "",
    ];
    for (const fund of funds) {
        lines.push(`## ${fund.name}`, "");
        if (fund.location) lines.push(`- Office: ${fund.location}`);
        lines.push(`- Filed: ${fund.filedAt}${fund.amendment ? " (amendment)" : ""}`);
        const raise = describeRaise(fund);
        if (raise) lines.push(`- ${raise}`);
        for (const m of fund.managers) {
            const role = m.title ?? m.roles.join(", ");
            lines.push(
                `- ${m.kind === "entity" ? "Managed by" : "Person"}: ${m.name}${role ? ` — ${role}` : ""}`
            );
        }
        if (fund.phone) lines.push(`- Phone: ${fund.phone}`);
        lines.push(`- Filing: ${fund.filingUrl}`, "");
    }
    return lines.join("\n");
}

export interface PitchStarter {
    id: string;
    title: string;
    desc: string;
    prompt: string;
}

/**
 * Pitch work the chat does from the workspace's sources. Each asks for
 * citations and for what is missing, because an investor document with a
 * made-up number in it is worse than one with a gap.
 */
export const PITCH_STARTERS: readonly PitchStarter[] = [
    {
        id: "one-pager",
        title: "Investor one-pager",
        desc: "Problem, solution, market, traction, model, team, the raise",
        prompt: "Write a one-page investor memo for our company from our workspace sources: the problem, our solution, market size, traction, business model, team, competition, and the raise with its use of funds. Cite the documents you draw from. End with a list of anything an investor would expect that our sources don't cover.",
    },
    {
        id: "deck",
        title: "Pitch deck outline",
        desc: "Ten to twelve slides, each with its headline and proof",
        prompt: "Outline a 10–12 slide seed pitch deck for our company from our workspace sources. For each slide give the headline (a claim, not a label), three talking points, and the source that backs it. Mark any slide our sources can't support yet.",
    },
    {
        id: "hard-questions",
        title: "Hard questions",
        desc: "What a sceptical partner will ask, and our best answers",
        prompt: "List the ten hardest questions a sceptical venture partner would ask about our company. Answer each from our workspace sources, cite them, and say plainly where our answer is weak or unsupported.",
    },
    {
        id: "metrics",
        title: "Traction summary",
        desc: "The numbers that matter, with where each comes from",
        prompt: "Pull together our traction for an investor: revenue, growth, customers, retention, pipeline and any other metric our workspace sources state. Give each number with its date and cite the document it comes from. Don't estimate a number that isn't written down — list it as missing.",
    },
    {
        id: "update",
        title: "Investor update",
        desc: "A monthly update for the investors you already have",
        prompt: "Draft this month's investor update from our workspace sources: highlights, lowlights, key metrics, what we shipped, hiring, and two or three specific asks. Plain and short; cite sources for every number.",
    },
    {
        id: "data-room",
        title: "Data-room checklist",
        desc: "What diligence will ask for, and what we already have",
        prompt: "Make a seed / Series A data-room checklist: corporate, cap table, financials, contracts, IP, team, product and customers. For each item, say whether our workspace sources already contain it (name the document) or it is missing.",
    },
];

/** The summary line under the search. */
export function resultSummary(result: InvestorSearchResult, shown: number): string {
    const parts = [`${shown} ${shown === 1 ? "fund" : "funds"}`];
    if (result.totalFilings > shown) {
        parts.push(
            `${result.totalFilings >= 10_000 ? "10,000+" : result.totalFilings.toLocaleString("en-US")} filings in the window`
        );
    }
    if (result.singleDealVehiclesHidden > 0) {
        parts.push(
            `${result.singleDealVehiclesHidden} single-deal ${result.singleDealVehiclesHidden === 1 ? "vehicle" : "vehicles"} hidden`
        );
    }
    return parts.join(" · ");
}
