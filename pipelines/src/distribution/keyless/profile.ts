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
    type ProfileProgressStep,
    type RecordedEvidence,
} from "../dossier-agent";
import { DossierSchema, type Dossier, type EvidenceKind, type PartnerKind } from "../types";
import type { LinkedInLookup, LinkedInSearchRequest } from "../linkedin-search";
import { countriesMentioned, countryName } from "./geo";
import {
    TEAM_PATHS,
    emailForPerson,
    extractPeople,
    linkedinUrlForPerson,
    organisationBeside,
    organisationPaths,
    organisationSiteUrls,
} from "../people";

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
    // Shopify keeps a shop's own pages under /pages/.
    "/pages/about",
    "/pages/about-us",
    "/pages/contact",
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

const ENTITIES: Record<string, string> = {
    amp: "&",
    nbsp: " ",
    quot: '"',
    apos: "'",
    euro: "€",
    pound: "£",
    times: "×",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    eacute: "é",
    egrave: "è",
    uuml: "ü",
    ouml: "ö",
    auml: "ä",
    szlig: "ß",
    copy: "©",
    reg: "®",
};

function cleanText(text: string): string {
    return text
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]{0,200}>/g, " ")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
        .replace(/\s+/g, " ")
        .trim();
}

const SELF_WORDS =
    /\b(we|our|us|wij|onze|ons|wir|unser|unsere|nous|notre|nos|nuestro|nuestra|somos|is een|is a|is an|ist ein|est une?)\b/i;
const JUNK =
    /cookie|privacy|javascript|accept all|log ?in|sign ?in|\bmenu\b|©|sort by|filter|found \d+|read more|lees meer|mehr lesen|click here|subscribe|newsletter|add to cart|in winkelwagen|skip to/i;

/**
 * The sentence that best reads as a self-description rather than navigation:
 * long enough, mostly lower-case prose, no markup remnants, ideally saying
 * "we are" or naming the organisation.
 */
