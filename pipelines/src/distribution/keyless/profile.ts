/**
 * The keyless profiler: reads an organisation's own website (home plus a few
 * well-known pages) and produces the same dossier the research agent
 * would, with every claim recorded as evidence that quotes a fetched page.
 * No model. It cannot reason, so it only states what the pages literally
 * say: what they call themselves, where they are, how to reach them, which
 * certifications they list, roughly how big they are.
 */
import type { ChatTokenUsage } from "@launchstack/llm";
import type { ReadablePage } from "@launchstack/tools/web-research";

import {
    normalizeUrlForMatch,
    validateDossierGrounding,
    type DossierAgentInput,
    type DossierAgentPorts,
    type DossierAgentResult,
    type RecordedEvidence,
} from "../dossier-agent";
import { DossierSchema, type Dossier, type EvidenceKind, type PartnerKind } from "../types";
import { countriesMentioned, countryName } from "./geo";

export const KEYLESS_PROFILE_VERSION = "keyless-profile/v1";
export const KEYLESS_PROFILER_ID = "keyless/page-reader";

/** Pages worth trying after the home page, in the languages of the target markets. */
const EXTRA_PATHS = [
    "/about",
    "/about-us",
    "/over-ons",
    "/ueber-uns",
    "/unternehmen",
    "/contact",
    "/contact-us",
    "/kontakt",
    "/impressum",
    "/careers",
    "/jobs",
    "/vacatures",
    "/karriere",
];

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const GENERIC_LOCAL =
    /^(info|sales|hello|contact|office|purchasing|einkauf|import|export|mail|team|support|admin|kontakt|verkoop|inkoop|orders?|hi|jobs|careers|press|media)$/i;
