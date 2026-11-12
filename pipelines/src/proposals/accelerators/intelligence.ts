import { z } from "zod";

/**
 * Public Program, Cycle, evidence, and taxonomy contract for workstreams 2 and 3.
 * Portfolio companies are factual inputs. This module does not score company similarity.
 * Conflicting sources stay on the operator review queue; nothing here picks a winner.
 */

const IdSchema = z.string().trim().min(1).max(64);
const HttpUrlSchema = z
    .string()
    .url()
    .refine(value => /^https?:\/\//i.test(value), "Use a public HTTP or HTTPS URL");
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const DateOnlySchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(value => {
        const date = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "Use a real calendar date (YYYY-MM-DD)");

export const INFORMATION_STATES = [
    "available",
    "missing",
    "conflicting",
    "stale",
    "inaccessible",
    "not_applicable",
    "partial",
    "unavailable",
    "not_checked",
] as const;
export const InformationStateSchema = z.enum(INFORMATION_STATES);
export type InformationState = z.infer<typeof InformationStateSchema>;

export const CLAIM_KINDS = ["fact", "interpretation"] as const;
export const ClaimKindSchema = z.enum(CLAIM_KINDS);
export type ClaimKind = z.infer<typeof ClaimKindSchema>;

export const PAGE_KINDS = [
    "details",
    "terms",
    "portfolio",
    "batches",
    "application",
    "other",
] as const;
export const PageKindSchema = z.enum(PAGE_KINDS);
export type PageKind = z.infer<typeof PageKindSchema>;

export const TAG_FACETS = [
    "program_type",
    "sector",
    "technology",
    "business_model",
    "customer_type",
    "stage",
    "geography",
    "instrument",
    "benefit",
] as const;
export const TagFacetSchema = z.enum(TAG_FACETS);
export type TagFacet = z.infer<typeof TagFacetSchema>;

/** A tag as consumers see it: readable on its own, with the evidence on this Program that supports it. */
export const ProgramTagSchema = z
    .object({
        id: IdSchema,
        facet: TagFacetSchema,
        label: z.string().trim().min(1),
        evidenceIds: z.array(IdSchema).min(1),
    })
    .strict();
export type ProgramTag = z.infer<typeof ProgramTagSchema>;

export const INFORMATION_GROUPS = [
    "identity",
    "audience",
    "contact",
    "batches",
    "selectivity",
    "deal",
    "portfolio",
    "historical_examples",
    "tags",
] as const;
export const InformationGroupSchema = z.enum(INFORMATION_GROUPS);
export type InformationGroup = z.infer<typeof InformationGroupSchema>;

const EMPTY_VALUE = new Set<InformationState>([
    "missing",
    "conflicting",
    "unavailable",
    "not_applicable",
    "not_checked",
]);

export const EvidenceSchema = z
    .object({
        id: IdSchema,
        url: HttpUrlSchema,
        title: z.string().trim().min(1),
        excerpt: z.string().trim().min(1),
        checkedAt: IsoDateTimeSchema,
        kind: ClaimKindSchema,
        origin: z.enum(["official", "secondary"]),
        page: PageKindSchema,
    })
    .strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export function informationSlot<T extends z.ZodTypeAny>(value: T) {
    return z
        .object({
            state: InformationStateSchema,
            detail: z.string().trim().min(1).nullable(),
            evidenceIds: z.array(IdSchema),
            claim: ClaimKindSchema.nullable(),
            value: value.nullable(),
        })
        .strict()
        .superRefine((slot, ctx) => {
            if (EMPTY_VALUE.has(slot.state) && slot.value !== null) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `${slot.state} cannot store a chosen value`,
                });
            }
            if (slot.state === "available" && slot.value === null) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "An available claim needs its value",
                });
            }
            if (slot.state !== "available" && slot.detail === null) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "This state needs an explanation",
                });
            }
            if (
                (slot.state === "available" ||
                    slot.state === "partial" ||
                    slot.state === "stale" ||
                    slot.state === "conflicting") &&
                slot.evidenceIds.length === 0
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "This state needs evidence",
                });
            }
            if (
                (slot.state === "available" ||
                    slot.state === "partial" ||
                    slot.state === "stale") &&
                slot.claim === null
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "A sourced claim must say fact or interpretation",
                });
            }
            if (EMPTY_VALUE.has(slot.state) && slot.claim !== null) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "An empty state is not a fact or an interpretation",
                });
            }
            if (slot.state === "not_checked" && slot.evidenceIds.length > 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Not checked means collection has not cited evidence yet",
                });
            }
        });
}