export function firstDescription(
    text: string,
    title: string | null,
    orgName?: string
): string | null {
    const clean = cleanText(text);
    const candidates = clean.split(/(?<=[.!?])\s+/).map(s => s.trim());
    let best: { sentence: string; score: number } | null = null;
    for (const sentence of candidates) {
        if (sentence.length < 60 || sentence.length > 320) continue;
        const words = sentence.split(" ");
        if (words.length < 8) continue;
        if (/[<>{}|]/.test(sentence) || JUNK.test(sentence)) continue;
        // Links, leftover entities and price lists are navigation, not prose.
        if (/https?:\/\/|www\.|&#?\w+;/i.test(sentence)) continue;
        if ((sentence.match(/\d/g)?.length ?? 0) > sentence.length * 0.12) continue;
        if (title && sentence.toLowerCase() === title.toLowerCase()) continue;
        const capitalised = words.filter(w => /^[A-Z]/.test(w)).length / words.length;
        if (capitalised > 0.5) continue;
        let score = 0;
        if (SELF_WORDS.test(sentence)) score += 2;
        if (orgName && sentence.toLowerCase().includes(orgName.toLowerCase().split(" ")[0]!))
            score += 1;
        if (sentence.length >= 90 && sentence.length <= 260) score += 1;
        if (!best || score > best.score) best = { sentence, score };
        if (best.score >= 4) break;
    }
    return best?.sentence ?? null;
}

function bandFor(count: number): Dossier["sizeBand"] {
    if (count < 10) return "micro";
    if (count < 50) return "small";
    if (count < 250) return "medium";
    return "large";
}

/** Pure extraction from a page's text, exported for tests. */
export function extractFacts(
    page: Pick<ReadablePage, "text" | "title">,
    orgName?: string
): ExtractedFacts {
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
        description: firstDescription(text, page.title, orgName),
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
    /** Team or leadership pages read on top of `maxPages`, for named people. */
    maxTeamPages: number;
    /** Whole-candidate budget; pages after this are not fetched. */
    budgetMs: number;
}

const DEFAULT_LIMITS: KeylessProfileLimits = { maxPages: 4, maxTeamPages: 2, budgetMs: 40_000 };

/**
 * Fetch the site, extract facts, record each as evidence, assemble the
 * dossier and run it through the same grounding gate the agent faces.
 */
export async function profileFromPages(
    ports: Pick<DossierAgentPorts, "fetchPage" | "recordEvidence" | "signal"> & {
        /** Public web search for profiles. Null skips the search and leaves them unmatched. */
        searchLinkedIn?:
            | ((
                  people: readonly LinkedInSearchRequest[]
              ) => Promise<ReadonlyMap<string, LinkedInLookup>>)
            | null;
    },
    input: DossierAgentInput,
    limits: Partial<KeylessProfileLimits> = {}
): Promise<DossierAgentResult> {
    const { maxPages, maxTeamPages, budgetMs } = { ...DEFAULT_LIMITS, ...limits };
    const startedAt = Date.now();
    const fetched = new Set<string>();
    const fetchedUrls: string[] = [];
    const pages: ReadablePage[] = [];
    const evidence = new Map<number, RecordedEvidence>();
    let teamCount = 0;
    let namedCount = 0;
    let slugCount = 0;
    const report = (step: ProfileProgressStep, people = 0) =>
        input.onProgress?.({
            step,
            pages: pages.length,
            teamPages: teamCount,
            named: namedCount,
            slug: slugCount,
            people,
        });

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
    await report("site");
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
        await report("site");
        await report("team");
        for (const path of TEAM_PATHS) {
            if (teamCount >= maxTeamPages) break;
            let url: string;
            try {
                url = new URL(path, base).href;
            } catch {
                continue;
            }
            if (await tryFetch(url)) {
                teamCount++;
                await report("team");
            }
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

    // Route 1: a person exists only when the website writes a name beside a
    // job title. Anyone the site does not name is not looked up.
    await report("named");
    const namedOnSite = new Map<
        string,
        {
            person: ReturnType<typeof extractPeople>[number];
            page: ReadablePage;
            slugPage: ReadablePage | null;
            /** Confirmed profile, published on a page or returned by one search result. */
            slugUrl: string | null;
            lookup: LinkedInLookup | null;
        }
    >();
    for (const page of pages) {
        for (const person of extractPeople(cleanText(page.text), input.org.name)) {
            const key = person.name.toLowerCase();
            if (!namedOnSite.has(key))
                namedOnSite.set(key, { person, page, slugPage: null, slugUrl: null, lookup: null });
        }
    }
    namedCount = namedOnSite.size;
    await report("named");

    // Route 2: a profile is kept only when the name and the organisation both
    // appear with it. A guessed address, or a search hit that names someone
    // else, is left blank.
    await report("slug");
    let orgFetches = 0;
    const pending: LinkedInSearchRequest[] = [];
    const readOrg = async (url: string): Promise<ReadablePage | null> => {
        if (ports.signal?.aborted || Date.now() - startedAt > budgetMs || orgFetches >= 12)
            return null;
        orgFetches += 1;
        try {
            const page = await ports.fetchPage(url);
            if (page.status >= 400 || page.text.trim().length < 120) return null;
            return page;
        } catch {
            return null;
        }
    };
    for (const named of namedOnSite.values()) {
        if (ports.signal?.aborted) break;
        const keep = (url: string) => {
            named.slugUrl = url;
            named.lookup = { status: "matched", url };
            slugCount += 1;
        };
        for (const page of pages) {
            const published = linkedinUrlForPerson(cleanText(page.text), named.person.name);
            if (published) {
                keep(published);
                break;
            }
        }
        if (named.slugUrl) continue;
        const elsewhere = organisationBeside(
            cleanText(named.page.text),
            named.person.name,
            input.org.name
        );
        if (elsewhere) {
            let origin: string | null = null;
            for (const site of organisationSiteUrls(elsewhere)) {
                const home = await readOrg(site);
                if (!home) continue;
                origin = new URL(home.finalUrl).origin;
                const published = linkedinUrlForPerson(home.text, named.person.name);
                if (published) keep(published);
                break;
            }
            if (!named.slugUrl && origin) {
                for (const path of organisationPaths(origin).slice(0, 3)) {
                    const sub = await readOrg(path);
                    const published = sub && linkedinUrlForPerson(sub.text, named.person.name);
                    if (published) {
                        keep(published);
                        break;
                    }
                }
            }
        }
        if (named.slugUrl) continue;
        // Search "name + company". The organisation written beside the person
        // is the company when the page names one. The job title is only used
        // when more than one result has that name at the company.
        const company = input.org.name;
        pending.push({
            name: named.person.name,
            orgs:
                elsewhere && elsewhere.toLowerCase() !== company.toLowerCase()
                    ? [company, elsewhere]
                    : [company],
            title: named.person.title,
        });
    }
    if (pending.length > 0 && ports.searchLinkedIn) {
        let results: ReadonlyMap<string, LinkedInLookup> = new Map();
        try {
            results = await ports.searchLinkedIn(pending);
        } catch {
            results = new Map();
        }
        for (const request of pending) {
            const named = namedOnSite.get(request.name.toLowerCase());
            if (!named || named.slugUrl) continue;
            const found = results.get(request.name) ?? {
                status: "search_error" as const,
                url: null,
            };
            named.lookup = found;
            if (found.status === "matched" && found.url) {
                named.slugUrl = found.url;
                slugCount += 1;
            }
        }
    } else {
        for (const request of pending) {
            const named = namedOnSite.get(request.name.toLowerCase());
            if (named && !named.lookup) named.lookup = { status: "not_found", url: null };
        }
    }
    await report("slug");

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

    const facts = pages.map(p => ({ page: p, facts: extractFacts(p, input.org.name) }));
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

    // Named people beside a job title, and the address the site gives each of them.
    await report("people");
    const allEmails = [...new Set(facts.flatMap(f => f.facts.emails))];
    const decisionMakers: Dossier["decisionMakers"] = [];
    const contactChannels: Dossier["contactChannels"] = [];
    const seenEmail = new Set<string>();
    for (const named of namedOnSite.values()) {
        if (decisionMakers.length >= 8) break;
        const { person } = named;
        const lookup = named.lookup ?? { status: "not_found" as const, url: null };
        const linkedinUrl = lookup.status === "matched" ? (lookup.url ?? named.slugUrl) : null;
        const id = await record(
            "contact",
            linkedinUrl
                ? `[linkedin:matched] ${linkedinUrl} ${input.org.name} lists ${person.name} as ${person.title}.`
                : `[linkedin:${lookup.status}] ${input.org.name} lists ${person.name} as ${person.title}.`,
            named.page,
            person.quote,
            0.7
        );
        decisionMakers.push({ title: person.title, name: person.name, evidenceIds: [id] });
        const email = emailForPerson(person.name, allEmails);
        if (email && !seenEmail.has(email)) {
            seenEmail.add(email);
            const emailPage = facts.find(x => x.facts.emails.includes(email))?.page ?? named.page;
            const emailId = await record(
                "contact",
                `${input.org.name} publishes ${person.name}'s address: ${email}.`,
                emailPage,
                email,
                0.85
            );
            contactChannels.push({ channel: "email", value: email, evidenceIds: [emailId] });
        }
    }

    // Contact routes: the remaining public mailboxes on the site.
    for (const f of facts) {
        for (const email of f.facts.emails) {
            if (seenEmail.has(email) || contactChannels.length >= 6) continue;
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
    if (decisionMakers.length === 0)
        openQuestions.push("No named owner, buyer or manager on the pages read.");
    openQuestions.push("Brands carried are not stated on the pages read.");

    await report("save", decisionMakers.length);

    const summaryBody =
        description ??
        `${input.org.name} runs a public website (${first.page.title ?? input.org.domain ?? "untitled"}).`;
    const where = input.territory ? ` Found for ${countryName(input.territory.country)}.` : "";
    let summary = `${summaryBody}${where}`.trim();
    if (summary.length < 40)
        summary = `${summary} Read from ${pages.length} page${pages.length === 1 ? "" : "s"} of ${input.org.domain ?? "its site"} without a model.`;

    const dossier: Dossier = {
        summary: summary.slice(0, 1500),
        roles,
        brandsCarried: [],
        territories,
        retailCoverage: [],
        certifications,
        decisionMakers,
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
