import type { ApplicantType, SourceRole } from "~/lib/company-profile/dto";

/**
 * The applicant type in the person's words: `companyProfile.applicant.<key>`.
 * There is no "Not stated": an unknown type shows nothing.
 */
export const APPLICANT_KEY = {
    nonprofit: "nonprofit",
    small_business: "smallBusiness",
    for_profit: "forProfit",
    individual: "individual",
} as const satisfies Record<ApplicantType, string>;

/** What reading a source decided, as a quiet label on its row: `companyProfile.sources.roles.<key>`. */
export const ROLE_KEY = {
    about_us: "aboutUs",
    third_party: "thirdParty",
    no_content: "noContent",
} as const satisfies Record<SourceRole, string>;

const FACT_PREFIX = "profile.facts.";
const MAX_KEY = 64;

function trimUnderscores(key: string): string {
    return key.replace(/^_+|_+$/g, "");
}

/**
 * The path a new hand-added fact is stored under: `profile.facts.<slug>`,
 * the slug being the label in `a-z0-9_`, at most 64 characters. A slug some
 * fact already uses gets a numeric suffix, so adding "Mission" twice never
 * overwrites the first one.
 */
export function factPathFor(label: string, taken: Iterable<string> = []): string {
    const used = new Set(taken);
    const base =
        trimUnderscores(
            trimUnderscores(
                label
                    .normalize("NFKD")
                    .replace(/[̀-ͯ]/g, "")
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "_")
            ).slice(0, MAX_KEY)
        ) || "fact";
    let key = base;
    for (let i = 2; used.has(`${FACT_PREFIX}${key}`); i++) {
        const suffix = `_${i}`;
        key = `${trimUnderscores(base.slice(0, MAX_KEY - suffix.length))}${suffix}`;
    }
    return `${FACT_PREFIX}${key}`;
}
