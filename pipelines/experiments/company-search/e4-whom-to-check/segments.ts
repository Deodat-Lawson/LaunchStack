/**
 * The pools and the segments of experiment 4, written down before any policy
 * ran. A pool is a set of companies with a hidden label; a segment is what a
 * seller would type into the segment form (what it offers, and the buyer
 * types it lists) plus the rule that says which companies in the pool are
 * "good" for it.
 *
 * The brief every policy starts from is production's `buyerBrief` of the
 * offering and the categories; the word-overlap baseline reads the same
 * categories, the way the form stores them.
 */

export type PoolId = "yc" | "brreg-food" | "brreg-drinks" | "brreg-health-bergen";

export interface BrregQuery {
    /** NACE prefix sent to the register's `naeringskode` filter. */
    naeringskode: string;
    /** Municipality number, when the pool is one city. */
    kommunenummer?: string;
}

export interface PoolSpec {
    id: PoolId;
    source: "yc" | "brreg";
    description: string;
    /** Register queries whose union is the pool (Brreg only). */
    queries?: BrregQuery[];
    /** A unit belongs when its primary NACE code starts with one of these (Brreg only). */
    primaryPrefixes?: string[];
    /**
     * The class the pool's segment looks for (Brreg only). A unit that lists it
     * only as a secondary code is left out: its label would be ambiguous.
     */
    targetNace?: string;
}

export const POOLS: PoolSpec[] = [
    {
        id: "yc",
        source: "yc",
        description: "Y Combinator directory: every company with a one-liner",
    },
    {
        id: "brreg-food",
        source: "brreg",
        description: "Norwegian register: food manufacturers (primary NACE code 10.x)",
        queries: [{ naeringskode: "10" }],
        primaryPrefixes: ["10."],
        targetNace: "10.830",
    },
    {
        id: "brreg-drinks",
        source: "brreg",
        description:
            "Norwegian register: beverage manufacturers and bars (primary NACE code 11.x or 56.3x)",
        queries: [{ naeringskode: "11" }, { naeringskode: "56.3" }],
        primaryPrefixes: ["11.", "56.3"],
        targetNace: "11.050",
    },
    {
        id: "brreg-health-bergen",
        source: "brreg",
        description:
            "Norwegian register: health services registered in Bergen (primary NACE code 86.x, municipality 4601)",
        queries: [{ naeringskode: "86", kommunenummer: "4601" }],
        primaryPrefixes: ["86."],
        targetNace: "86.230",
    },
];

/** Which companies of the pool are good for the segment. Never shown to a policy. */
export type LabelRule =
    | {
          kind: "yc";
          /** Good when the company carries any of these tags… */
          tags: string[];
          /** …or its `industry` is one of these… */
          industries: string[];
          /** …or its `subindustry` is one of these. */
          subindustries: string[];
      }
    | {
          kind: "brreg";
          /** Good when the unit's primary NACE code is exactly this. */
          nace: string;
      };

export interface SegmentText {
    /** What the seller offers and to whom, in its own words (the form's "offering"). */
    offering: string;
    /** Buyer types, as the form's category chips hold them. */
    categories: string[];
}

export interface Segment extends SegmentText {
    id: string;
    pool: PoolId;
    /**
     * `reported` segments carry the results. `dev` segments were used to pick
     * hyper-parameters (tune.ts) and are never part of a reported number.
     */
    role: "reported" | "dev";
    /** The label rule in words, for the report. */
    target: string;
    label: LabelRule;
    /**
     * The same segment as a Norwegian seller would type it. Present when the
     * pool's companies write Norwegian: the headline result uses this brief,
     * the first run used the English one above.
     */
    norwegian?: SegmentText;
}

