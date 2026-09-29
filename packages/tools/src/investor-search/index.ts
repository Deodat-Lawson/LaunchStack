import { getSecUserAgent } from "./config";
import { searchVentureFunds, type EdgarOptions } from "./edgar";
import type { InvestorSearchQuery, InvestorSearchResult } from "./types";

export * from "./types";
export {
    buildSearchUrl,
    documentUrl,
    filingUrl,
    isSingleDealVehicle,
    keywordTerms,
    latestPerFund,
    parseFormD,
    parseSearchResponse,
    relatedPerson,
    resetInvestorSearchCache,
    searchVentureFunds,
    type FilingHit,
    type FormDDetails,
} from "./edgar";

/**
 * Find venture funds raising now, from SEC Form D filings. No key; the
 * User-Agent comes from `SEC_EDGAR_USER_AGENT`.
 */
export function findInvestors(
    query: InvestorSearchQuery,
    options: Omit<EdgarOptions, "userAgent"> & { userAgent?: string } = {}
): Promise<InvestorSearchResult> {
    return searchVentureFunds(query, {
        ...options,
        userAgent: options.userAgent ?? getSecUserAgent(),
    });
}