export type InformationSlot<T> = {
    state: InformationState;
    detail: string | null;
    evidenceIds: string[];
    claim: ClaimKind | null;
    value: T | null;
};

export function unchecked<T>(detail = "Not checked"): InformationSlot<T> {
    return { state: "not_checked", detail, evidenceIds: [], claim: null, value: null };
}

export function available<T>(
    value: T,
    evidenceIds: string[],
    claim: ClaimKind,
    detail: string | null = null
): InformationSlot<T> {
    return { state: "available", detail, evidenceIds, claim, value };
}

export function unavailable<T>(detail: string, evidenceIds: string[] = []): InformationSlot<T> {
    return { state: "unavailable", detail, evidenceIds, claim: null, value: null };
}

export function conflicting<T>(detail: string, evidenceIds: string[]): InformationSlot<T> {
    return { state: "conflicting", detail, evidenceIds, claim: null, value: null };
}

export function partial<T>(
    value: T | null,
    detail: string,
    evidenceIds: string[],
    claim: ClaimKind
): InformationSlot<T> {
    return { state: "partial", detail, evidenceIds, claim, value };
}

const TextSlot = informationSlot(z.string().trim().min(1));
const StringListSlot = informationSlot(z.array(z.string().trim().min(1)));
const UrlSlot = informationSlot(HttpUrlSchema);
const BooleanSlot = informationSlot(z.boolean());

const OperatingStatusSlot = informationSlot(z.enum(["active", "paused", "closed", "unknown"]));

const DeadlineValueSchema = z
    .object({
        at: IsoDateTimeSchema.nullable(),
        dateOnly: DateOnlySchema.nullable(),
        timezone: z.string().trim().min(1).nullable(),
        rolling: z.boolean(),
    })
    .strict();
const DeadlineSlot = informationSlot(DeadlineValueSchema);

export const DEAL_COMPONENT_KINDS = [
    "cash",
    "equity",
    "safe",
    "grant",
    "credits",
    "fee",
    "condition",
    "benefit",
    "follow_on",
    "unspecified_investment",
] as const;

export const DealComponentSchema = z
    .object({
        id: IdSchema,
        kind: z.enum(DEAL_COMPONENT_KINDS),
        label: z.string().trim().min(1),
        amount: z.string().regex(/^\d+$/).nullable(),
        currency: z.string().trim().min(1).nullable(),
        equity: z.string().trim().min(1).nullable(),
        contingent: z.boolean(),
        condition: z.string().trim().min(1).nullable(),
        evidenceIds: z.array(IdSchema).min(1),
    })
    .strict();
export type DealComponent = z.infer<typeof DealComponentSchema>;

export const DealBlockSchema = z
    .object({
        type: z.enum(["heading", "paragraph", "list", "table", "caveat", "link"]),
        text: z.string().trim().min(1),
        href: HttpUrlSchema.nullable(),
    })
    .strict();
export type DealBlock = z.infer<typeof DealBlockSchema>;

export const PORTFOLIO_RELATIONSHIPS = [
    "participation",
    "investment",
    "portfolio_listing",
    "companies_page_listing",
] as const;

export const PortfolioReturnSchema = z
    .object({
        basis: z.enum(["realized", "unrealized"]),
        asOf: DateOnlySchema,
        narrative: z.string().trim().min(1),
        evidenceIds: z.array(IdSchema).min(1),
    })
    .strict();
export type PortfolioReturn = z.infer<typeof PortfolioReturnSchema>;

export const FundingRoundSchema = z
    .object({
        id: IdSchema,
        date: DateOnlySchema.nullable(),
        amount: z.string().regex(/^\d+$/).nullable(),
        currency: z.string().trim().min(1).nullable(),
        investors: z.array(z.string().trim().min(1)),
        evidenceIds: z.array(IdSchema).min(1),
    })
    .strict();