export const SEGMENTS: Segment[] = [
    // ── Reported: Y Combinator directory ────────────────────────────────────
    {
        id: "yc-devtools",
        pool: "yc",
        role: "reported",
        target: "tagged Developer Tools, DevOps or DevSecOps",
        label: {
            kind: "yc",
            tags: ["Developer Tools", "DevOps", "DevSecOps"],
            industries: [],
            subindustries: [],
        },
        offering:
            "Technical writing and developer-relations services for companies whose product is used by software engineers: APIs, SDKs, databases, cloud infrastructure, and testing, deployment and monitoring tools.",
        categories: [
            "developer tools",
            "API and SDK platforms",
            "DevOps and infrastructure software",
        ],
    },
    {
        id: "yc-healthcare",
        pool: "yc",
        role: "reported",
        target: "industry is Healthcare",
        label: { kind: "yc", tags: [], industries: ["Healthcare"], subindustries: [] },
        offering:
            "Regulatory and clinical-compliance consulting for companies building products or services for patients, clinicians, hospitals and insurers: digital health, medical devices, diagnostics, and biotech and drug developers.",
        categories: [
            "healthcare companies",
            "digital health",
            "medical devices",
            "biotech and therapeutics",
        ],
    },
    {
        id: "yc-climate-energy",
        pool: "yc",
        role: "reported",
        target: "sub-industry Energy or Climate, or tagged with a climate or energy tag",
        label: {
            kind: "yc",
            tags: [
                "Climate",
                "ClimateTech",
                "Energy",
                "Renewable Energy",
                "Solar Power",
                "Energy Storage",
                "Carbon Capture and Removal",
                "Hydrogen Energy",
                "Fusion Energy",
                "Electric Vehicles",
                "Sustainability",
            ],
            industries: [],
            subindustries: ["Industrials -> Energy", "Industrials -> Climate"],
        },
        offering:
            "Carbon accounting and life-cycle assessment for companies whose business is cutting emissions or producing clean energy: solar, batteries and energy storage, electric vehicles, carbon removal and energy efficiency.",
        categories: ["climate tech", "clean energy", "carbon removal", "energy storage"],
    },
    {
        id: "yc-logistics",
        pool: "yc",
        role: "reported",
        target: "sub-industry Supply Chain and Logistics, or tagged with a logistics tag",
        label: {
            kind: "yc",
            tags: [
                "Logistics",
                "Supply Chain",
                "Warehouse Management Tech",
                "Autonomous Trucking",
                "Digital Freight Brokerage",
                "Autonomous Shipping",
            ],
            industries: [],
            subindustries: ["B2B -> Supply Chain and Logistics"],
        },
        offering:
            "Cargo insurance and claims handling for companies that move, store or track physical goods: freight forwarders, trucking and delivery fleets, warehouses, and the software that runs supply chains.",
        categories: ["logistics", "freight and shipping", "supply chain software", "warehousing"],
    },

    // ── Reported: Norwegian register (texts in Norwegian) ───────────────────
    // Each has two briefs: English (the first run) and Norwegian (the headline).
    {
        id: "brreg-coffee-tea",
        pool: "brreg-food",
        role: "reported",
        target: "primary NACE code 10.830 (coffee and tea processing)",
        label: { kind: "brreg", nace: "10.830" },
        offering:
            "Green coffee beans and bulk loose-leaf tea, sold by the pallet to businesses that roast coffee or blend and pack tea under their own label.",
        categories: ["coffee roasters", "tea blenders and packers"],
        norwegian: {
            offering:
                "Råkaffe og te i løsvekt, solgt pallevis til bedrifter som brenner kaffe eller blander og pakker te under eget merke.",
            categories: ["kaffebrennerier", "teblandere og tepakkerier"],
        },
    },
    {
        id: "brreg-breweries",
        pool: "brreg-drinks",
        role: "reported",
        target: "primary NACE code 11.050 (beer production)",
        label: { kind: "brreg", nace: "11.050" },
        offering:
            "Brewing malt, hops and yeast in bulk, with recipe support, for companies that brew their own beer: craft breweries, microbreweries and brewpubs.",
        categories: ["breweries", "craft beer producers"],
        norwegian: {
            offering:
                "Malt, humle og gjær i bulk, med hjelp til oppskrifter, for bedrifter som brygger sitt eget øl: håndverksbryggerier, mikrobryggerier og bryggeripuber.",
            categories: ["bryggerier", "ølprodusenter"],
        },
    },
    {
        id: "brreg-dental-bergen",
        pool: "brreg-health-bergen",
        role: "reported",
        target: "primary NACE code 86.230 (dental practice)",
        label: { kind: "brreg", nace: "86.230" },
        offering:
            "Dental consumables, instruments and sterilisation equipment, delivered weekly to dental practices and clinics: general dentists, orthodontists and oral surgeons.",
        categories: ["dental practices", "dentists", "dental clinics"],
        norwegian: {
            offering:
                "Forbruksvarer, instrumenter og steriliseringsutstyr til tannbehandling, levert ukentlig til tannlegekontorer og tannklinikker: allmenntannleger, kjeveortopeder og oralkirurger.",
            categories: ["tannlegekontorer", "tannleger", "tannklinikker"],
        },
    },

    // ── Development only: used by tune.ts, never reported ───────────────────
    {
        id: "yc-education",
        pool: "yc",
        role: "dev",
        target: "industry is Education, or tagged Education, eLearning, AI-Enhanced Learning or Edtech",
        label: {
            kind: "yc",
            tags: ["Education", "eLearning", "AI-Enhanced Learning", "Edtech"],
            industries: ["Education"],
            subindustries: [],
        },
        offering:
            "Curriculum design and learning-science review for companies that teach: online courses, tutoring, school software and learning apps for students and teachers.",
        categories: ["education", "online learning", "tutoring", "school software"],
    },
    {
        id: "yc-fintech",
        pool: "yc",
        role: "dev",
        target: "industry is Fintech",
        label: { kind: "yc", tags: [], industries: ["Fintech"], subindustries: [] },
        offering:
            "Fraud screening and identity verification for companies that move or manage money: payments, lending, banking, insurance, investing and accounting software.",
        categories: ["fintech", "payments", "lending and banking", "insurance"],
    },
];

export function poolSpec(id: PoolId): PoolSpec {
    const spec = POOLS.find(p => p.id === id);
    if (!spec) throw new Error(`Unknown pool ${id}`);
    return spec;
}

export function segmentById(id: string): Segment {
    const segment = SEGMENTS.find(s => s.id === id);
    if (!segment) throw new Error(`Unknown segment ${id}`);
    return segment;
}

export const REPORTED_SEGMENTS = SEGMENTS.filter(s => s.role === "reported");
export const DEV_SEGMENTS = SEGMENTS.filter(s => s.role === "dev");
