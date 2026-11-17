import { listProgramIntelligence } from "@launchstack/pipelines/accelerators/db";
import type {
    DealComponent,
    ProgramIntelligence,
} from "@launchstack/pipelines/accelerators/intelligence";

import type {
    DetailSlot,
    ProgramDetails,
    ProgramDetailsMap,
} from "~/app/employer/tools/accelerators/_lib/details";

/**
 * One entry per page, newest check first wins, carrying the IDs of every excerpt taken
 * from it. A page can contribute dozens of tag sentences; sending each as its own
 * title-and-URL row made the home payload tens of megabytes.
 */
function pagesOf(evidence: ProgramIntelligence["evidence"]): ProgramDetails["sources"] {
    const byUrl = new Map<string, ProgramDetails["sources"][number]>();
    for (const { id, title, url, checkedAt } of evidence) {
        const page = byUrl.get(url);
        if (!page) byUrl.set(url, { title, url, checkedAt, evidenceIds: [id] });
        else {
            page.evidenceIds.push(id);
            if (checkedAt > page.checkedAt) Object.assign(page, { title, checkedAt });
        }
    }
    return [...byUrl.values()];
}

export function programDetails(dossier: ProgramIntelligence): ProgramDetails {
    const componentSlot = (
        components: DealComponent[],
        values: string[]
    ): DetailSlot<string[]> => ({
        state: values.length
            ? "available"
            : dossier.deal.state === "not_checked"
              ? "not_checked"
              : "unavailable",
        value: values.length ? values : null,
        evidenceIds: [
            ...new Set([
                ...components.flatMap(item => item.evidenceIds),
                ...dossier.deal.summary.evidenceIds,
                ...dossier.deal.formatted.evidenceIds,
            ]),
        ],
        claim: values.length ? "fact" : null,
        detail: null,
    });
    const cash = dossier.deal.components.filter(
        item =>
            ["cash", "grant", "safe", "unspecified_investment"].includes(item.kind) &&
            item.amount !== null
    );
    const equity = dossier.deal.components.filter(item => item.equity !== null && !item.contingent);
    const instruments = dossier.tags.filter(tag => tag.facet === "instrument");
    const benefits = dossier.deal.components.filter(
        item => item.kind === "benefit" || item.kind === "credits"
    );
    const dealEvidence = [
        ...new Set([
            ...dossier.deal.summary.evidenceIds,
            ...dossier.deal.formatted.evidenceIds,
            ...dossier.deal.components.flatMap(item => item.evidenceIds),
        ]),
    ];
    return {
        identity: dossier.identity,
        audience: dossier.audience,
        contact: dossier.contact,
        batches: {
            cycles: dossier.batches.cycles,
            historicalCadence: dossier.batches.historicalCadence,
            announcedStarts: dossier.batches.announcedStarts,
            nextDeadline: dossier.batches.nextDeadline,
            residencyEnd: dossier.batches.residencyEnd,
        },
        selectivity: dossier.selectivity,
        deal: {
            summary: dossier.deal.summary,
            formatted: dossier.deal.formatted,
            cash: componentSlot(
                cash,
                cash.map(item =>
                    item.amount && item.currency
                        ? `${item.condition ? `${item.condition} ` : ""}${item.currency} ${item.amount}`
                        : item.label
                )
            ),
            equity: componentSlot(
                equity,
                equity.flatMap(item => (item.equity ? [item.equity] : []))
            ),
            instrument: {
                state: instruments.length
                    ? "available"
                    : dossier.deal.state === "not_checked"
                      ? "not_checked"
                      : "unavailable",
                value: instruments.length ? instruments.map(item => item.label) : null,
                detail: null,
                evidenceIds: instruments.length
                    ? instruments.flatMap(item => item.evidenceIds)
                    : dealEvidence,
                claim: instruments.length ? "fact" : null,
            },
            benefits: (() => {
                const tags = dossier.tags.filter(tag => tag.facet === "benefit");
                const result = componentSlot(benefits, [
                    ...benefits.map(item => item.label),
                    ...tags.map(tag => tag.label),
                ]);
                const evidenceIds = [
                    ...new Set([...result.evidenceIds, ...tags.flatMap(tag => tag.evidenceIds)]),
                ];
                return { ...result, evidenceIds };
            })(),
            comparable: {
                state: dossier.deal.state,
                value: ["available", "partial", "stale"].includes(dossier.deal.state)
                    ? dossier.deal.comparableDilution
                    : null,
                evidenceIds: dealEvidence,
                claim: dealEvidence.length ? "fact" : null,
                detail: dossier.deal.detail,
            },
        },
        portfolio: {
            state: dossier.portfolio.state,
            value: ["available", "partial", "stale"].includes(dossier.portfolio.state)
                ? dossier.portfolio.companies.length
                : null,
            detail: dossier.portfolio.detail,
            claim: null,
            evidenceIds: dossier.portfolio.companies.flatMap(item => item.evidenceIds),
        },
        tags: dossier.tags.map(({ id, facet, label }) => ({ id, facet, label })),
        sources: pagesOf(dossier.evidence),
    };
}

export async function loadProgramDetails(): Promise<ProgramDetailsMap> {
    return Object.fromEntries(
        (await listProgramIntelligence()).map(({ dossier }) => [
            dossier.programId,
            programDetails(dossier),
        ])
    );
}