export const PortfolioCompanySchema = z
    .object({
        id: IdSchema,
        name: z.string().trim().min(1),
        website: z.string().trim().min(1).nullable(),
        sectors: z.array(z.string().trim().min(1)),
        cohort: z.string().trim().min(1).nullable(),
        location: z.string().trim().min(1).nullable(),
        relationship: z.enum(PORTFOLIO_RELATIONSHIPS),
        rounds: z.array(FundingRoundSchema),
        exits: z.array(
            z
                .object({
                    id: IdSchema,
                    narrative: z.string().trim().min(1),
                    evidenceIds: z.array(IdSchema).min(1),
                })
                .strict()
        ),
        returns: PortfolioReturnSchema.nullable(),
        excerpt: z.string().trim().min(1),
        evidenceIds: z.array(IdSchema).min(1),
    })
    .strict();
export type PortfolioCompany = z.infer<typeof PortfolioCompanySchema>;

export const HistoricalExampleSchema = z
    .object({
        id: IdSchema,
        company: z.string().trim().min(1),
        cycleLabel: z.string().trim().min(1).nullable(),
        sourceUrl: HttpUrlSchema,
        textAvailability: z.enum(["published", "unavailable", "restricted"]),
        answersCopied: z.boolean(),
        acceptance: z
            .object({
                state: z.enum(["verified", "unverified", "not_applicable"]),
                detail: z.string().trim().min(1),
                evidenceIds: z.array(IdSchema),
            })
            .strict(),
        completeness: z.string().trim().min(1),
        redactions: z.string().trim().min(1).nullable(),
        kind: z.enum(["original_application", "advice", "unverified_example"]),
    })
    .strict()
    .superRefine((example, ctx) => {
        if (example.kind === "advice" && example.acceptance.state === "verified") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["acceptance"],
                message: "Advice is not acceptance evidence",
            });
        }
        if (
            example.acceptance.state === "verified" &&
            example.acceptance.evidenceIds.length === 0
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["acceptance", "evidenceIds"],
                message: "Verified acceptance needs its own source",
            });
        }
    });
export type HistoricalExample = z.infer<typeof HistoricalExampleSchema>;

export const ReviewItemSchema = z
    .object({
        id: IdSchema,
        programId: IdSchema,
        group: InformationGroupSchema,
        field: z.string().trim().min(1),
        state: z.enum(["conflicting", "stale", "inaccessible"]),
        evidenceIds: z.array(IdSchema),
        detail: z.string().trim().min(1),
        status: z.literal("open"),
    })
    .strict();
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const DiscoveredPageSchema = z
    .object({
        url: HttpUrlSchema,
        page: PageKindSchema,
        anchor: z.string(),
        fetched: z.boolean(),
        blocked: z.enum(["robots", "fetch_failed"]).nullable(),
        origin: z.enum(["official", "secondary"]),
    })
    .strict();
export type DiscoveredPage = z.infer<typeof DiscoveredPageSchema>;

const SelectivityValueSchema = z
    .object({
        rate: z.number().min(0).max(1).nullable(),
        applicants: z.number().int().nonnegative().nullable(),
        admits: z.number().int().nonnegative().nullable(),
        population: z.string().trim().min(1).nullable(),
        method: z.string().trim().min(1).nullable(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (
            value.rate !== null &&
            value.applicants !== null &&
            value.admits !== null &&
            value.applicants > 0 &&
            Math.abs(value.rate - value.admits / value.applicants) > 0.001
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["rate"],
                message: "A derived rate has to match the cited counts",
            });
        }
    });

