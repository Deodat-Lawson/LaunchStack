/**
 * Named people on an organisation's own pages, without a model: a person's
 * name written next to a job title ("Anne Saxelby, Founder", "Owner: Jane
 * Doe", "Jane Doe is our head buyer"). Only what a page literally says; a
 * name with no title beside it is not a decision maker.
 */
import { GIVEN_NAMES } from "./given-names";

/** Pages that usually list people, tried after the profile's own pages. */
export const TEAM_PATHS = [
    "/team",
    "/our-team",
    "/meet-the-team",
    "/leadership",
    "/people",
    "/staff",
    "/about/team",
    "/who-we-are",
    "/our-story",
    "/pages/our-team",
    "/pages/team",
    "/pages/our-story",
];

const TITLE_CORE = [
    "co-?founder",
    "founder",
    "co-?owner",
    "owner",
    "proprietor",
    "ceo",
    "coo",
    "cfo",
    "cto",
    "cmo",
    "chief [a-z]+ officer",
    "president",
    "vice president(?: of [a-z]+)?",
    "vp(?: of [a-z]+)?",
    "managing director",
    "general manager",
    "directors? of [a-z]+",
    "director",
    "head of [a-z]+",
    "head buyer",
    "[a-z]+ manager",
    "manager",
    "managing partner",
    "partner",
    "principal",
    "buyer",
    "executive chef",
    "head chef",
].join("|");

const TITLE_RE = new RegExp(
    `\\b(?:(?:senior|junior|assistant|associate|executive|regional|national|our|the)\\s+)?(?:${TITLE_CORE})\\b(?:\\s*(?:&|and)\\s*(?:${TITLE_CORE})\\b)?`,
    "gi"
);

const NAME_WORD = "[A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?";
// First and last only: a third capitalised word is more often "Welcome" or "Meet" than a name.
const NAME = `${NAME_WORD}(?:\\s+[A-Z]\\.)?\\s+${NAME_WORD}`;
/** "Jane Doe, Founder" / "Jane Doe – Founder" / "Jane Doe is our founder" / "Jane Doe Founder". */
const NAME_BEFORE = new RegExp(`(${NAME})\\s*(?:,|–|—|-|\\||:|\\(|\\bis\\b)?\\s*$`);
/** "Founder: Jane Doe" / "Founder Jane Doe" / "founded by Jane Doe". */
const NAME_AFTER = new RegExp(`^\\s*(?:,|:|–|—|-|\\||\\bby\\b)?\\s*(${NAME})`);

/** Capitalised words that start sentences, name places or pages, not people. */
const NOT_A_NAME = new Set(
    (
        "about our the meet team contact home shop wholesale retail sales company inc llc ltd " +
        "co corp group new york san los las st saint north south east west street avenue road " +
        "united states america city county market store stores cafe coffee cheese wine food " +
        "foods farm farms kitchen bakery restaurant restaurants read more learn view call email " +
        "phone hours open monday tuesday wednesday thursday friday saturday sunday january " +
        "february march april may june july august september october november december we us " +
        "his her their this that with from for and our privacy policy terms careers jobs press " +
        "founder owner director manager president partner buyer chef chief head officer " +
        "attorney attorneys lawyer dr mr mrs ms miss esq sir prof professor"
    ).split(" ")
);

export interface FoundPerson {
    name: string;
    title: string;
    quote: string;
}

