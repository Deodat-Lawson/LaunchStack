import { listProgramIntelligence } from "@launchstack/pipelines/accelerators/db";
import type {
    DealComponent,
    InformationSlot,
    ProgramIntelligence,
} from "@launchstack/pipelines/accelerators/intelligence";

import type {
    DetailSlot,
    ProgramDetails,
    ProgramDetailsMap,
} from "~/app/employer/tools/accelerators/_lib/details";

export function programDetails(dossier: ProgramIntelligence): ProgramDetails {
    const sources = dossier.evidence.map(({ title, url, checkedAt }) => ({
        title,
        url,
        checkedAt,
    }));
    const sourceOf = (ids: string[]) =>
        dossier.evidence
            .filter(item => ids.includes(item.id))
            .map(({ title, url, checkedAt }) => ({ title, url, checkedAt }));
    const slot = <T>(value: InformationSlot<T>): DetailSlot<T> => ({
        ...value,
        sources: sourceOf(value.evidenceIds),
    });
    const group = <T extends Record<string, InformationSlot<unknown>>>(values: T) =>
        Object.fromEntries(Object.entries(values).map(([key, value]) => [key, slot(value)])) as {
            [K in keyof T]: T[K] & { sources: typeof sources };
        };
    const componentSlot = (components: DealComponent[], values: string[]): DetailSlot<string[]> => {
        const evidenceIds = [
            ...new Set([
                ...components.flatMap(item => item.evidenceIds),
                ...dossier.deal.summary.evidenceIds,
                ...dossier.deal.formatted.evidenceIds,
            ]),
        ];
        return slot({
            state: values.length
                ? "available"
                : dossier.deal.state === "not_checked"
                  ? "not_checked"
                  : "unavailable",
            value: values.length ? values : null,
            evidenceIds,
            claim: values.length ? "fact" : null,
            detail: null,
        });
    };
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
        identity: group(dossier.identity),
        audience: group(dossier.audience),
        contact: group(dossier.contact),
        batches: {
            cycles: dossier.batches.cycles.map(cycle => ({
                ...cycle,
                announcedDeadline: slot(cycle.announcedDeadline),
            })),
            historicalCadence: slot(dossier.batches.historicalCadence),
            announcedStarts: slot(dossier.batches.announcedStarts),
            nextDeadline: slot(dossier.batches.nextDeadline),
            residencyEnd: slot(dossier.batches.residencyEnd),
        },
        selectivity: slot(dossier.selectivity),
        deal: {
            summary: slot(dossier.deal.summary),
            formatted: slot(dossier.deal.formatted),
            cash: componentSlot(
                cash,
                cash.map(item =>
                    item.amount && item.currency
                        ? `${item.currency} ${item.amount}${item.condition ? ` · ${item.condition}` : ""}`
                        : item.label
                )
            ),
            equity: componentSlot(
                equity,
                equity.flatMap(item => (item.equity ? [item.equity] : []))
            ),
            instrument: slot({
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
            }),
            benefits: (() => {
                const tags = dossier.tags.filter(tag => tag.facet === "benefit");
                const result = componentSlot(benefits, [
                    ...benefits.map(item => item.label),
                    ...tags.map(tag => tag.label),
                ]);
                const evidenceIds = [
                    ...new Set([...result.evidenceIds, ...tags.flatMap(tag => tag.evidenceIds)]),
                ];
                return { ...result, evidenceIds, sources: sourceOf(evidenceIds) };
            })(),
            comparable: slot({
                state: dossier.deal.state,
                value: ["available", "partial", "stale"].includes(dossier.deal.state)
                    ? dossier.deal.comparableDilution
                    : null,
                evidenceIds: dealEvidence,
                claim: dealEvidence.length ? "fact" : null,
                detail: dossier.deal.detail,
            }),
        },
        portfolio: slot({
            state: dossier.portfolio.state,
            value: ["available", "partial", "stale"].includes(dossier.portfolio.state)
                ? dossier.portfolio.companies.length
                : null,
            detail: dossier.portfolio.detail,
            claim: null,
            evidenceIds: dossier.portfolio.companies.flatMap(item => item.evidenceIds),
        }),
        tags: dossier.tags.map(tag => ({ ...tag, sources: sourceOf(tag.evidenceIds) })),
        sources,
        evidence: dossier.evidence.map(({ id, title, url, checkedAt }) => ({
            id,
            title,
            url,
            checkedAt,
        })),
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