export const ProgramIntelligenceSchema = z
    .object({
        schemaVersion: z.literal(1),
        programId: IdSchema,
        checkedAt: IsoDateTimeSchema,
        evidence: z.array(EvidenceSchema).min(1),
        discovery: z
            .object({
                checkedAt: IsoDateTimeSchema.nullable(),
                pages: z.array(DiscoveredPageSchema),
            })
            .strict(),
        identity: z
            .object({
                name: TextSlot,
                operator: TextSlot,
                officialUrl: UrlSlot,
                location: TextSlot,
                locationCount: TextSlot,
                operatingStatus: OperatingStatusSlot,
                applicationsOpen: BooleanSlot,
            })
            .strict(),
        audience: z
            .object({
                narrative: TextSlot,
                stages: StringListSlot,
                sectors: StringListSlot,
                technologies: StringListSlot,
                businessModels: StringListSlot,
                customerTypes: StringListSlot,
                geography: StringListSlot,
                constraints: TextSlot,
            })
            .strict(),
        contact: z
            .object({
                email: TextSlot,
                phone: TextSlot,
                applicationUrl: UrlSlot,
                routes: StringListSlot,
            })
            .strict(),
        batches: z
            .object({
                cycles: z.array(
                    z
                        .object({
                            id: IdSchema,
                            label: z.string().trim().min(1),
                            announcedDeadline: DeadlineSlot,
                        })
                        .strict()
                ),
                historicalCadence: TextSlot,
                announcedStarts: TextSlot,
                nextDeadline: TextSlot,
                residencyEnd: TextSlot,
            })
            .strict(),
        selectivity: informationSlot(SelectivityValueSchema),
        deal: z
            .object({
                state: InformationStateSchema,
                detail: z.string().trim().min(1).nullable(),
                summary: TextSlot,
                formatted: TextSlot,
                blocks: z.array(DealBlockSchema),
                components: z.array(DealComponentSchema),
                comparableDilution: z.boolean(),
            })
            .strict(),
        portfolio: z
            .object({
                state: InformationStateSchema,
                detail: z.string().trim().min(1).nullable(),
                companies: z.array(PortfolioCompanySchema),
                returns: informationSlot(PortfolioReturnSchema),
            })
            .strict(),
        historicalExamples: z
            .object({
                state: InformationStateSchema,
                detail: z.string().trim().min(1).nullable(),
                examples: z.array(HistoricalExampleSchema),
            })
            .strict(),
        tagIds: z.array(IdSchema),
        tags: z.array(ProgramTagSchema),
        review: z.array(ReviewItemSchema),
    })
    .strict()
    .superRefine((dossier, ctx) => {
        const evidence = new Map(dossier.evidence.map(item => [item.id, item]));
        if (
            dossier.tags.map(tag => tag.id).join() !== dossier.tagIds.join() ||
            dossier.tags.some(tag => tag.evidenceIds.some(id => !evidence.has(id)))
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["tags"],
                message: "Tags must match tagIds and cite evidence on this Program",
            });
        }
        if (evidence.size !== dossier.evidence.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["evidence"],
                message: "Evidence IDs must be unique",
            });
        }
        if (
            new Set(dossier.batches.cycles.map(cycle => cycle.id)).size !==
            dossier.batches.cycles.length
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["batches", "cycles"],
                message: "Cycle IDs must stay unique",
            });
        }
        if (
            new Set(dossier.portfolio.companies.map(company => company.id)).size !==
            dossier.portfolio.companies.length
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["portfolio", "companies"],
                message: "Portfolio-company IDs must stay unique",
            });
        }
        const seenReview = new Set<string>();
        for (const item of dossier.review) {
            if (item.programId !== dossier.programId) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["review"],
                    message: "Review items stay on their Program",
                });
            }
            if (seenReview.has(item.id)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["review"],
                    message: "Review IDs must be unique",
                });
            }
            seenReview.add(item.id);
            if (item.status !== "open") {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["review"],
                    message: "Only an operator can close a review item",
                });
            }
        }
        const walk = (node: unknown, path: (string | number)[]) => {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
                node.forEach((entry, index) => walk(entry, [...path, index]));
                return;
            }
            const record = node as Record<string, unknown>;
            if (
                typeof record.state === "string" &&
                Array.isArray(record.evidenceIds) &&
                "value" in record &&
                "claim" in record
            ) {
                const ids = record.evidenceIds as string[];
                if (ids.some(id => !evidence.has(id))) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path,
                        message: "Evidence references must exist on this Program",
                    });
                }
                if (record.claim === "fact") {
                    const facts = ids.filter(id => evidence.get(id)?.kind === "fact");
                    if (facts.length === 0) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path,
                            message: "A fact needs a reported excerpt, not only an interpretation",
                        });
                    }
                }
                if (record.state === "conflicting") {
                    const open = dossier.review.some(
                        item =>
                            item.state === "conflicting" &&
                            item.status === "open" &&
                            ids.every(id => item.evidenceIds.includes(id))
                    );
                    if (!open) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path,
                            message: "A conflict stays on the operator review queue",
                        });
                    }
                }
            }
            for (const [key, value] of Object.entries(record)) {
                if (key === "evidence") continue;
                walk(value, [...path, key]);
            }
        };
        walk(dossier, []);
        for (const company of dossier.portfolio.companies) {
            if (company.relationship !== "investment" && company.rounds.length > 0) {
                const sourced = company.rounds.every(round => round.evidenceIds.length > 0);
                if (!sourced) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["portfolio", "companies"],
                        message: "A funding round needs its own evidence",
                    });
                }
            }
            if (company.returns && company.relationship === "participation") {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["portfolio", "companies"],
                    message: "Participation is not an investment return",
                });
            }
        }
        if (dossier.portfolio.state === "unavailable" && dossier.portfolio.companies.length > 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["portfolio", "companies"],
                message: "An unavailable portfolio cannot invent companies",
            });
        }
        if (
            dossier.deal.comparableDilution &&
            dossier.deal.components.some(
                component =>
                    component.kind === "safe" ||
                    component.kind === "credits" ||
                    component.kind === "grant" ||
                    component.contingent
            )
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["deal", "comparableDilution"],
                message: "A SAFE, grant, credit, or contingent term is not fixed dilution",
            });
        }
    });
