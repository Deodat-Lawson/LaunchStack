/**
 * The company profile as the screen sees it — one shape for Settings ›
 * Company and Proposals › Profile, which render the same page. Built on the
 * server from the company-metadata projection and the per-source rows
 * (`~/server/company-profile/adapter`); every value here is the user's
 * vocabulary, not the JSON's.
 */

export type CompanyProfileStatus = "empty" | "building" | "ready" | "failed";

/** What reading a source decided: written by or about us, someone else's, or nothing to read. */
export type SourceRole = "about_us" | "third_party" | "no_content";

/** A person's decision about one source; it outlives new versions of the document. */
export type SourceOverride = "about_us" | "set_aside";

export type ApplicantType = "nonprofit" | "small_business" | "for_profit" | "individual";

/**
 * A fact label the company-metadata view gives a known key, as its message
 * key under `companyProfile.server.factLabels`. A label a person typed has none.
 */
export type FactLabelKey =
    | `company.${"name" | "description" | "industry" | "foundedYear" | "headquarters" | "website" | "size"}`
    | `profile.${
          | "mission"
          | "programs"
          | "beneficiaries"
          | "outcomes"
          | "need"
          | "legalStatus"
          | "annualBudget"
          | "fundingSources"
          | "fundingRaised"
          | "customers"
          | "traction"
          | "businessModel"
          | "pricing"
          | "leadership"
          | "board"
          | "partners"
          | "awards"
          | "theoryOfChange"
          | "evaluation"
          | "plans"
          | "idea"}`;

/** Kinds of text reading drops, as `companyProfile.server.dropWords.<key>`. */
export type DropWordKey =
    | "references"
    | "table"
    | "figure"
    | "boilerplate"
    | "placeholder"
    | "tooShort"
    | "duplicate";

/**
 * A source's `reason` as message data, when the rules wrote it rather than
 * the model: `companyProfile.server.reasons.<key>`.
 */
export type SourceReasonCopy =
    | {
          key:
              | "noReadableText"
              | "sparseMindmap"
              | "tooLittleText"
              | "aboutUs"
              | "thirdParty"
              | "nothingToRead"
              | "stillProcessing";
      }
    | { key: "onlyNoise"; drops: DropWordKey[] };

/** A fixed failure sentence, as `companyProfile.server.failures.<key>`. */
export type ProfileFailureKey = "readingFailed" | "readingFactsFailed" | "buildFailed";

/** One numbered excerpt a fact cites. Only cited excerpts are listed. */
export interface ProfileEvidenceDto {
    n: number;
    documentId: number | null;
    title: string;
    page: number | null;
    quote: string;
    /** Where the source opens in the Studio; null when the viewer cannot open it. */
    href: string | null;
}

/** One labelled fact: "Headquarters", "Mission", "Annual budget". */
export interface ProfileFactDto {
    /** The path PATCH /api/company/profile/facts takes, e.g. "company.headquarters", "profile.facts.mission". */
    path: string;
    label: string;
    /** `label` as a message key, for the screen to word; absent for a typed label. */
    labelKey?: FactLabelKey | null;
    value: string;
    cites: number[];
    source: "documents" | "manual";
}

/** A person, a product or service, or a project. */
export interface ProfileEntryDto {
    /** "people.0", "services.2", "projects.1". */
    path: string;
    name: string;
    /** Role for a person, description for a service or project. */
    detail: string | null;
    /** The path that edits `detail`, e.g. "people.0.role"; null when it cannot be edited. */
    detailPath: string | null;
    cites: number[];
    source: "documents" | "manual";
}

/** One document in the workspace and what the profile did with it. */
export interface ProfileSourceDto {
    documentId: number;
    title: string;
    folder: string;
    /** null until the source has been read. */
    role: SourceRole | null;
    /** Who decided the role: a rule (e.g. an empty mindmap) or the model. */
    roleBy: "rules" | "model" | null;
    /** One sentence for the person: "A research paper by authors at UW and Tencent AI Lab." */
    reason: string | null;
    /** `reason` as message data when the rules wrote it; absent for the model's own words. */
    reasonCopy?: SourceReasonCopy | null;
    override: SourceOverride | null;
    /** Whether its facts count: the override if any, else role === "about_us". */
    counted: boolean;
    /** Facts this source supplies to the profile. */
    facts: number;
    status: "pending" | "done" | "failed";
    /** Why reading it failed, when it did. */
    error: string | null;
    /** `error` as a message key when it is one of the fixed sentences. */
    errorKey?: ProfileFailureKey | null;
    /** Where the source opens in the Studio. */
    href: string;
}

export interface CompanyProfileDto {
    status: CompanyProfileStatus;
    error: string | null;
    /** `error` as a message key when it is the fixed "last build failed". */
    errorKey?: ProfileFailureKey | null;
    builtAt: string | null;
    /** Built under older rules, or a source changed since: a rebuild would differ. */
    stale: boolean;
    /** The workspace's company name, for the empty states. */
    name: string;

    summary: string | null;
    summaryCites: number[];
    applicantType: ApplicantType | null;
    focusAreas: string[];
    geography: string[];
    /** Primary markets and verticals. */
    markets: string[];

    facts: ProfileFactDto[];
    people: ProfileEntryDto[];
    services: ProfileEntryDto[];
    projects: ProfileEntryDto[];
    /** Agreements the organisation is party to: contracts, NDAs, terms. */
    legal: ProfileEntryDto[];

    evidence: ProfileEvidenceDto[];
    sources: ProfileSourceDto[];
    counts: { sources: number; counted: number; setAside: number; pending: number };

    /** settings.manage: may edit facts and decide which sources count. Anyone may rebuild. */
    canEdit: boolean;
}

/** PATCH /api/company/profile/facts — an empty value removes the fact. */
export interface ProfileFactPatch {
    path: string;
    value: string;
    /** Required when adding a new `profile.facts.<key>` fact. */
    label?: string;
    /** Drop the person's edit at `path` and show what the sources say again. */
    reset?: boolean;
}

/** PATCH /api/company/profile/sources/[documentId] — null clears the person's decision. */
export interface ProfileSourcePatch {
    override: SourceOverride | null;
}
