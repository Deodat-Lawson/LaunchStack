import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { CatalogueProgram } from "./types";
import { CatalogueProgramSchema } from "./types";
import {
    ProgramIntelligenceSchema,
    TaxonomySchema,
    applySourceRefresh,
    available,
    conflicting,
    reviewId,
    unavailable,
    unchecked,
    type DealBlock,
    type DealComponent,
    type Evidence,
    type InformationGroup,
    type InformationSlot,
    type InformationState,
    type PageKind,
    type PortfolioCompany,
    type ProgramIntelligence,
    type ReviewItem,
    type Taxonomy,
} from "./intelligence";

type DealFile = {
    programId: string;
    sourceId: string;
    checkedAt: string;
    interpretation?: boolean;
    summary: string;
    formattedTerms: string;
    parts: {
        kind: string;
        amount: string | null;
        currency: string | null;
        equity: string | null;
        contingent: boolean;
        condition?: string;
    }[];
    notReturns?: string[];
};

type PortfolioFile = {
    programId: string;
    checkedAt: string;
    result?: string;
    relationshipNote?: string;
    completeness?: string;
    source?: { id?: string; url: string; title: string; checkedAt: string };
    companies?: {
        id: string;
        name: string;
        website?: string | null;
        sector?: string | null;
        sectors?: string[];
        cohort?: string | null;
        location?: string | null;
        relationship: string;
        quote?: string;
        investment?: unknown;
        returns?: unknown;
    }[];
};

type GapFile = {
    items: {
        programId: string;
        group: string;
        field?: string;
        state: string;
        sourceIds?: string[];
        detail: string;
    }[];
};

type HistoricalFile = {
    programs: {
        programId: string;
        result?: string;
        company: string;
        cycleLabel?: string | null;
        url: string;
        acceptanceEvidence?: { url: string; quote: string; checkedAt: string };
        completeness: string;
        answersCopied?: boolean;
    }[];
};

type DiscoveryFile = {
    checkedAt?: string;
    pages?: ProgramIntelligence["discovery"]["pages"];
};

/** One thing scrape.py read on a page, with the excerpt that shows it. */
export type Finding<T> = { value: T; evidenceId: string };

/** Written by services/accelerator-scraper: what the official pages stated, with excerpts. */
type ChecksFile = {
    programId: string;
    checkedAt: string;
    pagesRead: string[];
    evidence: { id: string; url: string; title: string; excerpt: string; page: PageKind }[];
    findings: {
        emails: Finding<string>[];
        phones: Finding<string>[];
        routes: Finding<string>[];
        applicationUrl: Finding<string>[];
        applicationsOpen: Finding<boolean>[];
        operatingStatus: Finding<"closed" | "paused">[];
        deadlines: Finding<string>[];
        selectivity: Finding<{ rate: number | null; bounded: boolean }>[];
        dealText: Finding<string>[];
        dealComponents?: Finding<{
            kind: DealComponent["kind"];
            amount: string | null;
            currency: string | null;
            equity: string | null;
            label: string;
            contingent: boolean;
            condition: string | null;
        }>[];
        portfolioPages: Finding<string>[];
        name?: Finding<string>[];
        examplePages?: Finding<string>[];
        rolling?: Finding<boolean>[];
        announcedIntake?: Finding<string>[];
        cohortStarts?: Finding<string>[];
        durationWeeks?: Finding<string>[];
        format?: Finding<string>[];
        location?: Finding<string>[];
    };
    pageQuotes?: { id: string; url: string; page: PageKind; excerpt: string }[];
};

const RELATIONSHIPS: Record<string, PortfolioCompany["relationship"]> = {
    participation: "participation",
    investment: "investment",
    "portfolio-listing": "portfolio_listing",
    portfolio_listing: "portfolio_listing",
    "listed-on-companies-page": "companies_page_listing",
    companies_page_listing: "companies_page_listing",
};

