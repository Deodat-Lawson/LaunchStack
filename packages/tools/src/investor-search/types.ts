/**
 * Investor search: venture funds that have told the SEC they are raising.
 *
 * A fund raising a new vehicle files a Form D, and a fund that has just
 * raised is one about to write cheques. The filings are public, free and
 * keyless, and name the people who run the fund, where it is, how big it is
 * and how much it has closed — which is who to pitch and when.
 */

export interface InvestorSearchQuery {
    /**
     * Words to look for in the filing — in practice the fund's name, which is
     * where a thesis shows ("Climate", "Health", "Seed"). Any word matches.
     */
    keywords?: readonly string[];
    /** Two-letter US state (or SEC location code) of the fund's office. */
    state?: string;
    /** Filings on or after this ISO date. Defaults to twelve months ago. */
    since?: string;
    /** Filings on or before this ISO date. Defaults to today. */
    until?: string;
    /** How many funds to return (default 20, at most 40). */
    limit?: number;
    /**
     * Keep single-deal vehicles — "Acme SPV LP", "Fund A, a series of Acme
     * LLC". They are one investment each, not a fund you pitch, so they are
     * left out unless asked for.
     */
    includeSingleDealVehicles?: boolean;
}

export interface FundManager {
    name: string;
    /**
     * Filers list the general partner too, as an organisation squeezed into
     * the name fields ("General Partner" / "Acme Fund I GP, LLC"). Those are
     * `entity`; the people to write to are `person`, and come first.
     */
    kind: "person" | "entity";
    /** "Executive Officer", "Director", "Promoter". */
    roles: string[];
    /** The filer's own words, e.g. "Managing Member of the General Partner". */
    title?: string;
}

/** One fund, from its latest Form D in the window. */
export interface FundProfile {
    cik: string;
    name: string;
    /** "Palo Alto, CA". */
    location?: string;
    state?: string;
    /** ISO date the filing was made. */
    filedAt: string;
    /** True when the latest filing is an amendment (D/A). */
    amendment: boolean;
    /** The filing on EDGAR, for a human. */
    filingUrl: string;
    phone?: string;
    fundType?: string;
    /** Target size in USD; null when the filer wrote "Indefinite". */
    offeringAmount?: number | null;
    /** Closed so far, in USD. */
    amountSold?: number;
    minimumInvestment?: number;
    investorCount?: number;
    /** ISO date of first sale, or null when it is yet to occur. */
    firstSale?: string | null;
    managers: FundManager[];
    /** False when the details could not be read; the search hit is still real. */
    detailed: boolean;
}

export interface InvestorSearchResult {
    funds: FundProfile[];
    /** Every matching filing in the window, before de-duplication and the limit. */
    totalFilings: number;
    /** Single-deal vehicles seen and left out (see `includeSingleDealVehicles`). */
    singleDealVehiclesHidden: number;
    source: "sec-edgar-form-d";
}
