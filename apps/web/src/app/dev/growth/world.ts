/**
 * The fixture world behind `/dev/prospects`: one confirmed segment with a
 * dozen companies at every stage, a draft segment with none, nine sources,
 * and five companies held in reserve that the next run "finds". Names and
 * domains are invented (.example); the shapes are what the real pipeline
 * will produce. Dates are relative to now so the world never goes stale.
 */
import type {
    Claim,
    EmailStatusKind,
    EvidenceItem,
    SalesStage,
    SegmentField,
    Signal,
    SourceKind,
} from "~/app/employer/tools/growth/prospects/api";

export const FIT_THRESHOLD = 70;

const daysAgo = (d: number, hour = 10) => {
    const date = new Date();
    date.setDate(date.getDate() - d);
    date.setHours(hour, 12, 0, 0);
    return date.toISOString();
};
const daysAhead = (d: number) => daysAgo(-d, 9);

export interface WorldSource {
    id: string;
    label: string;
    kind: SourceKind;
    description: string;
    enabled: boolean;
    available: boolean;
    requires: string | null;
    cost: string;
    /** How the next run behaves for this source. */
    run: { finishAtMs: number; found: number; newCompanies: number; detail?: string } | null;
}

export const SOURCES: WorldSource[] = [
    {
        id: "recipe:linkedin-company",
        label: "LinkedIn pages",
        kind: "recipe",
        description: "Company pages read through the search index: size, HQ, industry.",
        enabled: true,
        available: true,
        requires: "EXA_API_KEY",
        cost: "1 credit per query",
        run: { finishAtMs: 1600, found: 41, newCompanies: 2 },
    },
    {
        id: "exa-lookalike",
        label: "Lookalikes",
        kind: "api",
        description: "Companies similar to the customers named in your documents.",
        enabled: true,
        available: true,
        requires: "EXA_API_KEY",
        cost: "1 credit per seed",
        run: { finishAtMs: 3000, found: 29, newCompanies: 1, detail: "of 2 customers" },
    },
    {
        id: "companies-house",
        label: "Companies House",
        kind: "api",
        description: "UK register by SIC code and location. Free.",
        enabled: true,
        available: true,
        requires: "COMPANIES_HOUSE_API_KEY",
        cost: "free",
        run: { finishAtMs: 4200, found: 22, newCompanies: 1, detail: "UK" },
    },
    {
        id: "exa-company",
        label: "Exa search",
        kind: "api",
        description: "Neural company search over the open web.",
        enabled: true,
        available: true,
        requires: "EXA_API_KEY",
        cost: "1 credit per query",
        run: { finishAtMs: 5000, found: 7, newCompanies: 0 },
    },
    {
        id: "serper-maps",
        label: "Google Maps",
        kind: "api",
        description: "Warehouses and depots by city, with website and phone.",
        enabled: true,
        available: true,
        requires: "SERPER_API_KEY",
        cost: "about €0.10 per 1,000 places",
        run: { finishAtMs: 8000, found: 18, newCompanies: 1, detail: "15 cities" },
    },
    {
        id: "osm-overpass",
        label: "OpenStreetMap",
        kind: "api",
        description: "Industrial and logistics sites with a website tag. Free, slower.",
        enabled: false,
        available: true,
        requires: null,
        cost: "free",
        run: null,
    },
    {
        id: "job-boards",
        label: "Hiring boards",
        kind: "signal",
        description:
            "Open warehouse roles on Greenhouse, Lever and Ashby for companies already found.",
        enabled: true,
        available: true,
        requires: null,
        cost: "free",
        run: { finishAtMs: 9800, found: 11, newCompanies: 0, detail: "after shortlist" },
    },
    {
        id: "recipe:trustpilot",
        label: "Trustpilot",
        kind: "recipe",
        description: "Consumer-facing brands by category. Rarely useful for this buyer type.",
        enabled: false,
        available: true,
        requires: "EXA_API_KEY",
        cost: "1 credit per query",
        run: null,
    },
    {
        id: "recipe:glassdoor",
        label: "Glassdoor",
        kind: "recipe",
        description: "Employer pages with headcount and HQ.",
        enabled: true,
        available: false,
        requires: "SERPER_API_KEY",
        cost: "about €1 per 1,000 queries",
        run: null,
    },
];

export interface WorldPerson {
    id: string;
    name: string;
    title: string;
    seniority: string;
    email: string | null;
    emailStatus: EmailStatusKind;
    source: string;
    sourceUrl: string | null;
}

export interface WorldCompany {
    id: string;
    name: string;
    domain: string | null;
    hq: string;
    country: string;
    sizeBand: string | null;
    archetype: string;
    why: string;
    fit: number | null;
    about: Claim[];
    whyFit: Claim[];
    openQuestions: string[];
    signals: Signal[];
    evidence: EvidenceItem[];
    people: WorldPerson[];
    stage: SalesStage;
    ownerName: string | null;
    nextStep: string | null;
    nextStepAt: string | null;
    stageChangedAt: string;
    lastActivityAt: string | null;
    foundVia: Array<{ sourceId: string; url: string | null; at: string }>;
    isNew: boolean;
    excluded: boolean;
    excludedReason: string | null;
    fitBreakdown: {
        archetype: [number, number];
        size: [number, number];
        geography: [number, number];
        signals: [number, number];
        disqualifiers: string[];
    } | null;
    profiledAt: string | null;
    /** Not in the world until the next run completes. */
    reserve?: boolean;
}

