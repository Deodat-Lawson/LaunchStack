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
    const id = `${programId}:${field}`;
    return {
        id: id.length <= 64 ? id : id.slice(0, 64),
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
    const taxonomy = TaxonomySchema.parse(readJson(join(root, "taxonomy.json")));
    const historical = readJson(
        join(root, "examples", "historical-applications.json")
    ) as HistoricalFile;
    const gaps = readJson(join(root, "gaps.json")) as GapFile;
    for (const tag of taxonomy.tags) {
        for (const support of tag.evidence) {
            const program = programs.get(support.programId);
            const source = program?.sources.find(item => item.id === support.sourceId);
            const needles = [tag.label, ...tag.aliases];
            if (!source || !needles.some(needle => includesText(source.quote, needle))) {
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
    }
): ProgramIntelligence {
    const evidence = program.sources.map(evidenceFromSource);
    const byId = new Map(evidence.map(item => [item.id, item]));
    const review: ReviewItem[] = [];
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
            evidence.flatMap(
                item => item.excerpt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
            )
        ),
    ];
    const phones = [
        ...new Set(evidence.flatMap(item => item.excerpt.match(/\+\d[\d\s().-]{7,}\d/g) ?? [])),
    ];
    const openSources = evidence.filter(item =>
        /applications?(?:\s+\w+){0,8}\s+(?:are|is)\s+open|\bopen now\b/i.test(item.excerpt)
    );

    let email: InformationSlot<string> = unchecked();
    if (emails.length === 1) {
        const source = evidence.find(item => item.excerpt.includes(emails[0]!));
        email = available(emails[0]!, source ? [source.id] : [], "fact");
    } else if (emails.length > 1) {
        email = conflicting(
            "More than one public address is in the checked excerpts. None was selected.",
            evidence
                .filter(item => emails.some(address => item.excerpt.includes(address)))
                .map(item => item.id)
        );
        review.push(reviewFor(program.id, "contact", "email", email.detail!, email.evidenceIds));
    }
    let phone: InformationSlot<string> = unchecked();
    if (phones.length === 1) {
        const source = evidence.find(item => item.excerpt.includes(phones[0]!));
        phone = available(phones[0]!, source ? [source.id] : [], "fact");
    } else if (phones.length > 1) {
        phone = conflicting(
            "More than one public phone number is in the checked excerpts. None was selected.",
            evidence
                .filter(item => phones.some(value => item.excerpt.includes(value)))
                .map(item => item.id)
        );
        review.push(reviewFor(program.id, "contact", "phone", phone.detail!, phone.evidenceIds));
    }

    const cycles = program.cycles.map(cycle => {
        const limitation = cycle.form.limitations.join("\n");
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
            location: unchecked(),
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
            narrative: available(
                program.targetApplicants.text,
                program.targetApplicants.sourceIds,
                program.targetApplicants.interpretation ? "interpretation" : "fact"
            ),
            stages: listFromTags("stage"),
            sectors: listFromTags("sector"),
            technologies: listFromTags("technology"),
            businessModels: listFromTags("business_model"),
            customerTypes: listFromTags("customer_type"),
            geography: listFromTags("geography"),
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
        review,
    };

    for (const gap of input.gaps) applyGap(dossier, gap);
    return ProgramIntelligenceSchema.parse(dossier);
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
        count("Evidence-backed tag", dossier =>
            dossier.tagIds.length ? "evidenced" : "not_checked"
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
        "Representative cases:",
        "",
        `- Mixed instruments: ${mixed.map(dossier => dossier.programId).join(", ") || "none"}. Cash, SAFEs, grants, credits, and follow-on amounts stay separate. comparableDilution is false for those packages.`,
        `- Multiple batches: ${multiCycle.map(dossier => `${dossier.programId} (${dossier.batches.cycles.map(cycle => cycle.id).join(", ")})`).join("; ") || "none"}.`,
        `- Conflicts left unresolved: ${conflicts.map(item => `${item.programId} ${item.field}`).join("; ") || "none"}.`,
        "- Historical example: a public application is recorded only with a separate acceptance excerpt. Answers are not copied, and a missing example stays not checked rather than a rejection.",
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