function tidyTitle(raw: string): string {
    const t = raw
        .replace(/^(our|the)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
    return t
        .split(" ")
        .map(w =>
            /^(ceo|coo|cfo|cto|cmo|vp)$/i.test(w)
                ? w.toUpperCase()
                : /^(of|and|&)$/i.test(w)
                  ? w.toLowerCase()
                  : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        )
        .join(" ");
}

function plausibleName(name: string, orgWords: ReadonlySet<string>): boolean {
    const words = name.replace(/\s+[A-Z]\./, "").split(/\s+/);
    if (words.length !== 2) return false;
    const lower = words.map(w => w.toLowerCase().replace(/['’]s$/, ""));
    if (lower.some(w => w.length < 2 || NOT_A_NAME.has(w))) return false;
    if (!GIVEN_NAMES.has(lower[0]!)) return false;
    // A founder often shares the company's name; only the name itself is not a person.
    return !lower.every(w => orgWords.has(w));
}

function quoteAround(text: string, start: number, end: number, radius = 60): string {
    return text
        .slice(Math.max(0, start - radius), Math.min(text.length, end + radius))
        .replace(/\s+/g, " ")
        .trim();
}

/** Pure extraction from one page's cleaned text, exported for tests. */
export function extractPeople(text: string, orgName = ""): FoundPerson[] {
    const orgWords = new Set(
        orgName
            .toLowerCase()
            .split(/[^a-z'’]+/)
            .filter(w => w.length >= 3)
    );
    const found = new Map<string, FoundPerson>();
    for (const m of text.matchAll(TITLE_RE)) {
        const at = m.index;
        const end = at + m[0].length;
        const before = NAME_BEFORE.exec(text.slice(Math.max(0, at - 60), at));
        const after = before ? null : NAME_AFTER.exec(text.slice(end, end + 50));
        const name = (before?.[1] ?? after?.[1])?.trim();
        if (!name || !plausibleName(name, orgWords)) continue;
        const key = name.toLowerCase();
        if (found.has(key)) continue;
        found.set(key, { name, title: tidyTitle(m[0]), quote: quoteAround(text, at, end) });
        if (found.size >= 8) break;
    }
    return [...found.values()];
}

const LINKEDIN_PROFILE =
    /https?:\/\/(?:[a-z0-9-]+\.)*linkedin\.com\/(?:in\/[a-z0-9_%-]{3,100}|pub\/[a-z0-9_%-]+(?:\/\d+){1,4})(?:\/[a-z]{2})?/gi;

/** Public profile links in a page, each once. `www.` and country hosts both count. */
export function linkedinProfileUrls(text: string): string[] {
    LINKEDIN_PROFILE.lastIndex = 0;
    return [...new Set(text.match(LINKEDIN_PROFILE) ?? [])];
}

export interface LinkedInMention extends FoundPerson {
    url: string;
}

/** A name and title written beside a public LinkedIn profile link. */
export function linkedinMentions(text: string, orgName = ""): LinkedInMention[] {
    const found = new Map<string, LinkedInMention>();
    LINKEDIN_PROFILE.lastIndex = 0;
    for (const match of text.matchAll(LINKEDIN_PROFILE)) {
        const url = match[0];
        const around = text.slice(Math.max(0, match.index - 90), match.index);
        const person = extractPeople(around, orgName)[0];
        if (!person || found.has(person.name.toLowerCase())) continue;
        found.set(person.name.toLowerCase(), { ...person, url });
        if (found.size >= 5) break;
    }
    return [...found.values()];
}

/**
 * "Jane Doe - Founder - Acme | LinkedIn": the title a public profile page
 * gives itself. A title with no job beside the name is ignored.
 */
export function personFromLinkedInTitle(title: string | null): FoundPerson | null {
    if (!title) return null;
    const cleaned = title.replace(/\s*[|\-–—]\s*LinkedIn\s*$/i, "").trim();
    const parts = cleaned.split(/\s+[-–—|]\s+/);
    if (parts.length < 2) return null;
    const role = parts[1]!.replace(/\s+at\s+.*/i, "").trim();
    return extractPeople(`${parts[0]}, ${role}`)[0] ?? null;
}

/**
 * The public profile address for a first and last name: "Rob Ammons" becomes
 * https://www.linkedin.com/in/rob-ammons/ . A name that is not two words has
 * no single public address, so it is left alone.
 */
export function linkedinSlugUrl(name: string): string | null {
    return linkedinSlugCandidates(name).at(-1) ?? null;
}

/**
 * Addresses worth opening for a two-word name. Real profiles are often
 * `firstlast` (ceciliacorral) rather than `first-last`, so both are tried.
 * A longer address is not guessed.
 */
export function linkedinSlugCandidates(name: string): string[] {
    const words = name
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(word => word.length >= 2);
    if (words.length !== 2) return [];
    const [first, last] = words;
    return [
        `https://www.linkedin.com/in/${first}${last}/`,
        `https://www.linkedin.com/in/${first}-${last}/`,
    ];
}

/** https://www.linkedin.com/in/… or /pub/…, without a language suffix. */
export function canonicalLinkedInUrl(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null;
        const path = parsed.pathname.replace(/\/+$/, "").replace(/\/en$/i, "");
        if (!/^\/(?:in\/[a-z0-9_%-]{3,100}|pub\/[a-z0-9_%-]+(?:\/\d+){1,4})$/i.test(path))
            return null;
        return `https://www.linkedin.com${path}`;
    } catch {
        return null;
    }
}

/** The first profile address written in a piece of text. */
export function linkedinUrlInText(text: string): string | null {
    LINKEDIN_PROFILE.lastIndex = 0;
    const match = LINKEDIN_PROFILE.exec(text);
    return match ? canonicalLinkedInUrl(match[0]) : null;
}

function nameParts(name: string): { first: string; last: string } | null {
    const words = name
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(word => word.length >= 2);
    if (words.length < 2) return null;
    return { first: words[0]!, last: words.at(-1)! };
}

/**
 * The address is this person's own: `sambrasch74` and `kellyfitzsimmonsimpact`
 * start with the first and last name. `samanthabrasch` does not belong to Sam.
 */
export function linkedinSlugBelongsTo(url: string, name: string): boolean {
    const canonical = canonicalLinkedInUrl(url);
    const parts = nameParts(name);
    if (!canonical || !parts) return false;
    const letters = new URL(canonical).pathname
        .toLowerCase()
        .replace(/[^a-z]/g, "")
        .replace(/^(?:in|pub)/, "");
    return letters.startsWith(parts.first + parts.last);
}

/**
 * One profile address written next to this person's name. Two addresses that
 * both fit are a same-name collision, so neither is returned.
 */
export function linkedinUrlForPerson(text: string, name: string): string | null {
    if (!nameParts(name)) return null;
    const needle = name.toLowerCase();
    const lower = text.toLowerCase();
    const spots: number[] = [];
    for (let from = 0; from < lower.length; ) {
        const at = lower.indexOf(needle, from);
        if (at < 0) break;
        spots.push(at);
        from = at + needle.length;
    }
    if (spots.length === 0) return null;
    const found = new Set<string>();
    LINKEDIN_PROFILE.lastIndex = 0;
    for (const match of text.matchAll(LINKEDIN_PROFILE)) {
        if (!linkedinSlugBelongsTo(match[0], name)) continue;
        const near = spots.some(at => Math.abs(at - (match.index ?? 0)) <= 400);
        if (!near) continue;
        const url = canonicalLinkedInUrl(match[0]);
        if (url) found.add(url);
    }
    return found.size === 1 ? [...found][0]! : null;
}

const ORG_STOP = new Set([
    "group",
    "company",
    "capital",
    "partners",
    "advisors",
    "associates",
    "firm",
    "office",
    "offices",
    "project",
    "services",
    "international",
    "consulting",
    "solutions",
    "holdings",
    "enterprises",
    "corporation",
    "limited",
]);

/** Distinctive words of an organisation. "The Ammons Law Firm" → "ammons". */
export function organisationTokens(orgNames: readonly string[]): string[] {
    const tokens = new Set<string>();
    for (const name of orgNames) {
        for (const word of name.toLowerCase().split(/[^a-z0-9]+/)) {
            if (word.length >= 5 && !ORG_STOP.has(word)) tokens.add(word);
        }
    }
    return [...tokens];
}

function textHasName(text: string, name: string): boolean {
    const parts = nameParts(name);
    if (!parts) return false;
    return (
        new RegExp(`\\b${parts.first}\\b`, "i").test(text) &&
        new RegExp(`\\b${parts.last}\\b`, "i").test(text)
    );
}

function textHasOrg(text: string, orgNames: readonly string[], personName: string): boolean {
    const rest = text
        .replace(new RegExp(personName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ")
        .toLowerCase();
    return organisationTokens(orgNames).some(token => rest.includes(token));
}

export interface LinkedInSearchHit {
    url: string;
    title: string;
    content?: string;
}

export type LinkedInHitStatus = "matched" | "not_found" | "ambiguous";

/**
 * Search results that name this person at one of these organisations.
 * The profile address does not have to contain their name. The result title
 * does. Two profiles that both qualify are ambiguous and neither is used.
 * A surname inside the person's own name does not count as the organisation.
 */
const TITLE_STOP = new Set(["and", "the", "for", "of", "at", "our", "with"]);

/** Job-title words, with CEO / VP / co-founder written out so either form counts. */
function titleTokens(value: string): string[] {
    const norm = value
        .toLowerCase()
        .replace(/co-?founders?/g, "founder")
        .replace(/\bceos?\b/g, "chief executive officer")
        .replace(/\bctos?\b/g, "chief technology officer")
        .replace(/\bcfos?\b/g, "chief financial officer")
        .replace(/\bcoos?\b/g, "chief operating officer")
        .replace(/\bvps?\b/g, "vice president");
    return [
        ...new Set(
            norm.split(/[^a-z0-9]+/).filter(word => word.length >= 3 && !TITLE_STOP.has(word))
        ),
    ];
}

/**
 * Among several people who share the name and the company, keep the ones
 * whose headline actually carries this job. None of the words means the job
 * is a different one. A tie stays a tie.
 */
function narrowByTitle(hits: readonly LinkedInSearchHit[], jobTitle: string): LinkedInSearchHit[] {
    const wanted = titleTokens(jobTitle);
    if (wanted.length === 0) return [...hits];
    const scored = hits.map(hit => {
        const have = new Set(titleTokens(`${hit.title}\n${hit.content ?? ""}`));
        return { hit, score: wanted.filter(word => have.has(word)).length };
    });
    const best = Math.max(...scored.map(item => item.score));
    if (best === 0) return [];
    return scored.filter(item => item.score === best).map(item => item.hit);
}

export function classifyLinkedInHits(
    hits: readonly LinkedInSearchHit[],
    name: string,
    orgNames: readonly string[],
    jobTitle?: string | null
): { status: LinkedInHitStatus; url: string | null } {
    const confirmed: LinkedInSearchHit[] = [];
    const seen = new Set<string>();
    const fullName = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    for (const hit of hits) {
        const text = `${hit.title}\n${hit.content ?? ""}`;
        if (!fullName.test(text)) continue;
        if (!textHasOrg(text, orgNames, name)) continue;
        const url = canonicalLinkedInUrl(hit.url);
        if (!url || !/\/in\//i.test(new URL(url).pathname) || seen.has(url)) continue;
        seen.add(url);
        confirmed.push({ ...hit, url });
    }
    const chosen =
        confirmed.length > 1 && jobTitle?.trim() ? narrowByTitle(confirmed, jobTitle) : confirmed;
    if (chosen.length === 1) return { status: "matched", url: chosen[0]!.url };
    if (chosen.length === 0) return { status: "not_found", url: null };
    return { status: "ambiguous", url: null };
}

/** The one accepted profile, or null when nobody qualifies or more than one does. */
export function linkedinFromSearch(
    hits: readonly LinkedInSearchHit[],
    name: string,
    orgNames: readonly string[]
): string | null {
    return classifyLinkedInHits(hits, name, orgNames).url;
}

/**
 * A fetched profile page is this person at one of these organisations when
 * its title starts with their name and then names the organisation. A title
 * that is only the name and a job is not enough: that is how a namesake
 * gets attached.
 */
export function linkedinPageConfirms(
    title: string | null,
    name: string,
    orgNames: readonly string[]
): boolean {
    return linkedinTitleMatches(title, name) && textHasOrg(title ?? "", orgNames, name);
}

const ORG_PATHS = ["/people", "/our-team", "/team", "/about/our-team", "/our-board"];

/** Pages an organisation's own site often uses for its people. */
export function organisationPaths(origin: string): string[] {
    return ORG_PATHS.map(path => new URL(path, origin).href);
}

/** `HealthQuest Capital` → its likely public sites, `.com` then `.org`. */
export function organisationSiteUrls(orgName: string): string[] {
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (slug.length < 5) return [];
    return [`https://${slug}.com/`, `https://${slug}.org/`];
}

/**
 * The other organisation written in the same heading as the person:
 * "Sam Brasch | Partner, HealthQuest Capital". A further job title
 * ("Chief Innovation Officer") is not an organisation.
 */
export function organisationBeside(
    text: string,
    personName: string,
    companyName: string
): string | null {
    const at = text.toLowerCase().indexOf(personName.toLowerCase());
    if (at < 0) return null;
    const window = text
        .slice(at, at + 160)
        .split(/\.|\bRead\b/i)[0]!
        .trim();
    const company = companyName.toLowerCase();
    for (const raw of window.split(/[,|]/).reverse()) {
        const words = raw.trim().split(/\s+/);
        while (words.length > 0 && /^[a-z0-9&]/.test(words.at(-1)!)) words.pop();
        const phrase = words.join(" ").trim();
        if (!phrase || words.length > 5) continue;
        if (phrase.toLowerCase() === personName.toLowerCase()) continue;
        if (company && (phrase.toLowerCase() === company || company.includes(phrase.toLowerCase())))
            continue;
        TITLE_RE.lastIndex = 0;
        const title = TITLE_RE.exec(phrase);
        if (title && title[0].length >= phrase.length * 0.7) continue;
        if (!/^[A-Z0-9]/.test(phrase)) continue;
        return phrase;
    }
    return null;
}

/**
 * A fetched public profile belongs to this person when its title starts with
 * their name. The headline often names a job or another organisation and
 * leaves this company out, so the company is not required.
 */
export function linkedinTitleMatches(title: string | null, personName: string): boolean {
    if (!title) return false;
    const cleaned = title.replace(/\s*[|\-–—]\s*LinkedIn\s*$/i, "").trim();
    const head = cleaned
        .split(/\s+[-–—|]\s+/)[0]
        ?.trim()
        .toLowerCase();
    return head === personName.toLowerCase();
}

/**
 * LinkedIn's sign-in page, which names nobody. A real public profile still
 * prints "Agree & Join" and "New to LinkedIn" in the page chrome, so a title
 * that already names a person is a profile, not a wall.
 */
export function linkedinLoginWall(text: string, title?: string | null): boolean {
    const head =
        (title ?? "")
            .replace(/\s*[|\-–—]\s*LinkedIn\s*$/i, "")
            .split(/\s+[-–—|]\s+/)[0]
            ?.trim() ?? "";
    if (/^[A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+){1,2}$/.test(head)) return false;
    return /sign in to linkedin|join linkedin|authwall|agree & join|new to linkedin/i.test(
        `${title ?? ""}\n${text}`
    );
}

/**
 * Department and role mailboxes. A local part made of these words is an inbox,
 * not a person, even when the word is also a given name.
 */
const MAILBOX_ROLE =
    /^(info|sales|hello|contact|contacts|office|purchasing|einkauf|import|export|mail|team|support|admin|kontakt|verkoop|inkoop|orders?|hi|jobs|careers|career|press|media|suppliers?|customers?|service|services|enquiries|inquiries|inquiry|enquiry|marketing|hr|legal|finance|billing|accounts|accounting|recruiting|recruitment|pr|ir|investors?|news|newsletter|partners?|wholesale|retail|booking|bookings|reservations|help|helpdesk|reception|general|webmaster|postmaster|noreply|no-reply|abuse|privacy|compliance|security|ops|operations|procurement|vendors?|communications|comms|corporate|business|main)$/i;

/**
 * A public mailbox is a person only when its local part is a given name, or a
 * given name plus a surname ("jan@", "jan.devries@"). "suppliers@", "press@"
 * and "careers@" are inboxes and return null.
 */
export function personNameFromMailbox(local: string): string | null {
    const parts = local
        .toLowerCase()
        .split(/[._+-]+/)
        .map(part => part.replace(/[^a-z']/g, ""))
        .filter(Boolean);
    if (parts.length < 1 || parts.length > 3) return null;
    if (parts.some(part => part.length < 2 || MAILBOX_ROLE.test(part))) return null;
    if (!GIVEN_NAMES.has(parts[0]!)) return null;
    return parts.join(" ");
}

/**
 * The address a person's mail most likely goes to, from the addresses the
 * site publishes: one whose local part is their name ("anne@",
 * "anne.saxelby@", "asaxelby@").
 */
export function emailForPerson(name: string, emails: readonly string[]): string | null {
    const parts = name
        .toLowerCase()
        .replace(/\s+[a-z]\./, "")
        .split(/\s+/)
        .map(p => p.replace(/[^a-z]/g, ""));
    const first = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? "";
    if (!first || !last) return null;
    const shapes = new Set([
        first,
        `${first}.${last}`,
        `${first}_${last}`,
        `${first}${last}`,
        `${first[0]}${last}`,
        `${first[0]}.${last}`,
        last,
    ]);
    return emails.find(e => shapes.has(e.split("@")[0]!.toLowerCase())) ?? null;
}
