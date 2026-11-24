/**
 * Does the replayed `today` policy do what production does? Runs the real
 * `profileFromPages` on every recorded site, with a `fetchPage` built on the
 * recorder, and compares:
 *  - the URLs it asks for, in order, with the replay's;
 *  - how many pages it counts as read;
 *  - which fact types end up in the dossier it assembles.
 */
import type { ReadablePage } from "@launchstack/tools/web-research";

import type { DossierAgentInput, RecordedEvidence } from "../../../src/distribution/dossier-agent";
import { profileFromPages } from "../../../src/distribution/keyless/profile";
import { MAX_BUDGET, visitToday } from "./policies";
import { FACT, fetchThrough, type FetchContext, type SiteRecord } from "./site";

export interface TodayCheck {
    sites: number;
    /** Sites where production asked for exactly the replay's URLs, in the replay's order. */
    sameRequests: number;
    /** Sites where production counted as many readable pages as the replay. */
    samePageCount: number;
    /** Sites where production's grounding gate let a dossier through. */
    dossiers: number;
    /** Of those, sites where the dossier holds exactly the fact types the replay found. */
    sameFacts: number;
    /** Guessed paths left out because robots.txt disallows them, and the sites they are on. */
    disallowedPaths: number;
    disallowedSites: number;
    /** Ids of sites that differ, for debugging; empty when everything matches. */
    differing: string[];
}

const NO_DESCRIPTION = "The site has no clear description of what the organisation does.";

function inputFor(site: SiteRecord): DossierAgentInput {
    const domain = new URL(site.homeUrl).hostname;
    const epoch = new Date(0);
    return {
        program: {
            id: "e3",
            companyId: BigInt(0),
            createdByUserId: "e3",
            name: "e3-what-to-read",
            offering: "",
            categories: [],
            hsCodes: [],
            targetTerritories: [],
            partnerKinds: [],
            constraints: null,
            knownPartnerDomains: [],
            customerDomains: [],
            status: "active",
            createdAt: epoch,
            updatedAt: null,
        },
        sellerSummary: "",
        org: {
            id: site.id,
            companyId: BigInt(0),
            resolveKey: domain,
            name: domain,
            domain,
            country: null,
            region: null,
            city: null,
            lat: null,
            lng: null,
            roles: [],
            categories: [],
            sizeBand: null,
            description: null,
            kgEntityId: null,
            firstSeenRunId: null,
            lastEnrichedAt: null,
            createdAt: epoch,
            updatedAt: null,
        },
        kind: "distributor",
        // A keyless run always has a territory; without one production's gate rejects
        // a dossier that only holds a description, and the facts could not be compared.
        territory: { country: site.country === "EN" ? "US" : site.country },
        seedUrls: [site.homeUrl],
        hsCodes: [],
    };
}

export async function checkTodayAgainstProduction(
    ctx: FetchContext,
    sites: readonly SiteRecord[]
): Promise<TodayCheck> {
    const check: TodayCheck = {
        sites: sites.length,
        sameRequests: 0,
        samePageCount: 0,
        dossiers: 0,
        sameFacts: 0,
        disallowedPaths: 0,
        disallowedSites: 0,
        differing: [],
    };
    for (const site of sites) {
        const disallowed = new Set(site.guessed.filter(g => !g.allowed).map(g => g.url));
        check.disallowedPaths += disallowed.size;
        if (disallowed.size > 0) check.disallowedSites += 1;

        const asked: string[] = [];
        const fetchPage = async (url: string): Promise<ReadablePage> => {
            if (disallowed.has(url)) throw new Error("robots.txt disallows it; never recorded");
            asked.push(url);
            if (url !== site.homeUrl && site.pages.get(url)?.failure === "abandoned")
                throw new Error("never sent: the site was given up on while recording");
            const fetched = await fetchThrough(ctx, url);
            if (!fetched.ok) throw new Error(fetched.code);
            return fetched.page;
        };
        let evidenceId = 0;
        const recordEvidence = (_evidence: Omit<RecordedEvidence, "id">): Promise<number> =>
            Promise.resolve(++evidenceId);
        const result = await profileFromPages({ fetchPage, recordEvidence }, inputFor(site));

        const replay = visitToday(site, MAX_BUDGET);
        const sameRequests =
            asked.length === replay.asked.length &&
            asked.every((url, i) => url === replay.asked[i]);
        const samePageCount = result.turns === replay.pages;
        if (sameRequests) check.sameRequests += 1;
        if (samePageCount) check.samePageCount += 1;
        let sameFacts = true;
        if (result.outcome.status === "ok") {
            check.dossiers += 1;
            const dossier = result.outcome.dossier;
            let mask = 0;
            if (dossier.contactChannels.length > 0) mask |= FACT.email;
            if (!dossier.openQuestions.includes(NO_DESCRIPTION)) mask |= FACT.description;
            if (dossier.sizeBand !== "unknown") mask |= FACT.staff;
            if (dossier.certifications.length > 0) mask |= FACT.certification;
            if (dossier.roles.length > 0) mask |= FACT.role;
            sameFacts = mask === replay.mask;
            if (sameFacts) check.sameFacts += 1;
        }
        if (!sameRequests || !samePageCount || !sameFacts) check.differing.push(site.id);
    }
    return check;
}