const STAFF_RE =
    /\b(\d{1,3}(?:[.,]\d{3})*|\d{1,5})\+?\s*(employees|medewerkers|mitarbeiter(?:innen)?|staff|people|colleagues|collega'?s|team members|fte)\b/i;
const CERT_RE =
    /\b(ISO\s?9001|ISO\s?14001|ISO\s?22000|ISO\s?27001|ISO\s?13485|BRC(?:GS)?|IFS(?: Food)?|FSSC\s?22000|HACCP|GMP|B ?Corp|Fairtrade|Rainforest Alliance|UTZ|SKAL|EU Organic|Demeter|Bio-Siegel|FDA registered|CE marked|SOC ?2|GDPR compliant|ISO\s?45001|ISO\s?50001)\b/gi;
const ROLE_RULES: Array<{ role: PartnerKind; re: RegExp }> = [
    {
        role: "importer",
        re: /\b(importer|importeur|importador|importateur|we import|wij importeren|wir importieren)\b/i,
    },
    {
        role: "distributor",
        re: /\b(distributor|distributeur|distribuidor|vertrieb|distribution partner|we distribute|wij distribueren)\b/i,
    },
    {
        role: "wholesaler",
        re: /\b(wholesale[rs]?|groothandel|großhandel|grossist|mayorista|grossiste)\b/i,
    },
    {
        role: "retailer",
        re: /\b(retailer|retail store|our stores|winkels?|filialen|shop online|webshop)\b/i,
    },
    { role: "agent", re: /\b(sales agent|commercial agent|handelsvertreter|agent commercial)\b/i },
    {
        role: "reseller",
        re: /\b(reseller|value[- ]added reseller|wederverkoper|wiederverkäufer)\b/i,
    },
    {
        role: "supplier",
        re: /\b(supplier|manufacturer|producer|fabrikant|hersteller|producent|we make|we produce|wir produzieren)\b/i,
    },
];

export interface ExtractedFacts {
    description: string | null;
    emails: string[];
    staff: { count: number; band: Dossier["sizeBand"]; quote: string } | null;
    certifications: Array<{ name: string; quote: string }>;
    roles: Array<{ role: PartnerKind; quote: string }>;
    countries: Array<{ code: string; quote: string }>;
}

function snippet(text: string, index: number, length: number, radius = 70): string {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + length + radius);
    return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function cleanText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/** The first sentence-like run of text that reads like a description rather than navigation. */
export function firstDescription(text: string, title: string | null): string | null {
    const clean = cleanText(text);
    const candidates = clean.split(/(?<=[.!?])\s+/).map(s => s.trim());
    for (const sentence of candidates) {
        const words = sentence.split(" ");
        if (sentence.length < 60 || sentence.length > 320) continue;
        if (words.length < 8) continue;
        if (/cookie|privacy|javascript|accept all|log ?in|sign ?in|menu|©/i.test(sentence))
            continue;
        if (title && sentence.toLowerCase() === title.toLowerCase()) continue;
        return sentence;
    }
    return null;
}

function bandFor(count: number): Dossier["sizeBand"] {
    if (count < 10) return "micro";
    if (count < 50) return "small";
    if (count < 250) return "medium";
    return "large";
}

/** Pure extraction from a page's text, exported for tests. */
export function extractFacts(page: Pick<ReadablePage, "text" | "title">): ExtractedFacts {
    const text = cleanText(page.text);
    const emails = [...new Set([...text.matchAll(EMAIL_RE)].map(m => m[0].toLowerCase()))].filter(
        e => !/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(e) && !/example\.com$/i.test(e)
    );
    const staffMatch = STAFF_RE.exec(text);
    let staff: ExtractedFacts["staff"] = null;
    if (staffMatch) {
        const count = Number.parseInt(staffMatch[1]!.replace(/[.,]/g, ""), 10);
        if (Number.isFinite(count) && count > 0 && count < 500_000)
            staff = {
                count,
                band: bandFor(count),
                quote: snippet(text, staffMatch.index, staffMatch[0].length),
            };
    }
    const certifications: ExtractedFacts["certifications"] = [];
    const seenCert = new Set<string>();
    for (const m of text.matchAll(CERT_RE)) {
        const name =
            m[0].replace(/\s+/g, " ").toUpperCase() === m[0].toUpperCase()
                ? m[0].replace(/\s+/g, " ")
                : m[0];
        const key = name.toLowerCase().replace(/\s/g, "");
        if (seenCert.has(key)) continue;
        seenCert.add(key);
        certifications.push({ name, quote: snippet(text, m.index, m[0].length) });
    }
    const roles: ExtractedFacts["roles"] = [];
    for (const rule of ROLE_RULES) {
        const m = rule.re.exec(text);
        if (m) roles.push({ role: rule.role, quote: snippet(text, m.index, m[0].length) });
    }
    const countries: ExtractedFacts["countries"] = countriesMentioned(text).map(code => {
        const name = countryName(code);
        const at = text.toLowerCase().indexOf(name.toLowerCase());
        return { code, quote: at >= 0 ? snippet(text, at, name.length) : name };
    });
    return {
        description: firstDescription(text, page.title),
        emails: emails.slice(0, 6),
        staff,
        certifications: certifications.slice(0, 6),
        roles,
        countries: countries.slice(0, 8),
    };
}

const ZERO_USAGE: ChatTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export interface KeylessProfileLimits {
    maxPages: number;
    /** Whole-candidate budget; pages after this are not fetched. */
    budgetMs: number;
}

const DEFAULT_LIMITS: KeylessProfileLimits = { maxPages: 4, budgetMs: 40_000 };

/**
 * Fetch the site, extract facts, record each as evidence, assemble the
 * dossier and run it through the same grounding gate the agent faces.
 */
export async function profileFromPages(
    ports: Pick<DossierAgentPorts, "fetchPage" | "recordEvidence" | "signal">,
    input: DossierAgentInput,
    limits: Partial<KeylessProfileLimits> = {}
): Promise<DossierAgentResult> {
    const { maxPages, budgetMs } = { ...DEFAULT_LIMITS, ...limits };
    const startedAt = Date.now();
    const fetched = new Set<string>();
    const fetchedUrls: string[] = [];
    const pages: ReadablePage[] = [];
    const evidence = new Map<number, RecordedEvidence>();

    const tryFetch = async (url: string): Promise<ReadablePage | null> => {
        if (ports.signal?.aborted || Date.now() - startedAt > budgetMs) return null;
        try {
            const page = await ports.fetchPage(url);
            if (page.status >= 400 || page.text.trim().length < 120) return null;
            const key = normalizeUrlForMatch(page.finalUrl);
            if (fetched.has(key)) return null;
            fetched.add(key);
            fetched.add(normalizeUrlForMatch(page.url));
            fetchedUrls.push(page.finalUrl);
            pages.push(page);
            return page;
        } catch {
            return null;
        }
    };

    const seeds =
        input.seedUrls.length > 0
            ? input.seedUrls
            : input.org.domain
              ? [`https://${input.org.domain}/`]
              : [];
    const home = seeds.length ? await tryFetch(seeds[0]!) : null;
    if (home) {
        const base = home.finalUrl;
        for (const path of EXTRA_PATHS) {
            if (pages.length >= maxPages) break;
            let url: string;
            try {
                url = new URL(path, base).href;
            } catch {
                continue;
            }
            await tryFetch(url);
        }
    }

    const finish = (outcome: DossierAgentResult["outcome"]): DossierAgentResult => ({
        outcome,
        evidence: [...evidence.values()],
        fetchedUrls,
        turns: pages.length,
        usage: ZERO_USAGE,
        modelId: KEYLESS_PROFILER_ID,
        playbookHash: KEYLESS_PROFILE_VERSION,
        promptVersion: KEYLESS_PROFILE_VERSION,
    });

    if (pages.length === 0) {
        return finish({
            status: "gate_failed",
            dossier: null,
            errors: [
                {
                    code: "empty_dossier",
                    message: `No page of ${input.org.domain ?? input.org.name} could be read.`,
                },
            ],
        });
    }

    const record = async (
        kind: EvidenceKind,
        claim: string,
        page: ReadablePage,
        quote: string,
        confidence = 0.75
    ) => {
        const id = await ports.recordEvidence({
            kind,
            claim: claim.slice(0, 400),
            sourceUrl: page.finalUrl,
            quote: quote.slice(0, 600),
            confidence,
        });
        evidence.set(id, {
            id,
            kind,
            claim: claim.slice(0, 400),
            sourceUrl: page.finalUrl,
            quote: quote.slice(0, 600),
            confidence,
        });
        return id;
    };

    const facts = pages.map(p => ({ page: p, facts: extractFacts(p) }));
    const first = facts[0]!;
    const description =
        facts.map(f => f.facts.description).find((d): d is string => Boolean(d)) ?? null;
    const descPage = facts.find(f => f.facts.description === description)?.page ?? first.page;

    // Firmographic: the site's own description and, when stated, its size.
    const descId = description
        ? await record(
              "firmographic",
              `${input.org.name} describes itself: ${description}`,
              descPage,
              description,
              0.8
          )
        : await record(
              "firmographic",
              `${input.org.name} publishes a website titled "${first.page.title ?? input.org.domain ?? input.org.name}".`,
              first.page,
              (first.page.title ?? input.org.name).slice(0, 200),
              0.6
          );

    const staffHit = facts.find(f => f.facts.staff);
    let sizeBand: Dossier["sizeBand"] = "unknown";
    if (staffHit?.facts.staff) {
        sizeBand = staffHit.facts.staff.band;
        await record(
            "firmographic",
            `${input.org.name} states about ${staffHit.facts.staff.count} people.`,
            staffHit.page,
            staffHit.facts.staff.quote,
            0.7
        );
    }

    // Roles, as the site literally calls itself.
    const roles: PartnerKind[] = [];
    for (const f of facts) {
        for (const r of f.facts.roles) {
            if (roles.includes(r.role)) continue;
            roles.push(r.role);
            await record(
                "role",
                `${input.org.name} describes itself as a ${r.role}.`,
                f.page,
                r.quote,
                0.7
            );
        }
    }

    // Territories: the target country if the site mentions it, plus any other country named.
    const territories: Dossier["territories"] = [];
    const seenCountry = new Set<string>();
    for (const f of facts) {
        for (const c of f.facts.countries) {
            if (seenCountry.has(c.code)) continue;
            seenCountry.add(c.code);
            const id = await record(
                "territory",
                `${input.org.name} mentions ${countryName(c.code)} on its site.`,
                f.page,
                c.quote,
                0.6
            );
            territories.push({ territory: countryName(c.code), evidenceIds: [id] });
            if (territories.length >= 5) break;
        }
    }

    // Certifications.
    const certifications: Dossier["certifications"] = [];
    const seenCert = new Set<string>();
    for (const f of facts) {
        for (const c of f.facts.certifications) {
            const key = c.name.toLowerCase().replace(/\s/g, "");
            if (seenCert.has(key)) continue;
            seenCert.add(key);
            const id = await record(
                "certification",
                `${input.org.name} lists ${c.name}.`,
                f.page,
                c.quote,
                0.7
            );
            certifications.push({ certification: c.name, evidenceIds: [id] });
        }
    }

    // Contact routes: public mailboxes on the site.
    const contactChannels: Dossier["contactChannels"] = [];
    const seenEmail = new Set<string>();
    for (const f of facts) {
        for (const email of f.facts.emails) {
            if (seenEmail.has(email) || contactChannels.length >= 4) continue;
            seenEmail.add(email);
            const local = email.split("@")[0]!;
            const id = await record(
                "contact",
                `${input.org.name} publishes ${GENERIC_LOCAL.test(local) ? "a general" : "a named"} mailbox: ${email}.`,
                f.page,
                email,
                0.85
            );
            contactChannels.push({ channel: "email", value: email, evidenceIds: [id] });
        }
    }

    const openQuestions: string[] = [];
    if (!description)
        openQuestions.push("The site has no clear description of what the organisation does.");
    if (sizeBand === "unknown") openQuestions.push("Headcount is not stated on the site.");
    if (roles.length === 0)
        openQuestions.push(
            "The site does not say whether it imports, distributes, wholesales or retails."
        );
    if (contactChannels.length === 0)
        openQuestions.push("No public email address on the pages read; a contact form may exist.");
    openQuestions.push(
        "Brands carried and named decision makers need a person or a model to establish."
    );

    const summaryBody =
        description ??
        `${input.org.name} runs a public website (${first.page.title ?? input.org.domain ?? "untitled"}).`;
    const where = input.territory ? ` Found for ${countryName(input.territory.country)}.` : "";
    let summary = `${summaryBody}${where}`.trim();
    if (summary.length < 40)
        summary = `${summary} Read from ${pages.length} page${pages.length === 1 ? "" : "s"} of ${input.org.domain ?? "its site"} without a model.`;

    const dossier: Dossier = {
        summary: summary.slice(0, 1500),
        roles: roles.length > 0 ? roles : [input.kind],
        brandsCarried: [],
        territories,
        retailCoverage: [],
        certifications,
        decisionMakers: [],
        contactChannels,
        risks: [],
        sizeBand,
        openQuestions: openQuestions.slice(0, 6),
    };
    // The description evidence is not cited by a list field; keep the gate honest by
    // attaching it to the territory of the search when nothing else names a country.
    if (dossier.territories.length === 0 && input.territory) {
        dossier.territories.push({
            territory: countryName(input.territory.country),
            evidenceIds: [descId],
        });
    }

    const parsed = DossierSchema.safeParse(dossier);
    if (!parsed.success) {
        return finish({
            status: "gate_failed",
            dossier: null,
            errors: [
                {
                    code: "empty_dossier",
                    message: `Dossier did not validate: ${parsed.error.issues.map(i => i.message).join("; ")}`,
                },
            ],
        });
    }
    const errors = validateDossierGrounding(parsed.data, evidence, fetched);
    if (errors.length > 0) return finish({ status: "gate_failed", dossier: null, errors });
    return finish({ status: "ok", dossier: parsed.data, repaired: false });
}
