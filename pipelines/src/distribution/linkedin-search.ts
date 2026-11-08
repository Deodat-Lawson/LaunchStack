/**
 * Opens a LinkedIn profile page and keeps the address only when that page
 * names the person and their organisation. A sign-up wall is reported and
 * is not replaced with a guessed address.
 */
import {
    canonicalLinkedInUrl,
    classifyLinkedInHits,
    linkedinLoginWall,
    linkedinPageConfirms,
    type LinkedInSearchHit,
} from "./people";

export type LinkedInLookupStatus =
    | "matched"
    | "not_found"
    | "ambiguous"
    | "search_blocked"
    | "search_error";

export interface LinkedInLookup {
    status: LinkedInLookupStatus;
    url: string | null;
}

export interface LinkedInSearchRequest {
    name: string;
    /** Company, then the other organisation written beside the person. */
    orgs: string[];
    /** Used only when more than one result has this name at the company. */
    title?: string | null;
}

const CLAIM_STATUS = /\[linkedin:(matched|not_found|ambiguous|search_blocked|search_error)\]/;

/** Status written at the start of a contact claim, if this search recorded one. */
export function linkedInClaimStatus(claim: string): LinkedInLookupStatus | null {
    const match = CLAIM_STATUS.exec(claim);
    return match ? (match[1] as LinkedInLookupStatus) : null;
}

/**
 * Where to look this person up when no profile page was confirmed.
 * A guessed linkedin.com/in/first-last address is not used: LinkedIn returns
 * 404 for most of those slugs.
 */
export function linkedInProfileUrl(name: string, orgs: readonly string[] = []): string {
    const keywords = [name, ...orgs.map(org => org.trim()).filter(Boolean)].join(" ");
    return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

export type LinkedInPageRead =
    | { kind: "profile"; title: string; text: string }
    | { kind: "blocked" };

const WALL_URL = /\/(authwall|signup|login|uas\/login|checkpoint)/i;
const WALL_TITLE = /^(sign up|sign in|login|join|join linkedin|authwall)$/i;

function stripTags(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function pageTitle(html: string): string {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return stripTags(match?.[1] ?? "");
}

/** A LinkedIn profile that can be read, or the sign-up wall. */
export function readLinkedInProfile(html: string, finalUrl: string): LinkedInPageRead {
    const title = pageTitle(html);
    const text = stripTags(html);
    const head =
        title
            .replace(/\s*[|\-–—]\s*LinkedIn\s*$/i, "")
            .split(/\s+[-–—|]\s+/)[0]
            ?.trim() ?? "";
    if (WALL_URL.test(finalUrl) || WALL_TITLE.test(head) || linkedinLoginWall(text, title)) {
        return { kind: "blocked" };
    }
    return { kind: "profile", title, text };
}

/**
 * Keep the opened profile only when its title names this person and then
 * names their organisation. The address does not have to contain their name.
 */
export function judgeOpenedProfile(args: {
    html: string;
    finalUrl: string;
    openedUrl: string;
    name: string;
    orgs: readonly string[];
}): LinkedInLookup {
    const page = readLinkedInProfile(args.html, args.finalUrl);
    if (page.kind === "blocked") return { status: "search_blocked", url: null };
    const url = canonicalLinkedInUrl(args.finalUrl) ?? canonicalLinkedInUrl(args.openedUrl);
    if (
        url &&
        /\/in\//i.test(new URL(url).pathname) &&
        linkedinPageConfirms(page.title, args.name, args.orgs)
    ) {
        return { status: "matched", url };
    }
    return { status: "not_found", url: null };
}

export type OpenedLinkedInPage =
    | { html: string; finalUrl: string }
    | { error: "timeout" | "failed" };

/** Profile cards on a LinkedIn people-search page. The same address is one card. */
export function linkedInSearchCards(html: string): LinkedInSearchHit[] {
    const byUrl = new Map<string, string>();
    const links = /<a\b[^>]*href="([^"]*\/in\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(links)) {
        let href = match[1]!.replace(/&amp;/g, "&");
        if (href.startsWith("/")) href = `https://www.linkedin.com${href}`;
        const url = canonicalLinkedInUrl(href);
        if (!url || !/\/in\//i.test(new URL(url).pathname)) continue;
        const start = (match.index ?? 0) + match[0].length;
        const rest = html.slice(start);
        const next = rest.search(/<a\b[^>]*href="[^"]*\/in\//i);
        const after = rest.slice(0, next >= 0 ? next : 800);
        const text = stripTags(`${match[2]} ${after}`);
        const prev = byUrl.get(url);
        byUrl.set(url, prev ? `${prev} ${text}` : text);
    }
    return [...byUrl].map(([url, text]) => ({ url, title: text, content: text }));
}

/**
 * One browser, contacts in order. Each contact is looked up as
 * "name company" on LinkedIn's people search. One result that names them at
 * the company is kept. Several are separated by job title, and a tie is kept
 * by neither. A sign-up wall stops the rest. A timeout is that contact's error.
 */
export async function openProfilesWith(
    people: readonly LinkedInSearchRequest[],
    open: (url: string) => Promise<OpenedLinkedInPage>
): Promise<Map<string, LinkedInLookup>> {
    const out = new Map<string, LinkedInLookup>();
    let blocked = false;
    for (const person of people) {
        if (blocked) {
            out.set(person.name, { status: "search_blocked", url: null });
            continue;
        }
        const searchUrl = linkedInProfileUrl(person.name, person.orgs);
        let opened: OpenedLinkedInPage;
        try {
            opened = await open(searchUrl);
        } catch {
            out.set(person.name, { status: "search_error", url: null });
            continue;
        }
        if ("error" in opened) {
            out.set(person.name, { status: "search_error", url: null });
            continue;
        }
        const page = readLinkedInProfile(opened.html, opened.finalUrl);
        if (page.kind === "blocked" || WALL_URL.test(opened.finalUrl)) {
            blocked = true;
            out.set(person.name, { status: "search_blocked", url: null });
            continue;
        }
        const found = classifyLinkedInHits(
            linkedInSearchCards(opened.html),
            person.name,
            person.orgs,
            person.title
        );
        out.set(person.name, found);
    }
    return out;
}