const COMPONENT_KINDS: Record<string, DealComponent["kind"]> = {
    cash: "cash",
    equity: "equity",
    safe: "safe",
    "post-money-safe": "safe",
    grant: "grant",
    "equity-free-grant": "grant",
    credits: "credits",
    "partner-credits": "credits",
    fee: "fee",
    benefit: "benefit",
    "follow-on": "follow_on",
    follow_on: "follow_on",
    investment: "unspecified_investment",
    unspecified_investment: "unspecified_investment",
};

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function readOptionalDir(path: string): string[] {
    try {
        return readdirSync(path)
            .filter(file => file.endsWith(".json"))
            .sort();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
}

function classify(url: string, title: string): PageKind {
    const hay = `${url} ${title}`.toLowerCase();
    if (/compan(?:y|ies)|portfolio|alumni/.test(hay)) return "portfolio";
    if (/deal|terms|invest|faq/.test(hay)) return "terms";
    if (/cohort|batch|deadline|start-date|dates/.test(hay)) return "batches";
    if (/apply|application|form/.test(hay)) return "application";
    if (/about|program|overview/.test(hay)) return "details";
    return "other";
}

function nonempty(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    if (trimmed.length === 0) return null;
    return trimmed;
}

function collapse(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function includesText(haystack: string, needle: string): boolean {
    return collapse(haystack).toLowerCase().includes(collapse(needle).toLowerCase());
}

function compactAmount(amount: string): string | null {
    const value = Number(amount);
    if (!Number.isFinite(value)) return null;
    if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`;
    if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`;
    return null;
}

function amountInQuote(quote: string, amount: string): boolean {
    const value = Number(amount);
    if (!Number.isFinite(value)) return false;
    const hay = collapse(quote).toLowerCase();
    const compact = compactAmount(amount);
    const forms = [amount, value.toLocaleString("en-US")];
    if (compact) forms.push(compact, compact.toLowerCase());
    return forms.some(form => hay.includes(form.toLowerCase()));
}

function boundedAmount(quote: string, amount: string): boolean {
    const compact = compactAmount(amount);
    if (!compact) return false;
    const pattern = new RegExp(
        `(?:over|up to|more than)(?:\\s+\\w+){0,3}\\s+\\$?${compact}\\b`,
        "i"
    );
    return pattern.test(collapse(quote));
}

function latest(values: string[]): string {
    return values.reduce((best, value) => (value > best ? value : best));
}

function evidenceFromSource(source: CatalogueProgram["sources"][number]): Evidence {
    return {
        id: source.id,
        url: source.url,
        title: source.title,
        excerpt: source.quote,
        checkedAt: source.checkedAt,
        kind: "fact",
        origin: "official",
        page: classify(source.url, source.title),
    };
}

function reviewFor(
    programId: string,
    group: InformationGroup,
    field: string,
    detail: string,
    evidenceIds: string[]
): ReviewItem {
    return {
        id: reviewId(programId, field),
        programId,
        group,
        field,
        state: "conflicting",
        evidenceIds,
        detail,
        status: "open",
    };
}

function noDeadline(text: string): boolean {
    return /no application deadline|no deadline was|not deadlines|deadline stays null|deadlineat stays null|do not (?:store|publish) a deadline|without stating that .{0,80} is the final close/i.test(
        text
    );
}

export function loadPublishedCatalogue(root: string): {
    dossiers: ProgramIntelligence[];
    taxonomy: Taxonomy;
} {
    const programDir = join(root, "programs");
    const programs = new Map<string, CatalogueProgram>();
    for (const name of readdirSync(programDir)
        .filter(file => file.endsWith(".json"))
        .sort()) {
        const parsed = CatalogueProgramSchema.safeParse(readJson(join(programDir, name)));
        if (!parsed.success) {
            throw new Error(`${name}: ${parsed.error.message}`);
        }
        programs.set(parsed.data.id, parsed.data);
    }
    const deals = new Map<string, DealFile>();
    for (const name of readdirSync(join(root, "deals")).filter(file => file.endsWith(".json"))) {
        const deal = readJson(join(root, "deals", name)) as DealFile;
        deals.set(deal.programId, deal);
    }
    const portfolios = new Map<string, PortfolioFile>();
    for (const name of readdirSync(join(root, "portfolio")).filter(file =>
        file.endsWith(".json")
    )) {
        const portfolio = readJson(join(root, "portfolio", name)) as PortfolioFile;
        portfolios.set(portfolio.programId, portfolio);
    }
    const checks = new Map<string, ChecksFile>();
    for (const name of readOptionalDir(join(root, "checks"))) {
        const file = readJson(join(root, "checks", name)) as ChecksFile;
        checks.set(file.programId, file);
    }
    const taxonomy = TaxonomySchema.parse(readJson(join(root, "taxonomy.json")));
    const historical = readJson(
        join(root, "examples", "historical-applications.json")
    ) as HistoricalFile;
    const gaps = readJson(join(root, "gaps.json")) as GapFile;
    // A tag must be stated in the text it cites: a curated source's quote, or an excerpt the
    // scraper read on a checked page (both become evidence on the dossier).
    const citedText = (programId: string, sourceId: string): string | null => {
        const quote = programs.get(programId)?.sources.find(item => item.id === sourceId)?.quote;
        if (quote) return quote;
        const file = checks.get(programId);
        return (
            file?.pageQuotes?.find(item => item.id === sourceId)?.excerpt ??
            file?.evidence.find(item => item.id === sourceId)?.excerpt ??
            null
        );
    };
    for (const tag of taxonomy.tags) {
        for (const support of tag.evidence) {
            const text = citedText(support.programId, support.sourceId);
            const needles = [tag.label, ...tag.aliases];
            if (!text || !needles.some(needle => includesText(text, needle))) {
                throw new Error(
                    `Tag ${tag.id} is not supported by ${support.programId}/${support.sourceId}`
                );
            }
        }
    }
    const dossiers = applyStoredRefresh(
        root,
        [...programs.values()]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(program =>
                assembleProgram(root, program, {
                    deal: deals.get(program.id) ?? null,
                    portfolio: portfolios.get(program.id) ?? null,
                    taxonomy,
                    historical: historical.programs.filter(item => item.programId === program.id),
                    gaps: gaps.items.filter(item => item.programId === program.id),
                    checks: checks.get(program.id) ?? null,
                })
            )
    );
    return { dossiers, taxonomy };
}

function applyStoredRefresh(root: string, dossiers: ProgramIntelligence[]): ProgramIntelligence[] {
    let items: {
        programId: string;
        evidenceId: string;
        outcome: "current" | "stale" | "inaccessible";
        checkedAt: string;
        detail: string;
    }[] = [];
    try {
        const parsed = readJson(join(root, "intelligence", "refresh-observations.json")) as {
            items?: typeof items;
        };
        items = parsed.items ?? [];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return dossiers;
        throw error;
    }
    return dossiers.map(dossier => {
        let next = dossier;
        for (const item of items) {
            if (item.programId !== dossier.programId) continue;
            if (!next.evidence.some(evidence => evidence.id === item.evidenceId)) continue;
            next = applySourceRefresh(next, item);
        }
        return next;
    });
}

function assembleProgram(
    root: string,
    program: CatalogueProgram,
    input: {
        deal: DealFile | null;
        portfolio: PortfolioFile | null;
        taxonomy: Taxonomy;
        historical: HistoricalFile["programs"];
        gaps: GapFile["items"];
        checks: ChecksFile | null;
    }
): ProgramIntelligence {
    const evidence = program.sources.map(evidenceFromSource);
    const byId = new Map(evidence.map(item => [item.id, item]));
    const review: ReviewItem[] = [];
    const checks = input.checks;
    const recorded = [...evidence];
    for (const item of checks?.evidence ?? []) {
        if (byId.has(item.id)) continue;
        const cited: Evidence = {
            id: item.id,
            url: item.url,
            title: item.title,
            excerpt: item.excerpt,
            checkedAt: checks!.checkedAt,
            kind: "fact",
            origin: "official",
            page: item.page,
        };
        evidence.push(cited);
        byId.set(cited.id, cited);
    }
    for (const item of checks?.pageQuotes ?? []) {
        if (byId.has(item.id) || !item.excerpt.trim()) continue;
        const cited: Evidence = {
            id: item.id,
            url: item.url,
            title: `${program.name} — ${item.page === "details" ? "program" : item.page} page`,
            excerpt: item.excerpt,
            checkedAt: checks!.checkedAt,
            kind: "fact",
            origin: "official",
            page: item.page,
        };
        evidence.push(cited);
        byId.set(cited.id, cited);
    }
    const tags = input.taxonomy.tags.filter(tag =>
        tag.evidence.some(item => item.programId === program.id)
    );
    const tagEvidence = (facet: Taxonomy["tags"][number]["facet"]) => {
        const matches = tags.filter(tag => tag.facet === facet);
        return {
            labels: matches.map(tag => tag.label),
            evidenceIds: [
                ...new Set(
                    matches.flatMap(tag =>
                        tag.evidence
                            .filter(item => item.programId === program.id)
                            .map(item => item.sourceId)
                    )
                ),
            ],
        };
    };
    const listFromTags = (facet: Taxonomy["tags"][number]["facet"]) => {
        const found = tagEvidence(facet);
        return found.labels.length
            ? available(found.labels, found.evidenceIds, "fact" as const)
            : unchecked<string[]>();
    };

    const nameEvidence = evidence.filter(item => includesText(item.excerpt, program.name));
    const official = evidence.find(
        item => item.url === program.websiteUrl || includesText(item.excerpt, program.websiteUrl)
    );
    const applySource = evidence.find(
        item => item.url === program.applyUrl || includesText(item.excerpt, program.applyUrl)
    );

    const emails = [
        ...new Set(
            recorded.flatMap(
                item => item.excerpt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
            )
        ),
    ];
    const phones = [
        ...new Set(recorded.flatMap(item => item.excerpt.match(/\+\d[\d\s().-]{7,}\d/g) ?? [])),
    ];
    const openSources = recorded.filter(item =>
        /applications?(?:\s+\w+){0,8}\s+(?:are|is)\s+open|\bopen now\b/i.test(item.excerpt)
    );

    let email: InformationSlot<string> = unchecked();
    if (emails.length === 1) {
        const source = recorded.find(item => item.excerpt.includes(emails[0]!));
        email = available(emails[0]!, source ? [source.id] : [], "fact");
    } else if (emails.length > 1) {
        email = conflicting(
            "More than one public address is in the checked excerpts. None was selected.",
            recorded
                .filter(item => emails.some(address => item.excerpt.includes(address)))
                .map(item => item.id)
        );
        review.push(reviewFor(program.id, "contact", "email", email.detail!, email.evidenceIds));
    }
    let phone: InformationSlot<string> = unchecked();
    if (phones.length === 1) {
        const source = recorded.find(item => item.excerpt.includes(phones[0]!));
        phone = available(phones[0]!, source ? [source.id] : [], "fact");
    } else if (phones.length > 1) {
        phone = conflicting(
            "More than one public phone number is in the checked excerpts. None was selected.",
            recorded
                .filter(item => phones.some(value => item.excerpt.includes(value)))
                .map(item => item.id)
        );
        review.push(reviewFor(program.id, "contact", "phone", phone.detail!, phone.evidenceIds));
    }

    const cycles = program.cycles.map(cycle => {
        const limitation = cycle.form?.limitations.join("\n") ?? "";
        const cited = cycle.sourceIds.filter(id => byId.has(id));
        if (cycle.deadlineAt) {
            return {
                id: cycle.id,
                label: cycle.label,
                announcedDeadline: available(
                    {
                        at: cycle.deadlineAt,
                        dateOnly: null,
                        timezone: cycle.deadlineTimezone,
                        rolling: cycle.rolling,
                    },
                    cited,
                    "fact" as const
                ),
            };
        }
        if (cycle.dateOnly) {
            return {
                id: cycle.id,
                label: cycle.label,
                announcedDeadline: available(
                    {
                        at: null,
                        dateOnly: cycle.dateOnly,
                        timezone: null,
                        rolling: cycle.rolling,
                    },
                    cited,
                    "fact" as const,
                    "The source publishes a calendar date and no clock."
                ),
            };
        }
        if (cycle.rolling) {
            return {
                id: cycle.id,
                label: cycle.label,
                announcedDeadline: available(
                    { at: null, dateOnly: null, timezone: null, rolling: true },
                    cited,
                    "fact" as const,
                    "Rolling intake. No single deadline is published."
                ),
            };
        }
        const citedText = cited.map(id => byId.get(id)?.excerpt ?? "").join("\n");
        if (noDeadline(`${limitation}\n${citedText}`)) {
            return {
                id: cycle.id,
                label: cycle.label,
                announcedDeadline: unavailable<
                    ProgramIntelligence["batches"]["cycles"][number]["announcedDeadline"]["value"]
                >("The checked sources do not publish a deadline for this cycle.", cited),
            };
        }
        return {
            id: cycle.id,
            label: cycle.label,
            announcedDeadline:
                unchecked<
                    ProgramIntelligence["batches"]["cycles"][number]["announcedDeadline"]["value"]
                >(),
        };
    });

    const exact = cycles.filter(cycle => cycle.announcedDeadline.value?.at);
    let nextDeadline: InformationSlot<string> = unchecked();
    if (exact.length === 1) {
        nextDeadline = available(
            exact[0]!.announcedDeadline.value!.at!,
            exact[0]!.announcedDeadline.evidenceIds,
            "fact",
            `Announced deadline for ${exact[0]!.id}. Other cycles without a deadline were not given this date.`
        );
    } else if (exact.length > 1) {
        const ids = [...new Set(exact.flatMap(cycle => cycle.announcedDeadline.evidenceIds))];
        nextDeadline = conflicting(
            "More than one cycle publishes an exact deadline. Neither was promoted to the next deadline.",
            ids
        );
        review.push(reviewFor(program.id, "batches", "nextDeadline", nextDeadline.detail!, ids));
    } else if (cycles.length === 1) {
        const only = cycles[0];
        const dateOnly = only?.announcedDeadline.value?.dateOnly;
        if (!only || !dateOnly) {
            /* A missing date stays not checked or unavailable on the cycle. */
        } else
            nextDeadline = available(
                dateOnly,
                only.announcedDeadline.evidenceIds,
                "fact",
                "Date only. No clock or timezone was published, so this is not an instant."
            );
    }

    const notDeadlines = evidence.find(item => /not deadlines/i.test(item.excerpt));
    let announcedStarts: InformationSlot<string> = unchecked();
    if (notDeadlines) {
        announcedStarts = available(notDeadlines.excerpt, [notDeadlines.id], "fact");
        nextDeadline = unavailable(
            "The checked page says the published dates are start dates, not deadlines.",
            [notDeadlines.id]
        );
    }

    let historicalCadence: InformationSlot<string> = unchecked();
    const cadence = evidence.find(item => /every six months|twice a year/i.test(item.excerpt));
    if (cadence) {
        const match = /every six months|twice a year/i.exec(cadence.excerpt);
        historicalCadence = available(
            match?.[0] ?? "published cadence",
            [cadence.id],
            "fact",
            "Historical pattern. It is not the next deadline."
        );
    }

    let dealState: InformationState = "not_checked";
    let dealDetail: string | null = "Not checked";
    let summary = unchecked<string>();
    let formatted = unchecked<string>();
    let blocks: DealBlock[] = [];
    let components: DealComponent[] = [];
    if (input.deal) {
        const source = byId.get(input.deal.sourceId);
        if (!source)
            throw new Error(`Deal ${program.id} cites missing source ${input.deal.sourceId}`);
        const built = dealComponents(program.id, input.deal, source.excerpt);
        dealState = "available";
        dealDetail = null;
        summary = available(
            input.deal.summary,
            [source.id],
            input.deal.interpretation === false ? "fact" : "interpretation"
        );
        const paragraphs = input.deal.formattedTerms
            .split(/\n\n+/)
            .map(part => part.trim())
            .filter(Boolean);
        const verbatim = paragraphs.every(part => includesText(source.excerpt, part));
        formatted = available(
            input.deal.formattedTerms,
            [source.id],
            verbatim ? "fact" : "interpretation",
            verbatim ? null : "Formatted from the cited page rather than one contiguous excerpt."
        );
        blocks = paragraphs.map(text => ({ type: "paragraph" as const, text, href: null }));
        for (const note of input.deal.notReturns ?? []) {
            if (!includesText(source.excerpt, note)) {
                throw new Error(`Deal ${program.id} caveat is not in the source excerpt`);
            }
            blocks.push({
                type: "caveat",
                text: `${note} is not an investment return.`,
                href: null,
            });
        }
        components = built;
    }

    let portfolioState: InformationState = "not_checked";
    let portfolioDetail: string | null = "Not checked";
    let companies: PortfolioCompany[] = [];
    let returns: InformationSlot<PortfolioCompany["returns"] & object> = unchecked();
    if (input.portfolio) {
        const source = input.portfolio.source;
        if (!source) throw new Error(`Portfolio ${program.id} has no source`);
        const sourceId =
            source.id && byId.has(source.id) ? source.id : `${program.id}-portfolio`.slice(0, 64);
        if (!byId.has(sourceId)) {
            const cardExcerpt = input.portfolio.companies
                ?.find(company => company.quote?.trim())
                ?.quote?.trim();
            const note = input.portfolio.relationshipNote?.trim();
            const item: Evidence = {
                id: sourceId,
                url: source.url,
                title: source.title,
                excerpt: nonempty(cardExcerpt) ?? nonempty(note) ?? source.title,
                checkedAt: source.checkedAt,
                kind: cardExcerpt ? "fact" : "interpretation",
                origin: "official",
                page: "portfolio",
            };
            evidence.push(item);
            byId.set(sourceId, item);
        }
        if (input.portfolio.result === "unavailable") {
            portfolioState = "unavailable";
            portfolioDetail =
                input.portfolio.relationshipNote ??
                "The checked portfolio page did not list company identities.";
            returns = unavailable(portfolioDetail, [sourceId]);
        } else {
            companies = (input.portfolio.companies ?? []).map(company => {
                const relationship = RELATIONSHIPS[company.relationship];
                if (!relationship) {
                    throw new Error(
                        `Portfolio ${program.id}/${company.id} has an unknown relationship`
                    );
                }
                if (company.investment != null || company.returns != null) {
                    throw new Error(
                        `Portfolio ${program.id}/${company.id} has a return or investment that is not a sourced claim`
                    );
                }
                const excerpt = company.quote?.trim();
                if (!excerpt)
                    throw new Error(`Portfolio ${program.id}/${company.id} has no excerpt`);
                const sectors = [
                    ...(company.sectors ?? []),
                    ...(company.sector ? [company.sector] : []),
                ].filter(Boolean);
                return {
                    id: company.id,
                    name: company.name,
                    website: nonempty(company.website),
                    sectors,
                    cohort: nonempty(company.cohort),
                    location: nonempty(company.location),
                    relationship,
                    rounds: [],
                    exits: [],
                    returns: null,
                    excerpt,
                    evidenceIds: [sourceId],
                };
            });
            portfolioState = "available";
            portfolioDetail = input.portfolio.completeness ?? null;
            returns = unavailable(
                "Checked portfolio cards do not state an investment return. Funding raised or valuation is not a return.",
                [sourceId]
            );
        }
    }

    let historicalState: InformationState = "not_checked";
    let historicalDetail: string | null = "Not checked";
    const examples: ProgramIntelligence["historicalExamples"]["examples"] = [];
    for (const item of input.historical) {
        if (!item.acceptanceEvidence) {
            throw new Error(`Historical example ${program.id} has no separate acceptance evidence`);
        }
        const acceptanceId = `${program.id}-acceptance`.slice(0, 64);
        if (!byId.has(acceptanceId)) {
            evidence.push({
                id: acceptanceId,
                url: item.acceptanceEvidence.url,
                title: `${item.company} acceptance evidence`,
                excerpt: item.acceptanceEvidence.quote,
                checkedAt: item.acceptanceEvidence.checkedAt,
                kind: "fact",
                origin: "official",
                page: "application",
            });
            byId.set(acceptanceId, evidence[evidence.length - 1]!);
        }
        examples.push({
            id: `${item.company}-${item.cycleLabel ?? "example"}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 64),
            company: item.company,
            cycleLabel: item.cycleLabel ?? null,
            sourceUrl: item.url,
            textAvailability: item.url ? "published" : "unavailable",
            answersCopied: item.answersCopied === true,
            acceptance: {
                state: "verified",
                detail: item.acceptanceEvidence.quote,
                evidenceIds: [acceptanceId],
            },
            completeness: item.completeness,
            redactions: "The application text was not copied into the catalogue.",
            kind: "original_application",
        });
        historicalState = "available";
        historicalDetail = null;
    }

    const dossier: ProgramIntelligence = {
        schemaVersion: 1,
        programId: program.id,
        checkedAt: latest(evidence.map(item => item.checkedAt)),
        evidence,
        discovery: readDiscovery(root, program.id),
        identity: {
            name: nameEvidence.length
                ? available(program.name, [nameEvidence[0]!.id], "fact")
                : unchecked(),
            operator: unchecked(),
            officialUrl: official
                ? available(program.websiteUrl, [official.id], "fact")
                : unchecked(),
            location: program.location
                ? available(
                      program.location.text,
                      program.location.sourceIds,
                      program.location.interpretation ? "interpretation" : "fact"
                  )
                : unchecked(),
            locationCount: unchecked(),
            operatingStatus: unchecked(),
            applicationsOpen: openSources.length
                ? available(
                      true,
                      openSources.map(item => item.id),
                      "fact"
                  )
                : unchecked(),
        },
        audience: {
            narrative: narrativeSlot(program),
            stages: listFromTags("stage"),
            sectors: listFromTags("sector"),
            technologies: listFromTags("technology"),
            businessModels: listFromTags("business_model"),
            customerTypes: listFromTags("customer_type"),
            geography: listFromTags("geography"),
            benefits: listFromTags("benefit"),
            instruments: listFromTags("instrument"),
            constraints: unchecked(),
        },
        contact: {
            email,
            phone,
            applicationUrl: applySource
                ? available(program.applyUrl, [applySource.id], "fact")
                : unchecked(),
            routes: unchecked(),
        },
        batches: {
            cycles,
            historicalCadence,
            announcedStarts,
            nextDeadline,
            residencyEnd: unchecked(),
            format: unchecked(),
            durationWeeks: unchecked(),
        },
        selectivity: unchecked(),
        deal: {
            state: dealState,
            detail: dealDetail,
            summary,
            formatted,
            blocks,
            components,
            comparableDilution: singleFixedDilution(components),
        },
        portfolio: {
            state: portfolioState,
            detail: portfolioDetail,
            companies,
            returns,
        },
        historicalExamples: {
            state: historicalState,
            detail: historicalDetail,
            examples,
        },
        tagIds: tags.map(tag => tag.id),
        tags: tags.map(tag => ({
            id: tag.id,
            facet: tag.facet,
            label: tag.label,
            evidenceIds: [
                ...new Set(
                    tag.evidence
                        .filter(item => item.programId === program.id)
                        .map(item => item.sourceId)
                ),
            ],
        })),
        review,
    };

    if (checks) applyChecks(dossier, program, checks);
    for (const gap of input.gaps) applyGap(dossier, gap);
    return ProgramIntelligenceSchema.parse(dossier);
}

const NARRATIVE_GAP =
    /not published on the official page|generated by fixtures\/accelerators\/scrape\.py|you are using an unsupported browser|does not add a deadline/i;

function narrativeSlot(program: CatalogueProgram): InformationSlot<string> {
    const target = program.targetApplicants;
    const description = program.description;
    if (!NARRATIVE_GAP.test(target.text)) {
        return available(
            target.text,
            target.sourceIds,
            target.interpretation ? "interpretation" : "fact"
        );
    }
    if (!NARRATIVE_GAP.test(description.text)) {
        return available(
            description.text,
            description.sourceIds,
            description.interpretation ? "interpretation" : "fact"
        );
    }
    return unavailable("Not published on the official page.");
}

function distinct<T>(findings: Finding<T>[]): { values: T[]; evidenceIds: string[] } {
    const values: T[] = [];
    for (const finding of findings) {
        if (!values.some(value => JSON.stringify(value) === JSON.stringify(finding.value))) {
            values.push(finding.value);
        }
    }
    return { values, evidenceIds: [...new Set(findings.map(finding => finding.evidenceId))] };
}

const TRACKING_PARAM = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;

/**
 * Application routes once each: tracking parameters and fragments are dropped, and
 * the same page reached over http/https, with or without "www." or a trailing slash
 * is one route (the https form is kept). Addresses and other text pass through.
 */
export function applicationRoutes(findings: Finding<string>[]): {
    values: string[];
    evidenceIds: string[];
} {
    const byKey = new Map<string, string>();
    for (const { value } of findings) {
        const url = URL.canParse(value) ? new URL(value) : null;
        if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
            // An application address (mailto:, plain email) or text, kept as written.
            if (!byKey.has(value.toLowerCase())) byKey.set(value.toLowerCase(), value);
            continue;
        }
        for (const name of [...url.searchParams.keys()]) {
            if (TRACKING_PARAM.test(name)) url.searchParams.delete(name);
        }
        url.hash = "";
        const clean = url.toString();
        const key =
            `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
        const seen = byKey.get(key);
        if (!seen || (seen.startsWith("http:") && clean.startsWith("https:")))
            byKey.set(key, clean);
    }
    return {
        values: [...byKey.values()],
        evidenceIds: [...new Set(findings.map(finding => finding.evidenceId))],
    };
}

/** Overlap, in characters, that shows two quote windows are neighbouring cuts of one passage. */
const MIN_WINDOW_OVERLAP = 20;

/** How far `left`'s end runs into `right`'s start, or 0 when they do not overlap. */
function windowOverlap(left: string, right: string): number {
    for (let size = Math.min(left.length, right.length); size >= MIN_WINDOW_OVERLAP; size--) {
        if (left.endsWith(right.slice(0, size))) return size;
    }
    return 0;
}

/**
 * Make a quote window read as a passage. A leading fragment and a trailing one are cut at
 * a sentence boundary; wording without one (feature lists, headings run together) is kept
 * and its cut edge marked with "…", so no stated term is lost and no cut is hidden.
 */
function readablePassage(passage: string): string {
    let text = passage.trim();
    if (/^[a-z,;)]/.test(text)) {
        const start = text.search(/[.!?]\s+[A-Z$€£\d]/);
        text = start >= 0 ? text.slice(start + 1).trimStart() : `…${text}`;
    }
    if (/[.!?]["')]?$/.test(text)) return text;
    const end = Math.max(text.lastIndexOf(". "), text.lastIndexOf("! "), text.lastIndexOf("? "));
    return end > 0 ? text.slice(0, end + 1) : `${text.replace(/[,;:]$/, "")}…`;
}

/**
 * The scraper quotes deal wording as fixed-length windows that overlap and cut mid-word.
 * Neighbouring windows are joined back into the passage they came from, windows already
 * inside another are dropped, and each passage is made readable. Joining only on a shared
 * overlap keeps every passage verbatim from the page, apart from the "…" marks.
 */
export function dealPassages(findings: Finding<string>[]): {
    values: string[];
    evidenceIds: string[];
} {
    const passages = distinct(findings).values.map(value => value.replace(/\s+/g, " ").trim());
    let merged = true;
    while (merged) {
        merged = false;
        outer: for (let i = 0; i < passages.length; i++) {
            for (let j = 0; j < passages.length; j++) {
                if (i === j) continue;
                const left = passages[i]!;
                const right = passages[j]!;
                const overlap = right.includes(left) ? -1 : windowOverlap(left, right);
                if (overlap === 0) continue;
                passages[j] = overlap === -1 ? right : left + right.slice(overlap);
                passages.splice(i, 1);
                merged = true;
                break outer;
            }
        }
    }
    return {
        values: [...new Set(passages.map(readablePassage))],
        evidenceIds: [...new Set(findings.map(finding => finding.evidenceId))],
    };
}

/**
 * Fill groups that the stored sources left not checked from scrape.py's reading of the
 * official pages. A group that was read and states nothing becomes unavailable, never a
 * negative finding. Curated sources and operator gaps keep precedence.
 */
function applyChecks(
    dossier: ProgramIntelligence,
    program: CatalogueProgram,
    checks: ChecksFile
): void {
    const { findings } = checks;
    const read = `${checks.pagesRead.length} official page${checks.pagesRead.length === 1 ? "" : "s"} read`;
    const pageIds = [
        ...new Set(
            (checks.pageQuotes ?? [])
                .map(item => item.id)
                .filter(id => dossier.evidence.some(item => item.id === id))
        ),
    ];
    const notPublished = `Not published on ${checks.pagesRead.length} checked pages`;
    const open = (slot: { state: InformationState }) => slot.state === "not_checked";
    const conflict = <T>(
        group: InformationGroup,
        field: string,
        detail: string,
        evidenceIds: string[]
    ): InformationSlot<T> => {
        const item = reviewFor(dossier.programId, group, field, detail, evidenceIds);
        if (!dossier.review.some(existing => existing.id === item.id)) dossier.review.push(item);
        return conflicting<T>(detail, evidenceIds);
    };

    if (open(dossier.identity.name)) {
        const named = distinct(findings.name ?? []);
        dossier.identity.name = named.values.length
            ? available(program.name, named.evidenceIds, "fact")
            : unavailable(
                  "The homepage text does not spell out the Program name; it may appear only in a logo."
              );
    }
    if (dossier.historicalExamples.state === "not_checked") {
        const examples = distinct(findings.examplePages ?? []);
        dossier.historicalExamples.state = examples.values.length ? "partial" : "unavailable";
        dossier.historicalExamples.detail = examples.values.length
            ? `The official site links application examples (${examples.values[0]}). They were not reviewed for acceptance evidence.`
            : `The checked pages do not link a published application example (${read}). Examples published elsewhere were not searched.`;
    }
    if (open(dossier.contact.email)) {
        const emails = distinct(findings.emails);
        dossier.contact.email = emails.values.length
            ? available(
                  emails.values.join(", "),
                  emails.evidenceIds,
                  "fact",
                  emails.values.length > 1 ? "Several public addresses are listed." : null
              )
            : unavailable(`No public program address on the checked pages (${read}).`);
    }
    if (open(dossier.contact.phone)) {
        const phones = distinct(findings.phones);
        dossier.contact.phone = phones.values.length
            ? available(phones.values.join(", "), phones.evidenceIds, "fact")
            : unavailable(`No public phone link on the checked pages (${read}).`);
    }
    if (open(dossier.contact.routes)) {
        const routes = applicationRoutes(findings.routes);
        dossier.contact.routes = routes.values.length
            ? available(routes.values, routes.evidenceIds, "fact")
            : unavailable(
                  `No application link or application address on the checked pages (${read}).`
              );
    }
    if (open(dossier.contact.applicationUrl)) {
        const linked = distinct(findings.applicationUrl);
        const routes = applicationRoutes(findings.routes);
        const found = linked.values[0] ?? routes.values.find(value => /^https?:\/\//i.test(value));
        dossier.contact.applicationUrl = found
            ? available(
                  found,
                  linked.evidenceIds.length ? linked.evidenceIds : routes.evidenceIds,
                  "fact"
              )
            : unavailable(notPublished, pageIds);
    }
    if (open(dossier.identity.applicationsOpen)) {
        const stated = distinct(findings.applicationsOpen);
        dossier.identity.applicationsOpen =
            stated.values.length === 1
                ? available(stated.values[0]!, stated.evidenceIds, "fact")
                : stated.values.length > 1
                  ? conflict(
                        "identity",
                        "applicationsOpen",
                        "The checked pages say both that applications are open and that they are closed.",
                        stated.evidenceIds
                    )
                  : unavailable(
                        `The checked pages do not say whether applications are open (${read}).`
                    );
    }
    if (open(dossier.identity.operatingStatus)) {
        const stated = distinct(findings.operatingStatus);
        dossier.identity.operatingStatus =
            stated.values.length === 1
                ? available(stated.values[0]!, stated.evidenceIds, "fact")
                : stated.values.length > 1
                  ? conflict(
                        "identity",
                        "operatingStatus",
                        "The checked pages describe the Program as both closed and paused.",
                        stated.evidenceIds
                    )
                  : unavailable(
                        `The checked pages do not state an operating status (${read}). A reachable website is not proof that the Program runs.`
                    );
    }
    const deadlines = distinct(findings.deadlines);
    if (open(dossier.batches.nextDeadline)) {
        dossier.batches.nextDeadline =
            deadlines.values.length === 1
                ? available(
                      deadlines.values[0]!,
                      deadlines.evidenceIds,
                      "fact",
                      "Date only, published beside deadline wording on the official page. It is not tied to a Cycle and has no clock."
                  )
                : deadlines.values.length > 1
                  ? partialSlot(
                        `Several future dates appear beside deadline wording (${deadlines.values.join(", ")}). None was promoted to the next deadline.`,
                        deadlines.evidenceIds
                    )
                  : unavailable(notPublished, pageIds);
    }
    if (deadlines.values.length === 1) {
        for (const cycle of dossier.batches.cycles) {
            if (!open(cycle.announcedDeadline)) continue;
            cycle.announcedDeadline = available(
                { at: null, dateOnly: deadlines.values[0]!, timezone: null, rolling: false },
                deadlines.evidenceIds,
                "fact",
                "Date only, published beside deadline wording. No clock was published."
            );
        }
    }
    const rolling = distinct(findings.rolling ?? []);
    if (deadlines.values.length === 0 && rolling.values.includes(true)) {
        for (const cycle of dossier.batches.cycles) {
            if (!open(cycle.announcedDeadline)) continue;
            cycle.announcedDeadline = available(
                { at: null, dateOnly: null, timezone: null, rolling: true },
                rolling.evidenceIds,
                "fact",
                "Rolling intake. No single deadline is published."
            );
        }
    }
    if (deadlines.values.length === 0 && !rolling.values.includes(true)) {
        for (const cycle of dossier.batches.cycles) {
            if (open(cycle.announcedDeadline)) {
                cycle.announcedDeadline = unavailable(notPublished, pageIds);
            }
        }
    }
    if (open(dossier.batches.announcedStarts)) {
        const announced = distinct([
            ...(findings.announcedIntake ?? []),
            ...(findings.cohortStarts ?? []),
        ]);
        dossier.batches.announcedStarts = announced.values.length
            ? available(
                  announced.values.join("; "),
                  announced.evidenceIds,
                  "fact",
                  "Month or season as published. No year was added."
              )
            : unavailable(notPublished, pageIds);
    }
    if (open(dossier.batches.format)) {
        const formats = distinct(findings.format ?? []);
        dossier.batches.format =
            formats.values.length === 1
                ? available(formats.values[0]!, formats.evidenceIds, "fact")
                : formats.values.length > 1
                  ? partialSlot(
                        `The checked pages name more than one format (${formats.values.join(", ")}).`,
                        formats.evidenceIds
                    )
                  : unavailable(notPublished, pageIds);
    }
    if (open(dossier.batches.durationWeeks)) {
        const durations = distinct(findings.durationWeeks ?? []);
        dossier.batches.durationWeeks = durations.values.length
            ? available(
                  durations.values.join("; "),
                  durations.evidenceIds,
                  "fact",
                  "Published length. Week counts are digits. Month counts are quoted and not converted."
              )
            : unavailable(notPublished, pageIds);
    }
    if (open(dossier.selectivity)) {
        const exact = distinct(findings.selectivity.filter(item => !item.value.bounded));
        const all = distinct(findings.selectivity);
        dossier.selectivity =
            exact.values.length === 1 && all.values.length === 1
                ? available(
                      {
                          rate: exact.values[0]!.rate,
                          applicants: null,
                          admits: null,
                          population: null,
                          method: "Percentage reported on the official page. No applicant or admit counts were published with it.",
                      },
                      exact.evidenceIds,
                      "fact"
                  )
                : all.values.length
                  ? partialSlot(
                        "The official page reports an approximate or more than one acceptance rate. No number was stored.",
                        all.evidenceIds
                    )
                  : unavailable(notPublished, pageIds);
    }
    if (dossier.deal.state === "not_checked") {
        const components = findings.dealComponents ?? [];
        const wording = dealPassages(findings.dealText);
        if (components.length) {
            const built: DealComponent[] = components.map((finding, index) => ({
                id: `c${program.id.replace(/[^a-z0-9]/g, "").slice(0, 20)}${index}${finding.value.kind}`.slice(
                    0,
                    64
                ),
                kind: finding.value.kind,
                label: finding.value.label,
                amount: finding.value.amount,
                currency: finding.value.amount ? finding.value.currency : null,
                equity: finding.value.equity,
                contingent: finding.value.contingent,
                condition: finding.value.condition,
                evidenceIds: [finding.evidenceId],
            }));
            dossier.deal.state = "available";
            dossier.deal.detail = null;
            dossier.deal.components = built;
            dossier.deal.comparableDilution = singleFixedDilution(built);
            const text = wording.values.join("\n\n");
            // No whole-sentence passage: the components carry the terms, and repeating
            // their labels ("Cash; Cash") as prose would only be noise.
            dossier.deal.formatted = text
                ? available(text, wording.evidenceIds, "fact")
                : unavailable(
                      "The checked pages state these terms only in passing; see the deal components.",
                      built.flatMap(component => component.evidenceIds)
                  );
            // A one-line summary is written by a curator. Stringing the components together
            // ("Cash 300000 USD; …") would repeat them, so it stays unpublished here.
            dossier.deal.summary = unavailable(
                "No one-line summary is published; the deal components carry the terms.",
                built.flatMap(component => component.evidenceIds)
            );
            dossier.deal.blocks = wording.values.map(block => ({
                type: "paragraph" as const,
                text: block,
                href: null,
            }));
        } else if (wording.values.length) {
            dossier.deal.state = "partial";
            dossier.deal.detail =
                "Investment wording that names an amount is on the checked pages. It was not structured into components, so no dilution or package is implied.";
            dossier.deal.formatted = available(
                wording.values.join("\n\n"),
                wording.evidenceIds,
                "fact",
                "Excerpts from the official pages, not a structured deal."
            );
            dossier.deal.blocks = wording.values.map(text => ({
                type: "paragraph" as const,
                text,
                href: null,
            }));
        } else {
            dossier.deal.state = "unavailable";
            dossier.deal.detail = notPublished;
        }
    }
    if (dossier.portfolio.state === "not_checked") {
        const pages = distinct(findings.portfolioPages);
        if (pages.values.length) {
            dossier.portfolio.detail = `A portfolio page is linked (${pages.values[0]}). Company identities have not been collected from it.`;
        } else {
            dossier.portfolio.state = "unavailable";
            dossier.portfolio.detail = `No portfolio or companies page is linked from the checked pages (${read}).`;
            dossier.portfolio.returns = unavailable(
                "No portfolio is published, so no investment return is reported."
            );
        }
    }
    if (open(dossier.identity.location)) {
        const places = distinct(findings.location ?? []);
        dossier.identity.location =
            places.values.length === 1
                ? available(places.values[0]!, places.evidenceIds, "fact")
                : places.values.length > 1
                  ? partialSlot(
                        `The checked pages name more than one location (${places.values.join(", ")}).`,
                        places.evidenceIds
                    )
                  : unavailable(notPublished, pageIds);
    }
    for (const [facet, slot] of [
        ["stages", dossier.audience.stages],
        ["sectors", dossier.audience.sectors],
        ["geography", dossier.audience.geography],
        ["businessModels", dossier.audience.businessModels],
        ["benefits", dossier.audience.benefits],
        ["instruments", dossier.audience.instruments],
    ] as const) {
        if (!open(slot)) continue;
        if (facet === "stages") dossier.audience.stages = unavailable(notPublished, pageIds);
        else if (facet === "sectors") dossier.audience.sectors = unavailable(notPublished, pageIds);
        else if (facet === "geography")
            dossier.audience.geography = unavailable(notPublished, pageIds);
        else if (facet === "businessModels")
            dossier.audience.businessModels = unavailable(notPublished, pageIds);
        else if (facet === "benefits")
            dossier.audience.benefits = unavailable(notPublished, pageIds);
        else dossier.audience.instruments = unavailable(notPublished, pageIds);
    }
    if (open(dossier.contact.routes)) {
        dossier.contact.routes = unavailable(notPublished, pageIds);
    }
}

function partialSlot<T>(detail: string, evidenceIds: string[]): InformationSlot<T> {
    return { state: "partial", detail, evidenceIds, claim: "fact", value: null };
}

function singleFixedDilution(components: DealComponent[]): boolean {
    if (components.length !== 1) return false;
    const [component] = components;
    if (
        !component ||
        component.contingent ||
        component.equity === null ||
        component.amount === null
    ) {
        return false;
    }
    return component.kind === "cash" || component.kind === "equity";
}

function dealComponents(programId: string, deal: DealFile, quote: string): DealComponent[] {
    return deal.parts.flatMap((part, index) => {
        const kind = COMPONENT_KINDS[part.kind];
        if (!kind) throw new Error(`Deal ${programId} has unknown component ${part.kind}`);
        const equity =
            part.equity &&
            part.equity.toLowerCase() !== "none stated" &&
            includesText(quote, part.equity)
                ? part.equity
                : percentInQuote(quote, part.equity);
        const bounded = part.amount ? boundedAmount(quote, part.amount) : false;
        const amount =
            part.amount && amountInQuote(quote, part.amount) && !bounded ? part.amount : null;
        const label = componentLabel(part.kind, quote);
        if (!label) return [];
        return [
            {
                id: `${programId}-deal-${index + 1}`.slice(0, 64),
                kind,
                label,
                amount,
                currency: amount ? part.currency : null,
                equity,
                contingent: part.contingent || bounded,
                condition:
                    part.condition && includesText(quote, part.condition) ? part.condition : null,
                evidenceIds: [deal.sourceId],
            },
        ];
    });
}

function percentInQuote(quote: string, equity: string | null): string | null {
    if (!equity) return null;
    const match = /\d+(?:\.\d+)?%/.exec(equity);
    if (!match?.[0] || !includesText(quote, match[0])) return null;
    return match[0];
}

function componentLabel(kind: string, quote: string): string | null {
    const candidates: Record<string, string[]> = {
        safe: ["post-money SAFE", "SAFE"],
        "post-money-safe": ["post-money SAFE", "SAFE"],
        "partner-credits": ["credits"],
        credits: ["credits"],
        "equity-free-grant": ["Equity-free grant", "grant"],
        grant: ["grant"],
        "follow-on": ["follow-on"],
        follow_on: ["follow-on"],
        investment: ["investment"],
        unspecified_investment: ["investment"],
    };
    return (candidates[kind] ?? []).find(label => includesText(quote, label)) ?? null;
}

function applyGap(dossier: ProgramIntelligence, gap: GapFile["items"][number]): void {
    const evidenceIds = (gap.sourceIds ?? []).filter(id =>
        dossier.evidence.some(item => item.id === id)
    );
    const field = gap.field ?? gap.group;
    if (gap.state === "conflict") {
        const group = INFORMATION_GROUP_FROM[gap.group] ?? "identity";
        const slot = conflicting<string>(gap.detail, evidenceIds);
        if (field === "locationCount") dossier.identity.locationCount = slot;
        else if (field === "residencyEnd") dossier.batches.residencyEnd = slot;
        else if (field === "nextDeadline") dossier.batches.nextDeadline = slot;
        else return;
        const item = reviewFor(dossier.programId, group, field, gap.detail, evidenceIds);
        if (!dossier.review.some(existing => existing.id === item.id)) dossier.review.push(item);
        return;
    }
    if (gap.state === "unavailable") {
        if (field === "nextDeadline") {
            dossier.batches.nextDeadline = unavailable(gap.detail, evidenceIds);
        } else if (gap.group === "selectivity") {
            dossier.selectivity = unavailable(gap.detail, evidenceIds);
        } else if (gap.group === "deal" && dossier.deal.state === "not_checked") {
            dossier.deal.state = "unavailable";
            dossier.deal.detail = gap.detail;
        } else if (gap.group === "portfolio" && dossier.portfolio.companies.length === 0) {
            dossier.portfolio.state = "unavailable";
            dossier.portfolio.detail = gap.detail;
            dossier.portfolio.returns = unavailable(gap.detail, evidenceIds);
        }
        return;
    }
    if (
        gap.state === "partial" &&
        gap.group === "portfolio" &&
        dossier.portfolio.companies.length > 0
    ) {
        dossier.portfolio.state = "partial";
        dossier.portfolio.detail = gap.detail;
    }
}

const INFORMATION_GROUP_FROM: Record<string, InformationGroup> = {
    identity: "identity",
    audience: "audience",
    contact: "contact",
    batches: "batches",
    selectivity: "selectivity",
    deal: "deal",
    portfolio: "portfolio",
    historical_examples: "historical_examples",
    tags: "tags",
};

function readDiscovery(root: string, programId: string): ProgramIntelligence["discovery"] {
    try {
        const parsed = readJson(join(root, "discoveries", `${programId}.json`)) as DiscoveryFile;
        return { checkedAt: parsed.checkedAt ?? null, pages: parsed.pages ?? [] };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { checkedAt: null, pages: [] };
        }
        throw error;
    }
}

export type CoverageRow = {
    group: string;
    evidenced: number;
    recorded: number;
    notChecked: number;
};

export function coverageRows(dossiers: ProgramIntelligence[]): CoverageRow[] {
    const total = dossiers.length;
    const count = (
        group: string,
        pick: (dossier: ProgramIntelligence) => "evidenced" | "recorded" | "not_checked"
    ): CoverageRow => {
        let evidenced = 0;
        let recorded = 0;
        let notChecked = 0;
        for (const dossier of dossiers) {
            const state = pick(dossier);
            if (state === "evidenced") evidenced += 1;
            else if (state === "recorded") recorded += 1;
            else notChecked += 1;
        }
        if (evidenced + recorded + notChecked !== total) {
            throw new Error(`Coverage for ${group} does not match the catalogue`);
        }
        return { group, evidenced, recorded, notChecked };
    };
    const slotClass = (slot: InformationSlot<unknown>) =>
        slot.state === "not_checked"
            ? "not_checked"
            : slot.state === "available" || (slot.state === "partial" && slot.value !== null)
              ? "evidenced"
              : "recorded";
    return [
        count("Identity (sourced name)", dossier => slotClass(dossier.identity.name)),
        count("Official URL", dossier => slotClass(dossier.identity.officialUrl)),
        count("Operating status", dossier => slotClass(dossier.identity.operatingStatus)),
        count("Applications open, kept apart from operating status", dossier =>
            slotClass(dossier.identity.applicationsOpen)
        ),
        count("Audience narrative", dossier => slotClass(dossier.audience.narrative)),
        count("Stage tags", dossier => slotClass(dossier.audience.stages)),
        count("Sector tags", dossier => slotClass(dossier.audience.sectors)),
        count("Geography tags", dossier => slotClass(dossier.audience.geography)),
        count("Business model tags", dossier => slotClass(dossier.audience.businessModels)),
        count("Benefit tags", dossier => slotClass(dossier.audience.benefits)),
        count("Instrument tags", dossier => slotClass(dossier.audience.instruments)),
        count("Evidence-backed tag", dossier =>
            dossier.tagIds.length
                ? "evidenced"
                : dossier.audience.stages.state === "not_checked"
                  ? "not_checked"
                  : "recorded"
        ),
        count("Public email", dossier => slotClass(dossier.contact.email)),
        count("Public phone", dossier => slotClass(dossier.contact.phone)),
        count("Application route", dossier => slotClass(dossier.contact.applicationUrl)),
        count("Cycle identity", dossier =>
            dossier.batches.cycles.length ? "evidenced" : "recorded"
        ),
        count("Announced cycle deadline", dossier =>
            dossier.batches.cycles.some(cycle => cycle.announcedDeadline.state === "available")
                ? "evidenced"
                : dossier.batches.cycles.some(
                        cycle => cycle.announcedDeadline.state !== "not_checked"
                    )
                  ? "recorded"
                  : "not_checked"
        ),
        count("Next deadline", dossier => slotClass(dossier.batches.nextDeadline)),
        count("Selectivity", dossier => slotClass(dossier.selectivity)),
        count("Formatted deal", dossier =>
            dossier.deal.state === "available"
                ? "evidenced"
                : dossier.deal.state === "not_checked"
                  ? "not_checked"
                  : "recorded"
        ),
        count("Deal components", dossier =>
            dossier.deal.components.length
                ? "evidenced"
                : dossier.deal.state === "not_checked"
                  ? "not_checked"
                  : "recorded"
        ),
        count("Intake (deadline, rolling, or announced)", dossier => {
            const dated = slotClass(dossier.batches.nextDeadline);
            if (dated === "evidenced") return "evidenced";
            if (slotClass(dossier.batches.announcedStarts) === "evidenced") return "evidenced";
            if (
                dossier.batches.cycles.some(
                    cycle => cycle.announcedDeadline.value?.rolling === true
                )
            ) {
                return "evidenced";
            }
            return dated;
        }),
        count("Portfolio companies", dossier =>
            dossier.portfolio.companies.length
                ? "evidenced"
                : dossier.portfolio.state === "not_checked"
                  ? "not_checked"
                  : "recorded"
        ),
        count("Investment returns", dossier => slotClass(dossier.portfolio.returns)),
        count("Historical application example", dossier =>
            dossier.historicalExamples.state === "available"
                ? "evidenced"
                : dossier.historicalExamples.state === "not_checked"
                  ? "not_checked"
                  : "recorded"
        ),
    ];
}

export function coverageMarkdown(dossiers: ProgramIntelligence[]): string {
    const rows = coverageRows(dossiers);
    const companies = dossiers.reduce(
        (sum, dossier) => sum + dossier.portfolio.companies.length,
        0
    );
    const conflicts = dossiers.flatMap(dossier =>
        dossier.review.filter(item => item.state === "conflicting")
    );
    const stale = dossiers.flatMap(dossier =>
        dossier.review.filter(item => item.state === "stale")
    );
    const inaccessible = dossiers.flatMap(dossier =>
        dossier.review.filter(item => item.state === "inaccessible")
    );
    const mixed = dossiers.filter(dossier => {
        const kinds = new Set(dossier.deal.components.map(component => component.kind));
        if (kinds.size > 1) return true;
        return (
            dossier.deal.components.length > 1 &&
            dossier.deal.components.some(component => component.contingent) &&
            dossier.deal.components.some(component => !component.contingent)
        );
    });
    const multiCycle = dossiers.filter(dossier => dossier.batches.cycles.length > 1);
    const lines = [
        "# Catalogue coverage by information group",
        "",
        `Program files: ${dossiers.length}. A count is evidence already collected. It is not a claim that the other programs lack the fact in the world.`,
        "",
        "| Information group | Evidenced | Recorded unavailable, partial, or conflicting | Not checked |",
        "| --- | ---: | ---: | ---: |",
        ...rows.map(
            row => `| ${row.group} | ${row.evidenced} | ${row.recorded} | ${row.notChecked} |`
        ),
        "",
        `Portfolio company identities recorded: ${companies}. Participation, a portfolio listing, and a companies-page listing stay separate from a confirmed investment. No return was recorded.`,
        "",
        `Open conflicts on the operator review queue: ${conflicts.length}. The matcher and the screens are not asked to pick a winner.`,
        "",
        `Latest refresh: ${stale.length} stored excerpts are no longer on their page (${new Set(stale.map(item => item.programId)).size} programs) and ${inaccessible.length} sources could not be fetched (${new Set(inaccessible.map(item => item.programId)).size} programs). Both stay on the operator review queue; the stored excerpt and its last successful check are kept.`,
        "",
        "Representative cases:",
        "",
        `- Mixed instruments: ${mixed.map(dossier => dossier.programId).join(", ") || "none"}. Cash, SAFEs, grants, credits, and follow-on amounts stay separate. comparableDilution is false for those packages.`,
        `- Multiple batches: ${multiCycle.map(dossier => `${dossier.programId} (${dossier.batches.cycles.map(cycle => cycle.id).join(", ")})`).join("; ") || "none"}.`,
        `- Conflicts left unresolved: ${conflicts.map(item => `${item.programId} ${item.field}`).join("; ") || "none"}.`,
        "- Historical example: a public application is recorded only with a separate acceptance excerpt. Answers are not copied. When the checked official pages link no example, that is recorded as unavailable on those pages, not as a rejection, and sites elsewhere were not searched.",
        "",
        "Company-fit scoring and the discovery, detail, and tracker screens are outside this delivery.",
        "",
    ];
    return lines.join("\n");
}

export function intelligenceManifest(dossiers: ProgramIntelligence[]) {
    return {
        schemaVersion: 1 as const,
        contract: "program-intelligence/v1" as const,
        programs: dossiers.map(dossier => ({
            programId: dossier.programId,
            checkedAt: dossier.checkedAt,
            cycleIds: dossier.batches.cycles.map(cycle => cycle.id),
            portfolioCompanyIds: dossier.portfolio.companies.map(company => company.id),
            tagIds: dossier.tagIds,
            openReviewIds: dossier.review
                .filter(item => item.status === "open")
                .map(item => item.id),
        })),
    };
}