export type ProgramIntelligence = z.infer<typeof ProgramIntelligenceSchema>;

export const TaxonomyTagSchema = z
    .object({
        id: IdSchema,
        facet: TagFacetSchema,
        label: z.string().trim().min(1),
        aliases: z.array(z.string().trim().min(1)),
        evidence: z
            .array(
                z
                    .object({
                        programId: IdSchema,
                        sourceId: IdSchema,
                    })
                    .strict()
            )
            .min(1),
    })
    .strict();
export type TaxonomyTag = z.infer<typeof TaxonomyTagSchema>;

export const TaxonomySchema = z
    .object({
        schemaVersion: z.literal(1),
        checkedAt: IsoDateTimeSchema,
        note: z.string().trim().min(1).optional(),
        tags: z.array(TaxonomyTagSchema),
    })
    .strict()
    .superRefine((taxonomy, ctx) => {
        if (new Set(taxonomy.tags.map(tag => tag.id)).size !== taxonomy.tags.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["tags"],
                message: "Tag IDs must be stable and unique",
            });
        }
    });
export type Taxonomy = z.infer<typeof TaxonomySchema>;

export type IdentityKeys = {
    programId: string;
    cycleIds: string[];
    portfolioCompanyIds: string[];
    evidenceIds: string[];
    tagIds: string[];
};

export function identityKeys(dossier: ProgramIntelligence): IdentityKeys {
    return {
        programId: dossier.programId,
        cycleIds: dossier.batches.cycles.map(cycle => cycle.id),
        portfolioCompanyIds: dossier.portfolio.companies.map(company => company.id),
        evidenceIds: dossier.evidence.map(item => item.id),
        tagIds: [...dossier.tagIds],
    };
}

type SlotRecord = InformationSlot<unknown>;

function isSlot(value: unknown): value is SlotRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.state === "string" &&
        Array.isArray(record.evidenceIds) &&
        "value" in record &&
        "claim" in record
    );
}

function visitSlots(node: unknown, visit: (slot: SlotRecord) => void): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
        for (const entry of node) visitSlots(entry, visit);
        return;
    }
    if (isSlot(node)) visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === "evidence") continue;
        visitSlots(value, visit);
    }
}

export type RefreshObservation = {
    evidenceId: string;
    outcome: "current" | "stale" | "inaccessible";
    checkedAt: string;
    detail: string;
};

