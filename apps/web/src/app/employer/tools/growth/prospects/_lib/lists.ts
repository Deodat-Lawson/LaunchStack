import { preloadResource } from "~/lib/tools/useResource";

import { prospectsApi, type CompaniesSort, type CompaniesView, type EmailStatusKind } from "../api";

/** The remembered-result keys of the two directory lists, shared with their preloads. */
export function companiesKey(
    segmentId: string,
    view: CompaniesView = "all",
    sort: CompaniesSort = "fit",
    q = ""
): string {
    return `companies:${segmentId}:${view}:${sort}:${q}`;
}

export function peopleKey(
    segmentId: string,
    status: "all" | EmailStatusKind = "all",
    q = ""
): string {
    return `people:${segmentId}:${status}:${q}`;
}

/** Warm the People tab's default list while Companies is open. */
export function preloadPeople(segmentId: string): void {
    preloadResource(peopleKey(segmentId), () => prospectsApi.people({ segmentId }));
}

/** Warm the Companies tab's default list while People is open. */
export function preloadCompanies(segmentId: string): void {
    preloadResource(companiesKey(segmentId), () =>
        prospectsApi.companies({ segmentId, view: "all", sort: "fit", q: "" })
    );
}
