/**
 * E2 segments: one industry class of the Norwegian company register
 * (Brønnøysundregistrene, open data). The class is the target, so the whole
 * population is known; the search interface is the register's name search,
 * which returns 20 companies per page in its own order and mixes targets
 * with everything else that shares the word.
 *
 * `plan` is what a planner would write before seeing any result: a handful
 * of words for the kind of company wanted, in the local language and in
 * English. It plays the role of Prospects' planned queries.
 */
export interface RegisterSegment {
    id: string;
    label: string;
    /** Primary NACE code that defines the target (the hidden label). */
    code: string;
    plan: string[];
}

export const SEGMENTS: RegisterSegment[] = [
    {
        id: "no-coffee",
        label: "Coffee and tea processors · Norway",
        code: "10.830",
        plan: ["kaffe", "kaffebrenneri", "te", "brenneri", "coffee"],
    },
    {
        id: "no-brewery",
        label: "Breweries · Norway",
        code: "11.050",
        plan: ["bryggeri", "brygg", "øl", "mikrobryggeri", "brewery", "brewing"],
    },
    {
        id: "no-aquaculture",
        label: "Sea fish farming · Norway",
        code: "03.211",
        plan: ["laks", "oppdrett", "havbruk", "fisk", "sjømat", "seafood", "aqua"],
    },
    {
        id: "no-bakery",
        label: "Bakeries · Norway",
        code: "10.710",
        plan: ["bakeri", "baker", "konditori", "brød", "bakery"],
    },
    {
        id: "no-architect",
        label: "Architecture practices · Norway",
        code: "71.110",
        plan: ["arkitekt", "arkitekter", "arkitektur", "arkitektkontor", "architects"],
    },
    {
        id: "no-dentist",
        label: "Dental practices · Norway",
        code: "86.230",
        plan: ["tannlege", "tannklinikk", "tannhelse", "dental", "tann"],
    },
];