function reviewId(programId: string, field: string): string {
    const id = `${programId}:${field}`;
    if (id.length <= 64) return id;
    return id.slice(0, 64);
}

/**
 * Re-check one stored excerpt. A failed or stale check keeps the last value and the
 * Program, Cycle, evidence, and portfolio-company IDs. Conflicts stay unresolved.
 */
export function applySourceRefresh(
    dossier: ProgramIntelligence,
    observation: RefreshObservation
): ProgramIntelligence {
    const next = structuredClone(dossier);
    const evidence = next.evidence.find(item => item.id === observation.evidenceId);
    if (!evidence) {
        throw new Error(
            `Refresh cannot create evidence ${observation.evidenceId} on ${dossier.programId}`
        );
    }
    const previousExcerpt = evidence.excerpt;
    const previousCheckedAt = evidence.checkedAt;
    if (observation.outcome === "current") {
        evidence.checkedAt = observation.checkedAt;
        next.review = next.review.filter(
            item =>
                !(
                    item.state === "stale" &&
                    item.evidenceIds.length === 1 &&
                    item.evidenceIds[0] === observation.evidenceId
                )
        );
        visitSlots(next, slot => {
            if (!slot.evidenceIds.includes(observation.evidenceId)) return;
            if (slot.state === "stale" && slot.value !== null && slot.claim !== null) {
                slot.state = "available";
                slot.detail = null;
            }
        });
    } else {
        const field = `${observation.outcome}:${observation.evidenceId}`;
        const id = reviewId(next.programId, field);
        if (!next.review.some(item => item.id === id)) {
            next.review.push({
                id,
                programId: next.programId,
                group: "identity",
                field,
                state: observation.outcome,
                evidenceIds: [observation.evidenceId],
                detail: observation.detail,
                status: "open",
            });
        }
        visitSlots(next, slot => {
            if (!slot.evidenceIds.includes(observation.evidenceId)) return;
            if (slot.state !== "available" && slot.state !== "partial") return;
            if (observation.outcome === "stale") {
                if (slot.claim === null) return;
                slot.state = "stale";
            } else {
                slot.state = "inaccessible";
            }
            slot.detail = observation.detail;
        });
    }
    if (evidence.excerpt !== previousExcerpt) {
        throw new Error("Refresh must not replace a stored excerpt");
    }
    if (observation.outcome !== "current" && evidence.checkedAt !== previousCheckedAt) {
        throw new Error("A failed refresh keeps the last successful check");
    }
    const before = identityKeys(dossier);
    const after = identityKeys(next);
    if (
        before.programId !== after.programId ||
        before.cycleIds.join() !== after.cycleIds.join() ||
        before.portfolioCompanyIds.join() !== after.portfolioCompanyIds.join() ||
        before.evidenceIds.join() !== after.evidenceIds.join() ||
        before.tagIds.join() !== after.tagIds.join()
    ) {
        throw new Error("Refresh must keep Program, Cycle, and portfolio-company identity");
    }
    return ProgramIntelligenceSchema.parse(next);
}

export function recordConflict(
    dossier: ProgramIntelligence,
    path: (string | number)[],
    detail: string,
    evidenceIds: string[],
    group: InformationGroup,
    field: string
): ProgramIntelligence {
    const next = structuredClone(dossier);
    let cursor: unknown = next;
    for (const key of path) {
        if (!cursor || typeof cursor !== "object") throw new Error("Conflict path is not a slot");
        cursor = (cursor as Record<string, unknown>)[String(key)];
    }
    if (!isSlot(cursor)) throw new Error("Conflict path is not a slot");
    cursor.state = "conflicting";
    cursor.value = null;
    cursor.claim = null;
    cursor.detail = detail;
    cursor.evidenceIds = evidenceIds;
    const id = reviewId(next.programId, field);
    if (!next.review.some(item => item.id === id)) {
        next.review.push({
            id,
            programId: next.programId,
            group,
            field,
            state: "conflicting",
            evidenceIds,
            detail,
            status: "open",
        });
    }
    return ProgramIntelligenceSchema.parse(next);
}