const ev = (
    n: number,
    title: string,
    url: string,
    quote: string,
    sourceId: string | null = null
): EvidenceItem => ({
    n,
    title,
    url,
    host: url.replace(/^https?:\/\//, "").split("?")[0]!,
    quote,
    sourceId,
});

/** Two hours ago, so it is always in the past whatever the clock says. */
const lastRun = new Date(Date.now() - 2 * 3_600_000).toISOString();

export const COMPANIES: WorldCompany[] = [
    {
        id: "co-delta",
        name: "Delta Logistics BV",
        domain: "deltalogistics.example",
        hq: "Rotterdam, NL",
        country: "NL",
        sizeBand: "201 to 500",
        archetype: "Fulfilment and 3PL operator",
        why: "Closest peer to a current customer; 340 staff across Rotterdam and Venlo with manual picking on all three sites.",
        fit: 90,
        about: [
            {
                text: "Delta runs e-commerce fulfilment for Benelux DTC brands from Rotterdam and two sites in Venlo, with pick-and-pack, returns and same-day dispatch for the Netherlands.",
                cites: [1],
            },
            {
                text: "About 340 staff per its LinkedIn page, up from roughly 260 two years ago.",
                cites: [2],
            },
            {
                text: "Picking is manual with RF scanners; the operations director has spoken publicly about peak-season staffing pressure.",
                cites: [3],
            },
        ],
        whyFit: [
            {
                text: "Same size band, customer type and country mix as Pickpoint, a current customer.",
                cites: [2],
            },
            {
                text: "Three manual-pick sites is exactly the footprint PickBot pays back fastest on.",
                cites: [1, 3],
            },
            {
                text: "Peak-season staffing is their stated problem, which is the case study we have.",
                cites: [3],
            },
        ],
        openQuestions: ["Which WMS they run; the site mentions integrations but not the vendor."],
        signals: [
            {
                when: "Aug 2026",
                text: "Operations director interviewed on peak-season labour shortages",
                cites: [3],
            },
            { when: "May 2026", text: "Third Venlo site announced", cites: [4] },
        ],
        evidence: [
            ev(
                1,
                "Services page",
                "https://deltalogistics.example/diensten",
                "Fulfilment voor webshops: pick & pack, retouren, same-day levering in heel Nederland vanuit Rotterdam en Venlo."
            ),
            ev(
                2,
                "LinkedIn company page",
                "https://nl.linkedin.com/company/delta-logistics-bv",
                "201-500 employees · Transportation, Logistics, Supply Chain and Storage · Rotterdam",
                "recipe:linkedin-company"
            ),
            ev(
                3,
                "Logistiek.nl interview",
                "https://www.logistiek.example/interview-delta",
                "“In de piek hebben we 120 uitzendkrachten nodig en die zijn er simpelweg niet meer,” zegt operations director Bram de Wit."
            ),
            ev(
                4,
                "Press release",
                "https://deltalogistics.example/nieuws/venlo-3",
                "Delta opent derde vestiging in Venlo: 18.000 m² extra capaciteit voor e-commerce fulfilment."
            ),
        ],
        people: [
            {
                id: "p-delta-1",
                name: "Bram de Wit",
                title: "Operations Director",
                seniority: "Director",
                email: "b.dewit@deltalogistics.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: "https://nl.linkedin.com/in/bram-de-wit",
            },
            {
                id: "p-delta-2",
                name: "Ilse Vermeer",
                title: "Head of Warehouse Automation",
                seniority: "Head",
                email: "i.vermeer@deltalogistics.example",
                emailStatus: "found",
                source: "Team page",
                sourceUrl: "https://deltalogistics.example/team",
            },
            {
                id: "p-delta-3",
                name: "Joris Bakker",
                title: "CFO",
                seniority: "C-level",
                email: "j.bakker@deltalogistics.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: "https://nl.linkedin.com/in/joris-bakker",
            },
            {
                id: "p-delta-4",
                name: "Sales desk",
                title: "Shared inbox",
                seniority: "—",
                email: "sales@deltalogistics.example",
                emailStatus: "generic",
                source: "Website",
                sourceUrl: "https://deltalogistics.example/contact",
            },
        ],
        stage: "meeting",
        ownerName: "Timo Lindqvist",
        nextStep: "Demo on site with the operations director",
        nextStepAt: daysAhead(2),
        stageChangedAt: daysAgo(4),
        lastActivityAt: daysAgo(1),
        foundVia: [
            { sourceId: "exa-company", url: "https://deltalogistics.example", at: daysAgo(21) },
            {
                sourceId: "recipe:linkedin-company",
                url: "https://nl.linkedin.com/company/delta-logistics-bv",
                at: daysAgo(21),
            },
        ],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [25, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(21),
    },
    {
        id: "co-nordlager",
        name: "Nordlager Fulfilment GmbH",
        domain: "nordlager.example",
        hq: "Hamburg, DE",
        country: "DE",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "Runs three DCs around Hamburg for mid-sized e-commerce brands and is hiring six warehouse roles this month.",
        fit: 86,
        about: [
            {
                text: "Nordlager runs three distribution centres around Hamburg and Bremen for mid-sized e-commerce brands, offering pick-and-pack, returns and cross-border shipping to the Nordics.",
                cites: [1],
            },
            {
                text: "Around 140 staff per its LinkedIn page; the company registered a fourth site in Lüneburg in June.",
                cites: [2, 3],
            },
        ],
        whyFit: [
            {
                text: "Operates its own warehouses with manual picking, the case PickBot was built for.",
                cites: [1],
            },
            {
                text: "Six open warehouse-operative roles this month, which usually precedes automation budgets.",
                cites: [4],
            },
            { text: "Same size band and customer type as Delta Logistics.", cites: [2] },
        ],
        openQuestions: ["No public mention of a WMS vendor; ask before proposing integration."],
        signals: [
            { when: "3 days ago", text: "6 warehouse roles posted on Greenhouse", cites: [4] },
            { when: "Jun 2026", text: "Fourth site registered in Lüneburg", cites: [3] },
            {
                when: "Mar 2026",
                text: "Nordics cross-border launch with a postal partner",
                cites: [5],
            },
        ],
        evidence: [
            ev(
                1,
                "Services page",
                "https://nordlager.example/leistungen",
                "Drei Logistikzentren im Raum Hamburg und Bremen: Pick & Pack, Retourenmanagement, Versand nach Skandinavien."
            ),
            ev(
                2,
                "LinkedIn company page",
                "https://de.linkedin.com/company/nordlager",
                "51-200 employees · Logistics and supply chain · Hamburg",
                "recipe:linkedin-company"
            ),
            ev(
                3,
                "Handelsregister entry via North Data",
                "https://www.northdata.example/nordlager",
                "Zweigniederlassung Lüneburg, eingetragen 12.06.2026"
            ),
            ev(
                4,
                "Greenhouse job board",
                "https://boards.greenhouse.example/nordlager",
                "6 open roles: Lagermitarbeiter (m/w/d), Kommissionierer, Schichtleiter Wareneingang",
                "job-boards"
            ),
            ev(
                5,
                "Press",
                "https://logistik-heute.example/nordlager-nordics",
                "Nordlager startet gemeinsam mit einem skandinavischen Postpartner einen Nordics-Service für Onlinehändler."
            ),
        ],
        people: [
            {
                id: "p-nord-1",
                name: "Maren Kühl",
                title: "Head of Operations",
                seniority: "Head",
                email: "m.kuehl@nordlager.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: "https://de.linkedin.com/in/maren-kuehl",
            },
            {
                id: "p-nord-2",
                name: "Jonas Brandt",
                title: "Managing Director",
                seniority: "C-level",
                email: "brandt@nordlager.example",
                emailStatus: "found",
                source: "Impressum",
                sourceUrl: "https://nordlager.example/impressum",
            },
            {
                id: "p-nord-3",
                name: "Sina Lorenz",
                title: "Site Manager, Bremen",
                seniority: "Manager",
                email: "s.lorenz@nordlager.example",
                emailStatus: "guess",
                source: "Pattern",
                sourceUrl: "https://de.linkedin.com/in/sina-lorenz",
            },
        ],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: lastRun,
        lastActivityAt: null,
        foundVia: [
            {
                sourceId: "recipe:linkedin-company",
                url: "https://de.linkedin.com/company/nordlager",
                at: lastRun,
            },
            {
                sourceId: "job-boards",
                url: "https://boards.greenhouse.example/nordlager",
                at: lastRun,
            },
        ],
        isNew: true,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [21, 25],
            disqualifiers: [],
        },
        profiledAt: lastRun,
    },
    {
        id: "co-bramble",
        name: "Bramble & Co Fulfilment",
        domain: "brambleco.example",
        hq: "Leeds, GB",
        country: "GB",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "UK 3PL for DTC brands with 120 staff; opened a second site in 2026 and still picks by hand.",
        fit: 81,
        about: [
            {
                text: "Bramble & Co runs fulfilment for UK direct-to-consumer brands from two sites in Leeds, with subscription-box assembly as a specialism.",
                cites: [1],
            },
            {
                text: "Companies House shows steady growth since 2019; LinkedIn puts headcount at 51 to 200.",
                cites: [2, 3],
            },
        ],
        whyFit: [
            {
                text: "Two sites with manual picking and a second site opened this year, so throughput is the current problem.",
                cites: [1, 4],
            },
            {
                text: "Subscription-box kitting is the repetitive pick profile robots handle best.",
                cites: [1],
            },
        ],
        openQuestions: [
            "Whether the second site is leased short-term; that changes the automation case.",
        ],
        signals: [{ when: "Feb 2026", text: "Second Leeds site opened", cites: [4] }],
        evidence: [
            ev(
                1,
                "Homepage",
                "https://brambleco.example",
                "Fulfilment for DTC brands who care about the unboxing. Two Leeds sites, subscription kitting, next-day UK."
            ),
            ev(
                2,
                "Companies House",
                "https://find-and-update.company-information.service.gov.example/company/11223344",
                "BRAMBLE & CO FULFILMENT LIMITED · Active · SIC 52103 Operation of warehousing and storage facilities for land transport activities",
                "companies-house"
            ),
            ev(
                3,
                "LinkedIn company page",
                "https://uk.linkedin.com/company/bramble-co-fulfilment",
                "51-200 employees · Leeds, England",
                "recipe:linkedin-company"
            ),
            ev(
                4,
                "Yorkshire Post",
                "https://www.yorkshirepost.example/bramble-second-site",
                "Leeds fulfilment firm Bramble & Co opens second warehouse as subscription box demand grows."
            ),
        ],
        people: [
            {
                id: "p-bram-1",
                name: "Priya Nair",
                title: "Operations Director",
                seniority: "Director",
                email: "priya@brambleco.example",
                emailStatus: "found",
                source: "About page",
                sourceUrl: "https://brambleco.example/about",
            },
            {
                id: "p-bram-2",
                name: "Tom Hartley",
                title: "Founder",
                seniority: "Founder",
                email: "tom@brambleco.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: "https://uk.linkedin.com/in/tom-hartley",
            },
        ],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: lastRun,
        lastActivityAt: null,
        foundVia: [
            {
                sourceId: "companies-house",
                url: "https://find-and-update.company-information.service.gov.example/company/11223344",
                at: lastRun,
            },
            {
                sourceId: "recipe:linkedin-company",
                url: "https://uk.linkedin.com/company/bramble-co-fulfilment",
                at: lastRun,
            },
        ],
        isNew: true,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [16, 25],
            disqualifiers: [],
        },
        profiledAt: lastRun,
    },
    {
        id: "co-tulip",
        name: "Tulip Post Distribution",
        domain: "tulippost.example",
        hq: "Utrecht, NL",
        country: "NL",
        sizeBand: "201 to 500",
        archetype: "Fulfilment and 3PL operator",
        why: "Dutch e-commerce fulfilment with about 200 staff, found as a lookalike of Delta Logistics.",
        fit: 78,
        about: [
            {
                text: "Tulip Post handles storage, picking and parcel consolidation for Dutch web shops from a single large site near Utrecht.",
                cites: [1],
            },
            {
                text: "Headcount 201 to 500 on LinkedIn, and the site advertises evening shifts year-round.",
                cites: [2, 1],
            },
        ],
        whyFit: [
            {
                text: "One large manual-pick site with evening shifts is a strong automation case.",
                cites: [1],
            },
            {
                text: "Surfaced as the nearest lookalike of Delta Logistics, which is already in a meeting.",
                cites: [2],
            },
        ],
        openQuestions: ["No people found yet; the team page lists no names."],
        signals: [],
        evidence: [
            ev(
                1,
                "Careers page",
                "https://tulippost.example/werken-bij",
                "Wij zoeken het hele jaar door orderpickers voor de avondploeg (17:00–01:00) in Utrecht."
            ),
            ev(
                2,
                "LinkedIn company page",
                "https://nl.linkedin.com/company/tulip-post",
                "201-500 employees · Utrecht",
                "recipe:linkedin-company"
            ),
        ],
        people: [],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: lastRun,
        lastActivityAt: null,
        foundVia: [{ sourceId: "exa-lookalike", url: "https://tulippost.example", at: lastRun }],
        isNew: true,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [16, 20],
            geography: [15, 15],
            signals: [17, 25],
            disqualifiers: [],
        },
        profiledAt: lastRun,
    },
    {
        id: "co-hanse",
        name: "Hanse Warehousing",
        domain: "hanse-wh.example",
        hq: "Bremen, DE",
        country: "DE",
        sizeBand: "51 to 200",
        archetype: "Contract logistics",
        why: "Contract logistics in Bremen running SAP EWM; more pallets than parcels, so a partial fit.",
        fit: 64,
        about: [
            {
                text: "Hanse Warehousing provides contract logistics and bonded storage at the port of Bremen, mostly pallet-level for industrial clients, with a smaller parcel operation.",
                cites: [1],
            },
            { text: "The LinkedIn page names SAP EWM as the warehouse system.", cites: [2] },
        ],
        whyFit: [
            {
                text: "The parcel operation is small, so the picking volume may not justify robots yet.",
                cites: [1],
            },
            { text: "SAP EWM is an integration we already have.", cites: [2] },
        ],
        openQuestions: ["Size of the parcel side; the site gives no volumes."],
        signals: [],
        evidence: [
            ev(
                1,
                "Services page",
                "https://hanse-wh.example/leistungen",
                "Kontraktlogistik und Zolllager am Bremer Hafen. Palettenlager, Kommissionierung, Paketversand für ausgewählte Kunden."
            ),
            ev(
                2,
                "LinkedIn company page",
                "https://de.linkedin.com/company/hanse-warehousing",
                "51-200 employees · Bremen · Specialties: SAP EWM, Zolllager, Kontraktlogistik",
                "recipe:linkedin-company"
            ),
        ],
        people: [
            {
                id: "p-hanse-1",
                name: "Dirk Albers",
                title: "Leiter Logistik",
                seniority: "Head",
                email: "d.albers@hanse-wh.example",
                emailStatus: "found",
                source: "Team page",
                sourceUrl: "https://hanse-wh.example/team",
            },
            {
                id: "p-hanse-2",
                name: "Katrin Seidel",
                title: "Geschäftsführerin",
                seniority: "C-level",
                email: "k.seidel@hanse-wh.example",
                emailStatus: "guess",
                source: "Pattern",
                sourceUrl: "https://de.linkedin.com/in/katrin-seidel",
            },
        ],
        stage: "contacted",
        ownerName: "Timo Lindqvist",
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(12),
        lastActivityAt: daysAgo(12),
        foundVia: [
            {
                sourceId: "recipe:linkedin-company",
                url: "https://de.linkedin.com/company/hanse-warehousing",
                at: daysAgo(21),
            },
            {
                sourceId: "serper-maps",
                url: "https://maps.google.example/?cid=hanse",
                at: daysAgo(21),
            },
        ],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [18, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [11, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(21),
    },
    {
        id: "co-northgate",
        name: "Northgate 3PL",
        domain: "northgate3pl.example",
        hq: "Manchester, GB",
        country: "GB",
        sizeBand: "201 to 500",
        archetype: "Fulfilment and 3PL operator",
        why: "Manchester 3PL with 300 staff and a stated automation roadmap; proposal sent last week.",
        fit: 83,
        about: [
            {
                text: "Northgate runs multi-client fulfilment from two Manchester sites for fashion and beauty brands, with returns processing as a second line.",
                cites: [1],
            },
            {
                text: "The CEO told a trade publication that automation is “the 2027 project”.",
                cites: [2],
            },
        ],
        whyFit: [
            {
                text: "Two manual sites, fashion returns, and an automation roadmap already on the record.",
                cites: [1, 2],
            },
        ],
        openQuestions: [],
        signals: [
            { when: "Jul 2026", text: "CEO names automation as the 2027 project", cites: [2] },
        ],
        evidence: [
            ev(
                1,
                "Homepage",
                "https://northgate3pl.example",
                "Fashion and beauty fulfilment from Manchester. Two sites, 300 people, returns processed within 48 hours."
            ),
            ev(
                2,
                "Logistics Manager interview",
                "https://www.logisticsmanager.example/northgate",
                "“We have squeezed what we can from process. Automation is the 2027 project,” said chief executive Aisha Rahman."
            ),
        ],
        people: [
            {
                id: "p-ng-1",
                name: "Aisha Rahman",
                title: "Chief Executive",
                seniority: "C-level",
                email: "aisha.rahman@northgate3pl.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: "https://uk.linkedin.com/in/aisha-rahman",
            },
            {
                id: "p-ng-2",
                name: "Callum Reid",
                title: "Head of Operations",
                seniority: "Head",
                email: "callum.reid@northgate3pl.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: "https://uk.linkedin.com/in/callum-reid",
            },
            {
                id: "p-ng-3",
                name: "Beth Okafor",
                title: "Continuous Improvement Lead",
                seniority: "Lead",
                email: "beth.okafor@northgate3pl.example",
                emailStatus: "found",
                source: "Team page",
                sourceUrl: "https://northgate3pl.example/people",
            },
        ],
        stage: "proposal",
        ownerName: "Timo Lindqvist",
        nextStep: "Proposal review call",
        nextStepAt: daysAhead(0),
        stageChangedAt: daysAgo(6),
        lastActivityAt: daysAgo(2),
        foundVia: [
            {
                sourceId: "companies-house",
                url: "https://find-and-update.company-information.service.gov.example/company/09876543",
                at: daysAgo(40),
            },
        ],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [16, 20],
            geography: [15, 15],
            signals: [22, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(40),
    },
    {
        id: "co-vandijk",
        name: "Van Dijk E-logistics",
        domain: "vandijk-elog.example",
        hq: "Venlo, NL",
        country: "NL",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "Venlo e-commerce fulfilment for German web shops; asked for pricing after the intro call.",
        fit: 71,
        about: [
            {
                text: "Van Dijk fulfils orders for German web shops from Venlo, using the border location for next-day delivery into Germany.",
                cites: [1],
            },
        ],
        whyFit: [
            {
                text: "Single manual site, German customer base, and they asked for pricing unprompted.",
                cites: [1],
            },
        ],
        openQuestions: [],
        signals: [],
        evidence: [
            ev(
                1,
                "Homepage",
                "https://vandijk-elog.example",
                "E-commerce fulfilment vanuit Venlo voor Duitse webshops. Vandaag besteld, morgen in Duitsland."
            ),
        ],
        people: [
            {
                id: "p-vd-1",
                name: "Femke van Dijk",
                title: "Directeur",
                seniority: "C-level",
                email: "femke@vandijk-elog.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: null,
            },
            {
                id: "p-vd-2",
                name: "Ruud Peeters",
                title: "Warehouse Manager",
                seniority: "Manager",
                email: "r.peeters@vandijk-elog.example",
                emailStatus: "found",
                source: "Team page",
                sourceUrl: "https://vandijk-elog.example/team",
            },
            {
                id: "p-vd-3",
                name: "Info",
                title: "Shared inbox",
                seniority: "—",
                email: "info@vandijk-elog.example",
                emailStatus: "generic",
                source: "Website",
                sourceUrl: null,
            },
        ],
        stage: "contacted",
        ownerName: "Sara Keller",
        nextStep: "Send pricing for one site",
        nextStepAt: daysAhead(1),
        stageChangedAt: daysAgo(3),
        lastActivityAt: daysAgo(3),
        foundVia: [
            {
                sourceId: "serper-maps",
                url: "https://maps.google.example/?cid=vandijk",
                at: daysAgo(21),
            },
        ],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [6, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(21),
    },
    {
        id: "co-meadow",
        name: "Meadow Fulfilment Ltd",
        domain: "meadowfulfilment.example",
        hq: "Milton Keynes, GB",
        country: "GB",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "Milton Keynes fulfilment for food and drink brands with chilled storage; qualified, no owner yet.",
        fit: 74,
        about: [
            {
                text: "Meadow runs ambient and chilled fulfilment for UK food and drink brands from one Milton Keynes site.",
                cites: [1],
            },
        ],
        whyFit: [
            {
                text: "Chilled picking is labour-heavy and hard to staff, which strengthens the case.",
                cites: [1],
            },
        ],
        openQuestions: ["Whether the chilled area is large enough for a robot fleet."],
        signals: [],
        evidence: [
            ev(
                1,
                "Services page",
                "https://meadowfulfilment.example/services",
                "Ambient and chilled storage, pick and pack, and DPD next-day for food and drink brands."
            ),
        ],
        people: [
            {
                id: "p-mead-1",
                name: "Owen Gray",
                title: "Managing Director",
                seniority: "C-level",
                email: "owen@meadowfulfilment.example",
                emailStatus: "found",
                source: "About page",
                sourceUrl: "https://meadowfulfilment.example/about",
            },
            {
                id: "p-mead-2",
                name: "Hannah Price",
                title: "Head of Operations",
                seniority: "Head",
                email: "h.price@meadowfulfilment.example",
                emailStatus: "guess",
                source: "Pattern",
                sourceUrl: null,
            },
        ],
        stage: "qualified",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(5),
        lastActivityAt: daysAgo(5),
        foundVia: [{ sourceId: "companies-house", url: null, at: daysAgo(21) }],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [9, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(21),
    },
    {
        id: "co-zuiderzee",
        name: "Zuiderzee Fulfilment",
        domain: "zuiderzee.example",
        hq: "Almere, NL",
        country: "NL",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "Almere fulfilment operator negotiating a two-robot pilot; procurement is reviewing terms.",
        fit: 66,
        about: [
            {
                text: "Zuiderzee runs fulfilment for Dutch home and garden web shops from Almere.",
                cites: [1],
            },
        ],
        whyFit: [
            {
                text: "Already negotiating a pilot; fit is moderate because volumes are seasonal.",
                cites: [1],
            },
        ],
        openQuestions: [],
        signals: [],
        evidence: [
            ev(
                1,
                "Homepage",
                "https://zuiderzee.example",
                "Fulfilment voor tuin- en wooncollecties. Seizoenspieken vangen wij op met flexibele capaciteit in Almere."
            ),
        ],
        people: [
            {
                id: "p-zz-1",
                name: "Niels Jansen",
                title: "COO",
                seniority: "C-level",
                email: "n.jansen@zuiderzee.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: null,
            },
            {
                id: "p-zz-2",
                name: "Lotte de Groot",
                title: "Procurement",
                seniority: "Manager",
                email: "l.degroot@zuiderzee.example",
                emailStatus: "found",
                source: "Email thread",
                sourceUrl: null,
            },
        ],
        stage: "negotiating",
        ownerName: "Timo Lindqvist",
        nextStep: "Return redlined pilot agreement",
        nextStepAt: daysAhead(3),
        stageChangedAt: daysAgo(9),
        lastActivityAt: daysAgo(2),
        foundVia: [
            { sourceId: "exa-lookalike", url: "https://zuiderzee.example", at: daysAgo(40) },
        ],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [1, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(40),
    },
    {
        id: "co-lls",
        name: "Lager & Logistik Süd",
        domain: "lls-sued.example",
        hq: "Nürnberg, DE",
        country: "DE",
        sizeBand: "201 to 500",
        archetype: "Fulfilment and 3PL operator",
        why: "Nuremberg fulfilment operator; signed for a six-robot deployment in August.",
        fit: 77,
        about: [
            {
                text: "LLS runs fulfilment for sporting-goods brands from two sites near Nuremberg.",
                cites: [1],
            },
        ],
        whyFit: [{ text: "Won. Reference customer for southern Germany.", cites: [1] }],
        openQuestions: [],
        signals: [],
        evidence: [
            ev(
                1,
                "Homepage",
                "https://lls-sued.example",
                "Fulfilment für Sportartikelmarken aus Nürnberg: zwei Standorte, 24-Stunden-Versand."
            ),
        ],
        people: [
            {
                id: "p-lls-1",
                name: "Stefan Huber",
                title: "Geschäftsführer",
                seniority: "C-level",
                email: "s.huber@lls-sued.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: null,
            },
            {
                id: "p-lls-2",
                name: "Anja Wolf",
                title: "Leiterin Intralogistik",
                seniority: "Head",
                email: "a.wolf@lls-sued.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: null,
            },
        ],
        stage: "won",
        ownerName: "Sara Keller",
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(30),
        lastActivityAt: daysAgo(8),
        foundVia: [
            {
                sourceId: "recipe:linkedin-company",
                url: "https://de.linkedin.com/company/lls-sued",
                at: daysAgo(90),
            },
        ],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [16, 20],
            geography: [15, 15],
            signals: [16, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(90),
    },
    {
        id: "co-pakket",
        name: "Pakketpartner",
        domain: "pakketpartner.example",
        hq: "Eindhoven, NL",
        country: "NL",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "Eindhoven fulfilment operator; interested but budget is next year.",
        fit: 69,
        about: [
            {
                text: "Pakketpartner fulfils orders for electronics web shops from Eindhoven.",
                cites: [1],
            },
        ],
        whyFit: [{ text: "Good fit on profile; timing is the issue.", cites: [1] }],
        openQuestions: [],
        signals: [],
        evidence: [
            ev(
                1,
                "Homepage",
                "https://pakketpartner.example",
                "Fulfilment voor elektronica-webshops. Serienummerregistratie en veilige opslag in Eindhoven."
            ),
        ],
        people: [
            {
                id: "p-pak-1",
                name: "Mark Hendriks",
                title: "Operations Manager",
                seniority: "Manager",
                email: "m.hendriks@pakketpartner.example",
                emailStatus: "found",
                source: "Team page",
                sourceUrl: null,
            },
        ],
        stage: "nurture",
        ownerName: "Sara Keller",
        nextStep: "Check in after their January budget round",
        nextStepAt: daysAhead(120),
        stageChangedAt: daysAgo(15),
        lastActivityAt: daysAgo(15),
        foundVia: [{ sourceId: "serper-maps", url: null, at: daysAgo(40) }],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [4, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(40),
    },
    {
        id: "co-boxwise",
        name: "Boxwise Fulfilment",
        domain: "boxwise.example",
        hq: "Berlin, DE",
        country: "DE",
        sizeBand: "11 to 50",
        archetype: "Fulfilment and 3PL operator",
        why: "Small Berlin fulfilment startup, under 50 staff; below the size band.",
        fit: 52,
        about: [
            {
                text: "Boxwise is a Berlin fulfilment startup serving small DTC brands from one site.",
                cites: [1],
            },
        ],
        whyFit: [
            {
                text: "Right buyer type, but below fifty staff, which is a disqualifier for now.",
                cites: [1],
            },
        ],
        openQuestions: [],
        signals: [],
        evidence: [
            ev(
                1,
                "LinkedIn company page",
                "https://de.linkedin.com/company/boxwise",
                "11-50 employees · Berlin",
                "recipe:linkedin-company"
            ),
        ],
        people: [
            {
                id: "p-box-1",
                name: "Lena Fischer",
                title: "Co-founder",
                seniority: "Founder",
                email: "lena@boxwise.example",
                emailStatus: "guess",
                source: "Pattern",
                sourceUrl: null,
            },
        ],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(21),
        lastActivityAt: null,
        foundVia: [
            {
                sourceId: "recipe:linkedin-company",
                url: "https://de.linkedin.com/company/boxwise",
                at: daysAgo(21),
            },
        ],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [4, 20],
            geography: [15, 15],
            signals: [3, 25],
            disqualifiers: ["Under 50 staff"],
        },
        profiledAt: daysAgo(21),
    },
    {
        id: "co-stellar",
        name: "Stellar Storage Solutions",
        domain: "stellarstorage.example",
        hq: "Birmingham, GB",
        country: "GB",
        sizeBand: "51 to 200",
        archetype: "Contract logistics",
        why: "Birmingham storage and pallet operator; little parcel picking.",
        fit: 61,
        about: [
            {
                text: "Stellar offers pallet storage and B2B distribution from Birmingham.",
                cites: [1],
            },
        ],
        whyFit: [
            {
                text: "Mostly pallets; the fit rests on a small e-commerce line mentioned once.",
                cites: [1],
            },
        ],
        openQuestions: ["Size of the e-commerce line."],
        signals: [],
        evidence: [
            ev(
                1,
                "Services page",
                "https://stellarstorage.example/services",
                "Pallet storage, B2B distribution and a growing e-commerce fulfilment service from our Birmingham hub."
            ),
        ],
        people: [],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(21),
        lastActivityAt: null,
        foundVia: [{ sourceId: "companies-house", url: null, at: daysAgo(21) }],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [16, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [10, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(21),
    },
    {
        id: "co-rhein",
        name: "Rhein Cargo Services",
        domain: "rheincargo.example",
        hq: "Duisburg, DE",
        country: "DE",
        sizeBand: "201 to 500",
        archetype: "Freight forwarder",
        why: "Freight forwarder without its own warehouse; marked not a fit.",
        fit: 38,
        about: [
            {
                text: "Rhein Cargo is a freight forwarder arranging road and barge transport from Duisburg; storage is subcontracted.",
                cites: [1],
            },
        ],
        whyFit: [{ text: "No own warehouse, so nothing to automate.", cites: [1] }],
        openQuestions: [],
        signals: [],
        evidence: [
            ev(
                1,
                "Services page",
                "https://rheincargo.example/leistungen",
                "Spedition für Straße und Binnenschiff. Lagerung über Partnerbetriebe."
            ),
        ],
        people: [],
        stage: "lost",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(3),
        lastActivityAt: daysAgo(3),
        foundVia: [{ sourceId: "serper-maps", url: null, at: daysAgo(21) }],
        isNew: false,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [4, 30],
            size: [16, 20],
            geography: [15, 15],
            signals: [3, 25],
            disqualifiers: ["No own warehouse", "Freight only"],
        },
        profiledAt: daysAgo(21),
    },
    {
        id: "co-globex",
        name: "Globex Logistics",
        domain: "globex.example",
        hq: "Amsterdam, NL",
        country: "NL",
        sizeBand: "201 to 500",
        archetype: "Fulfilment and 3PL operator",
        why: "Existing customer under the Globex MSA; excluded from every run.",
        fit: null,
        about: [],
        whyFit: [],
        openQuestions: [],
        signals: [],
        evidence: [],
        people: [
            {
                id: "p-glo-1",
                name: "Eva Smit",
                title: "Head of Operations",
                seniority: "Head",
                email: "e.smit@globex.example",
                emailStatus: "verified",
                source: "CRM",
                sourceUrl: null,
            },
        ],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(60),
        lastActivityAt: null,
        foundVia: [],
        isNew: false,
        excluded: true,
        excludedReason: "Existing customer (Globex MSA 2026)",
        fitBreakdown: null,
        profiledAt: null,
    },
    {
        id: "co-pickpoint",
        name: "Pickpoint Fulfilment",
        domain: "pickpoint.example",
        hq: "Rotterdam, NL",
        country: "NL",
        sizeBand: "201 to 500",
        archetype: "Fulfilment and 3PL operator",
        why: "Existing customer; the seed for lookalike searches.",
        fit: null,
        about: [],
        whyFit: [],
        openQuestions: [],
        signals: [],
        evidence: [],
        people: [],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(60),
        lastActivityAt: null,
        foundVia: [],
        isNew: false,
        excluded: true,
        excludedReason: "Existing customer (proposal signed Mar 2026)",
        fitBreakdown: null,
        profiledAt: null,
    },
    // ── Reserve: found by the next run ──
    {
        id: "co-orchard",
        name: "Orchard & Field 3PL",
        domain: "orchardfield.example",
        hq: "Bristol, GB",
        country: "GB",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "Bristol 3PL for food and gift brands with two manual-pick sites and a night shift.",
        fit: 84,
        about: [
            {
                text: "Orchard & Field runs fulfilment for West Country food and gift brands from two Bristol sites, with a night shift through the autumn peak.",
                cites: [1, 2],
            },
        ],
        whyFit: [
            { text: "Two manual sites with a seasonal night shift.", cites: [1] },
            { text: "Size and customer type match Bramble & Co, already a lead.", cites: [2] },
        ],
        openQuestions: [],
        signals: [{ when: "This week", text: "4 picker roles posted on Lever", cites: [3] }],
        evidence: [
            ev(
                1,
                "Homepage",
                "https://orchardfield.example",
                "Fulfilment for food and gift brands from two Bristol warehouses. Night shift from September to December."
            ),
            ev(
                2,
                "LinkedIn company page",
                "https://uk.linkedin.com/company/orchard-field-3pl",
                "51-200 employees · Bristol",
                "recipe:linkedin-company"
            ),
            ev(
                3,
                "Lever job board",
                "https://jobs.lever.example/orchardfield",
                "Warehouse Operative (x4) · Bristol · Nights",
                "job-boards"
            ),
        ],
        people: [
            {
                id: "p-orch-1",
                name: "George Ellis",
                title: "Operations Director",
                seniority: "Director",
                email: "george@orchardfield.example",
                emailStatus: "verified",
                source: "Hunter",
                sourceUrl: null,
            },
            {
                id: "p-orch-2",
                name: "Mia Thornton",
                title: "Founder",
                seniority: "Founder",
                email: "mia@orchardfield.example",
                emailStatus: "found",
                source: "About page",
                sourceUrl: null,
            },
        ],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(0),
        lastActivityAt: null,
        foundVia: [
            {
                sourceId: "recipe:linkedin-company",
                url: "https://uk.linkedin.com/company/orchard-field-3pl",
                at: daysAgo(0),
            },
            {
                sourceId: "job-boards",
                url: "https://jobs.lever.example/orchardfield",
                at: daysAgo(0),
            },
        ],
        isNew: true,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [19, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(0),
        reserve: true,
    },
    {
        id: "co-kanaal",
        name: "Kanaal Fulfilment",
        domain: "kanaal-ful.example",
        hq: "Amsterdam, NL",
        country: "NL",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "Amsterdam fulfilment for fashion web shops; second site under construction.",
        fit: 79,
        about: [
            {
                text: "Kanaal handles fashion fulfilment and returns for Amsterdam web shops and is building a second site in Zaandam.",
                cites: [1],
            },
        ],
        whyFit: [
            {
                text: "A second site under construction is the moment automation gets designed in.",
                cites: [1],
            },
        ],
        openQuestions: [],
        signals: [{ when: "Sep 2026", text: "Second site in Zaandam announced", cites: [1] }],
        evidence: [
            ev(
                1,
                "News page",
                "https://kanaal-ful.example/nieuws",
                "In 2027 openen wij een tweede locatie in Zaandam met 12.000 m² voor fashion fulfilment en retouren."
            ),
        ],
        people: [
            {
                id: "p-kan-1",
                name: "Daan Visser",
                title: "Operations Lead",
                seniority: "Lead",
                email: "d.visser@kanaal-ful.example",
                emailStatus: "found",
                source: "Team page",
                sourceUrl: null,
            },
        ],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(0),
        lastActivityAt: null,
        foundVia: [
            { sourceId: "exa-lookalike", url: "https://kanaal-ful.example", at: daysAgo(0) },
        ],
        isNew: true,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [14, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(0),
        reserve: true,
    },
    {
        id: "co-rpp",
        name: "Rotterdam Pick & Pack",
        domain: "rpp.example",
        hq: "Rotterdam, NL",
        country: "NL",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "Rotterdam pick-and-pack specialist for beauty brands; one busy site.",
        fit: 75,
        about: [
            {
                text: "RPP runs pick-and-pack for beauty and personal-care brands from one Rotterdam site.",
                cites: [1],
            },
        ],
        whyFit: [
            { text: "High-SKU, small-item picking is where robots outperform most.", cites: [1] },
        ],
        openQuestions: [],
        signals: [],
        evidence: [
            ev(
                1,
                "Homepage",
                "https://rpp.example",
                "Pick & pack voor beautymerken. 9.000 SKU's, same-day cut-off 16:00."
            ),
        ],
        people: [],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(0),
        lastActivityAt: null,
        foundVia: [
            {
                sourceId: "serper-maps",
                url: "https://maps.google.example/?cid=rpp",
                at: daysAgo(0),
            },
        ],
        isNew: true,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [10, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(0),
        reserve: true,
    },
    {
        id: "co-weser",
        name: "Weser Logistik Services",
        domain: "weser-ls.example",
        hq: "Bremen, DE",
        country: "DE",
        sizeBand: "51 to 200",
        archetype: "Fulfilment and 3PL operator",
        why: "Bremen e-commerce fulfilment; found via Companies House's German counterpart listing a UK branch.",
        fit: 72,
        about: [
            {
                text: "Weser runs e-commerce fulfilment for outdoor brands from Bremen, with a UK branch for post-Brexit returns.",
                cites: [1],
            },
        ],
        whyFit: [
            {
                text: "Manual picking on one site; the UK branch means a second automation candidate later.",
                cites: [1],
            },
        ],
        openQuestions: [],
        signals: [],
        evidence: [
            ev(
                1,
                "Companies House",
                "https://find-and-update.company-information.service.gov.example/company/13579246",
                "WESER LOGISTIK SERVICES UK LIMITED · Active · Branch of German parent",
                "companies-house"
            ),
        ],
        people: [
            {
                id: "p-wes-1",
                name: "Tobias Krüger",
                title: "Head of Fulfilment",
                seniority: "Head",
                email: "t.krueger@weser-ls.example",
                emailStatus: "guess",
                source: "Pattern",
                sourceUrl: null,
            },
        ],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(0),
        lastActivityAt: null,
        foundVia: [
            {
                sourceId: "companies-house",
                url: "https://find-and-update.company-information.service.gov.example/company/13579246",
                at: daysAgo(0),
            },
        ],
        isNew: true,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [20, 20],
            geography: [15, 15],
            signals: [7, 25],
            disqualifiers: [],
        },
        profiledAt: daysAgo(0),
        reserve: true,
    },
    {
        id: "co-fjord",
        name: "Fjord Fulfilment UK",
        domain: "fjordfulfilment.example",
        hq: "Hull, GB",
        country: "GB",
        sizeBand: "11 to 50",
        archetype: "Fulfilment and 3PL operator",
        why: "Hull fulfilment startup for Scandinavian brands entering the UK; small for now.",
        fit: 58,
        about: [
            {
                text: "Fjord fulfils UK orders for Scandinavian brands from a single Hull site.",
                cites: [1],
            },
        ],
        whyFit: [{ text: "Right type, wrong size for now.", cites: [1] }],
        openQuestions: [],
        signals: [],
        evidence: [
            ev(
                1,
                "LinkedIn company page",
                "https://uk.linkedin.com/company/fjord-fulfilment-uk",
                "11-50 employees · Kingston upon Hull",
                "recipe:linkedin-company"
            ),
        ],
        people: [],
        stage: "lead",
        ownerName: null,
        nextStep: null,
        nextStepAt: null,
        stageChangedAt: daysAgo(0),
        lastActivityAt: null,
        foundVia: [
            {
                sourceId: "recipe:linkedin-company",
                url: "https://uk.linkedin.com/company/fjord-fulfilment-uk",
                at: daysAgo(0),
            },
        ],
        isNew: true,
        excluded: false,
        excludedReason: null,
        fitBreakdown: {
            archetype: [30, 30],
            size: [6, 20],
            geography: [15, 15],
            signals: [7, 25],
            disqualifiers: ["Under 50 staff"],
        },
        profiledAt: daysAgo(0),
        reserve: true,
    },
];

export interface WorldSegment {
    id: string;
    name: string;
    subtitle: string;
    headline: string;
    status: "draft" | "confirmed";
    derivedAt: string;
    confirmedAt: string | null;
    basis: { documents: number; hasProfile: boolean };
    fields: SegmentField[];
}

export const SEGMENTS: WorldSegment[] = [
    {
        id: "seg-fulfilment",
        name: "Fulfilment operators · EU",
        subtitle: "NL, DE, UK · 50 to 500 staff",
        headline: "Fulfilment operators in NL, DE and the UK",
        status: "confirmed",
        derivedAt: daysAgo(5),
        confirmedAt: daysAgo(5, 14),
        basis: { documents: 6, hasProfile: true },
        fields: [
            {
                key: "archetype",
                label: "Buyer type",
                value: "Fulfilment and third-party logistics operators running their own warehouses",
                sources: ["from company profile", "from PickBot v3 field spec"],
                editable: true,
            },
            {
                key: "industries",
                label: "Industries",
                value: ["E-commerce fulfilment", "Contract logistics", "3PL", "Returns processing"],
                sources: ["from Q3 customer interviews", "from company profile"],
                editable: true,
            },
            {
                key: "size",
                label: "Size",
                value: "50 to 500 staff",
                sources: ["from 4 proposals: smallest 60, largest 420"],
                editable: true,
            },
            {
                key: "geographies",
                label: "Where",
                value: ["Netherlands", "Germany", "United Kingdom"],
                sources: ["from company profile · markets"],
                editable: true,
            },
            {
                key: "seedDomains",
                label: "Looks like",
                value: ["deltalogistics.example", "pickpoint.example"],
                sources: ["customers named in Globex MSA and 2 proposals"],
                editable: true,
            },
            {
                key: "signals",
                label: "Signals that matter",
                value: ["Hiring warehouse staff", "New site or DC", "Peak-season pressure"],
                sources: ["from Q3 customer interviews"],
                editable: true,
            },
            {
                key: "disqualifiers",
                label: "Not a fit",
                value: ["No own warehouse", "Under 50 staff", "Freight only"],
                sources: ["from lost-deal notes"],
                editable: true,
            },
            {
                key: "exclusions",
                label: "Already customers",
                value: "6 domains excluded from every search",
                sources: ["from contracts folder"],
                editable: false,
            },
        ],
    },
    {
        id: "seg-grocery",
        name: "Grocery retail · NL",
        subtitle: "Draft · not confirmed",
        headline: "Grocery retailers in the Netherlands",
        status: "draft",
        derivedAt: daysAgo(1),
        confirmedAt: null,
        basis: { documents: 2, hasProfile: true },
        fields: [
            {
                key: "archetype",
                label: "Buyer type",
                value: "Grocery retailers with regional distribution centres",
                sources: ["from company profile"],
                editable: true,
            },
            {
                key: "industries",
                label: "Industries",
                value: ["Grocery retail", "Online grocery"],
                sources: ["from 2 proposals"],
                editable: true,
            },
            {
                key: "size",
                label: "Size",
                value: "500 to 5,000 staff",
                sources: ["from company profile"],
                editable: true,
            },
            {
                key: "geographies",
                label: "Where",
                value: ["Netherlands"],
                sources: ["from company profile · markets"],
                editable: true,
            },
            { key: "seedDomains", label: "Looks like", value: [], sources: [], editable: true },
            {
                key: "signals",
                label: "Signals that matter",
                value: ["New distribution centre", "Online grocery launch"],
                sources: ["from 2 proposals"],
                editable: true,
            },
            {
                key: "disqualifiers",
                label: "Not a fit",
                value: ["Franchise-only, no own DC"],
                sources: [],
                editable: true,
            },
            {
                key: "exclusions",
                label: "Already customers",
                value: "None",
                sources: [],
                editable: false,
            },
        ],
    },
];

export interface WorldRunRecord {
    id: string;
    segmentId: string;
    startedAt: string;
    durationMs: number;
    spend: { usd: number; usdCap: number; credits: number };
    found: number;
    newCompanies: number;
    profiled: number;
    people: number;
    sources: Array<{
        sourceId: string;
        found: number;
        newCompanies: number;
        status: "ok" | "degraded" | "failed" | "skipped" | "off";
        detail: string | null;
    }>;
}

export const PAST_RUNS: WorldRunRecord[] = [
    {
        id: "run-today",
        segmentId: "seg-fulfilment",
        startedAt: lastRun,
        durationMs: 4 * 60_000 + 12_000,
        spend: { usd: 0.31, usdCap: 1, credits: 26 },
        found: 117,
        newCompanies: 3,
        profiled: 14,
        people: 9,
        sources: [
            {
                sourceId: "recipe:linkedin-company",
                found: 41,
                newCompanies: 1,
                status: "ok",
                detail: null,
            },
            { sourceId: "exa-lookalike", found: 29, newCompanies: 1, status: "ok", detail: null },
            { sourceId: "companies-house", found: 22, newCompanies: 1, status: "ok", detail: null },
            { sourceId: "serper-maps", found: 18, newCompanies: 0, status: "ok", detail: null },
            { sourceId: "exa-company", found: 7, newCompanies: 0, status: "ok", detail: null },
            { sourceId: "job-boards", found: 11, newCompanies: 0, status: "ok", detail: null },
            { sourceId: "osm-overpass", found: 0, newCompanies: 0, status: "off", detail: "off" },
            {
                sourceId: "recipe:trustpilot",
                found: 0,
                newCompanies: 0,
                status: "off",
                detail: "off",
            },
            {
                sourceId: "recipe:glassdoor",
                found: 0,
                newCompanies: 0,
                status: "skipped",
                detail: "no key",
            },
        ],
    },
    {
        id: "run-3d",
        segmentId: "seg-fulfilment",
        startedAt: daysAgo(3, 16),
        durationMs: 3 * 60_000 + 48_000,
        spend: { usd: 0.28, usdCap: 1, credits: 24 },
        found: 104,
        newCompanies: 6,
        profiled: 12,
        people: 7,
        sources: [
            {
                sourceId: "recipe:linkedin-company",
                found: 38,
                newCompanies: 3,
                status: "ok",
                detail: null,
            },
            { sourceId: "exa-lookalike", found: 27, newCompanies: 1, status: "ok", detail: null },
            {
                sourceId: "companies-house",
                found: 21,
                newCompanies: 1,
                status: "degraded",
                detail: "rate limited after 20 calls",
            },
            { sourceId: "serper-maps", found: 12, newCompanies: 1, status: "ok", detail: null },
            { sourceId: "exa-company", found: 6, newCompanies: 0, status: "ok", detail: null },
            { sourceId: "job-boards", found: 9, newCompanies: 0, status: "ok", detail: null },
            { sourceId: "osm-overpass", found: 0, newCompanies: 0, status: "off", detail: "off" },
            {
                sourceId: "recipe:trustpilot",
                found: 0,
                newCompanies: 0,
                status: "off",
                detail: "off",
            },
            {
                sourceId: "recipe:glassdoor",
                found: 0,
                newCompanies: 0,
                status: "skipped",
                detail: "no key",
            },
        ],
    },
];
