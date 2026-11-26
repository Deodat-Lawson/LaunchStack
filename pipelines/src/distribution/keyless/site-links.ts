/**
 * Which of a page's links the keyless reader should open next.
 *
 * A company's homepage says where its contact page, its "about" page and its
 * imprint are: the links are in its navigation, in the site's own language
 * and under the site's own paths. Reading them costs a fraction of guessing
 * `/about`, `/kontakt` and the rest: on 180 recorded company sites, following
 * the best three links found a contact address on 74% of sites for 4 requests,
 * where 13 guessed paths found one on 58% and nine in ten guesses returned
 * nothing (pipelines/experiments/company-search/e3-what-to-read).
 *
 * The ranking is a fixed word list, not a model and not learned: a link takes
 * the weight of the heaviest kind of page its words name. Learning the weights
 * from one site to the next was tried in the same experiment and came out
 * level with this list.
 *
 * Languages: English, Dutch, German and Norwegian are the ones the experiment
 * measured. French, Spanish, Portuguese, Italian, Danish, Swedish, Finnish,
 * Polish and Czech cover the other countries the keyless search serves; their
 * words follow the same pattern but no recorded site tests them. Japanese and
 * Chinese links are recognised by a few whole words (see CJK_RULES).
 */
import type { ReadablePage } from "@launchstack/tools/web-research";

import { normalizeUrlForMatch } from "../dossier-agent";

export const LINK_CLASSES = [
    "contact",
    "about",
    "team",
    "careers",
    "legal",
    "quality",
    "products",
    "news",
    "shop",
    "other",
] as const;

export type LinkClass = (typeof LINK_CLASSES)[number];

interface Rule {
    id: string;
    cls: LinkClass;
    weight: number;
    /** Matched anywhere in a short anchor text or in a short path segment. */
    re: RegExp;
    /**
     * Short, ambiguous lead-in words ("over", "om", "über") that only count at
     * the start of an anchor text or of a top-level path segment.
     */
    startRe?: RegExp;
}

/**
 * Best first. A link takes the heaviest rule that matches it. The words are
 * matched against folded text (see `fold`): lower case, no accents, single
 * spaces.
 */
const RULES: Rule[] = [
    {
        id: "contact",
        cls: "contact",
        weight: 10,
        re: /\b(contact|contacts|contactus|contacteer|contactgegevens|contactpagina|contactformulier|kontakt|kontakte|kontaktformular|kontaktskjema|kontaktinfo|kontaktinformasjon|kontakta|contacto|contactez|contatti|contatto|get in touch|reach us|ta kontakt|neem contact|kom i kontakt|contactenos|contactanos|contactar|contacter|contato|contatos|contactos|fale conosco|fale connosco|contattaci|yhteystiedot|yhteydenotto|ota yhteytta|kontakty|napisz do nas|napiste nam)\b/,
    },
    {
        id: "imprint",
        cls: "legal",
        weight: 9,
        re: /\b(impressum|imprint|colofon|colophon|legal notice|site notice|mentions legales|aviso legal|bedrijfsgegevens|anbieterkennzeichnung|note legali|informazioni legali|informacoes legais|nota prawna|pravni informace)\b/,
    },
    {
        id: "about",
        cls: "about",
        weight: 8,
        re: /\b(about us|aboutus|about|over ons|overons|wie zijn wij|wie zijn we|wie we zijn|wie wij zijn|uber uns|ueber uns|uber mich|ueber mich|wir uber uns|wer wir sind|unternehmen|firma|om oss|omoss|om bedriften|om selskapet|hvem er vi|hvem vi er|who we are|our story|our company|company|ons verhaal|ons bedrijf|het bedrijf|bedrijf|bedrijfsprofiel|unternehmensprofil|firmenprofil|bedriftsprofil|firmaprofil|unsere geschichte|historie|history|geschichte|geschiedenis|mission|missie|visie|vision|values|verdier|waarden|werte|leitbild|organisatie|organisation|organization|organisasjon|a propos|qui sommes nous|sobre nosotros|quienes somos|chi siamo|philosophie|filosofie|notre histoire|notre entreprise|l entreprise|la societe|nuestra empresa|la empresa|nuestra historia|sobre nos|quem somos|a empresa|nossa historia|a nossa historia|l azienda|la nostra storia|om os|om virksomheden|om foretaget|vilka vi ar|vilka ar vi|meista|tietoa meista|yritys|yrityksesta|o nas|o firmie|o spolecnosti|kim jestesmy|kdo jsme)\b/,
        startRe: /^(about|over|om|uber|ueber|sobre)\b/,
    },
    {
        id: "team",
        cls: "team",
        weight: 6,
        re: /\b(team|teamet|medewerkers|mitarbeiter|mitarbeitende|mitarbeiterinnen|ansatte|people|mensen|leadership|management team|managementteam|ledelse|ledelsen|ledergruppe|ledergruppen|directie|geschaftsfuhrung|geschaeftsfuehrung|geschaftsleitung|geschaeftsleitung|vorstand|founders|oprichters|grunnleggere|board of directors|bestuur|styret|staff|personeel|wie is wie|ansprechpartner|contactpersonen|kontaktpersoner|equipe|equipo|equipa|medarbejdere|medarbetare|ledningsgrupp|ledningsgruppen|henkilosto|henkilokunta|tiimi|zespol|nas tym)\b/,
    },
    {
        id: "careers",
        cls: "careers",
        weight: 5,
        re: /\b(careers?|jobs?|vacatures?|vacancies|vacancy|karriere|karrieren|stellenangebote|stellenanzeigen|offene stellen|stellenmarkt|werken bij|work with us|work for us|working at|join us|join our team|join the team|we re hiring|were hiring|hiring|jobb hos oss|jobbe hos oss|ledige stillinger|ledig stilling|stillinger|recruitment|rekruttering|open positions|open roles|ausbildung|praktikum|internships?|emploi|recrutement|empleo|trabaja con nosotros|lavora con noi|solliciteren|bewerbung|bewerben)\b/,
    },
    {
        id: "support",
        cls: "contact",
        weight: 5,
        re: /\b(customer service|customer support|klantenservice|kundenservice|kundeservice|helpdesk|support|service desk|servicedesk)\b/,
    },
    {
        id: "quality",
        cls: "quality",
        weight: 5,
        re: /\b(quality|kwaliteit|qualitat|qualitaet|kvalitet|certificates?|certifications?|certified|certificaten|certificaat|certificering|certificeringen|zertifikate?|zertifizierung|zertifizierungen|zertifiziert|sertifikater|sertifikat|sertifisering|sertifiseringer|godkjenninger|iso|haccp|accreditations?|keurmerk|keurmerken|sustainability|duurzaamheid|duurzaam|nachhaltigkeit|baerekraft|miljo|environment|csr|mvo|esg|compliance|security|trust|trust center|hms|kvalitetssikring|qualitatsmanagement|qualitaetsmanagement)\b/,
    },
    {
        id: "products",
        cls: "products",
        weight: 3,
        re: /\b(products?|producten|produkte|produkter|produkt|services?|diensten|dienstverlening|dienstleistungen|leistungen|tjenester|tjeneste|solutions?|oplossingen|losungen|loesungen|losninger|what we do|wat we doen|wat wij doen|was wir tun|hva vi gjor|assortiment|sortiment|angebot|aanbod|features?|platform|pricing|prijzen|preise|priser|use cases?|industries|branchen|sectoren|bransjer|customers?|klanten|kunden|kunder|referenties|referenzen|referanser|references|cases?|case studies|projecten|projekte|prosjekter|projects|portfolio|catalogus|katalog|catalog|catalogue|brands|merken|marken|merker|partners?|wholesale|groothandel|grosshandel|engros|b2b|zakelijk|geschaftskunden|bedrift|bedriftskunder|distribution|distributie|vertrieb|import|export|handel|leveranciers|suppliers?|lieferanten|leverandorer|dealers?|verkooppunten|haendler|handler|forhandlere|resellers?|expertise|kompetanse|kompetenzen|fagomrader|werkwijze|how it works)\b/,
    },
    {
        id: "legal-other",
        cls: "legal",
        weight: 2,
        re: /\b(privacy|privacybeleid|privacyverklaring|privacy policy|privacy statement|datenschutz|datenschutzerklarung|datenschutzerklaerung|personvern|personvernerklaering|personvernerklaring|terms|terms of service|terms of use|terms and conditions|conditions|algemene voorwaarden|voorwaarden|agb|vilkar|betingelser|salgsbetingelser|kjopsvilkar|disclaimer|cookies?|cookiebeleid|cookie policy|cookieverklaring|gdpr|avg|legal|rechtliches|juridisch|widerruf|widerrufsrecht|widerrufsbelehrung|nutzungsbedingungen|leveringsvoorwaarden|retourneren|accessibility|toegankelijkheid|barrierefreiheit)\b/,
    },
    {
        id: "news",
        cls: "news",
        weight: 1,
        re: /\b(news|nieuws|aktuelles|aktuell|neuigkeiten|nyheter|nytt|aktuelt|blog|blogg|blogs|press|presse|pers|persberichten|pressemitteilungen|pressemeldinger|newsroom|media|events?|evenementen|veranstaltungen|termine|arrangementer|agenda|kalender|calendar|artikelen|artikel|artikler|articles|stories|verhalen|magazine|magazin|insights|resources|kennisbank|knowledge base|whitepapers?|podcasts?|webinars?|newsletter|nieuwsbrief|nyhetsbrev|updates|changelog|docs|documentation|dokumentasjon|help|help center|hilfe|hjelp|faq|faqs|veelgestelde vragen|haufige fragen|ofte stilte sporsmal|guides?|tutorials?|downloads?|library|bibliotheek|recepten|rezepte|oppskrifter|recipes)\b/,
    },
    {
        id: "shop",
        cls: "shop",
        weight: 0,
        re: /\b(shop|webshop|webwinkel|onlineshop|online shop|store|stores|winkel|winkels|nettbutikk|butikk|butikker|buy|kopen|kaufen|kjop|bestellen|bestel|order online|sale|aanbiedingen|angebote|tilbud|collections?|collectie|kollektion|kolleksjon|category|categories|categorie|categorieen|kategorie|kategorien|gift ?cards?|cadeaubon|cadeaukaart|gutschein|gutscheine|gavekort|menu|menukaart|speisekarte|meny|reserveren|reservieren|reservations?|book a table|bestill bord|booking|book now|boek nu)\b/,
    },
];

function ruleById(id: string): Rule {
    const rule = RULES.find(candidate => candidate.id === id);
    if (!rule) throw new Error(`No link rule called ${id}`);
    return rule;
}
const CONTACT = ruleById("contact");
const IMPRINT = ruleById("imprint");
const LEGAL_OTHER = ruleById("legal-other");

/**
 * Japanese and Chinese link words. These scripts have no spaces and no
 * accents to fold away, so they are matched in the anchor text as written,
 * before folding, and take the weight of the rule they name.
 */
const CJK_RULES: Array<{ rule: Rule; re: RegExp }> = [
    {
        rule: CONTACT,
        re: /お問い合わせ|お問合せ|お問合わせ|問い合わせ|連絡先|联系我们|聯絡我們|联系方式|聯絡方式|联络我们/,
    },
    {
        rule: ruleById("about"),
        re: /会社概要|会社案内|会社情報|企業情報|企業概要|私たちについて|关于我们|關於我們|公司简介|公司簡介|公司介绍|公司介紹|企业简介/,
    },
    {
        rule: ruleById("team"),
        re: /メンバー|役員紹介|スタッフ紹介|チーム紹介|团队|團隊|管理团队|經營團隊/,
    },
    { rule: ruleById("careers"), re: /採用情報|採用|求人|招聘|加入我们|加入我們|人才招募/ },
];
const CJK_UTILITY = /ログイン|カート|検索|登录|登入|登錄|购物车|購物車|搜索|搜尋/;

/** Utility links nobody opens to learn about a company: never followed. */
const UTILITY =
    /\b(cart|basket|winkelwagen|winkelmand|warenkorb|handlekurv|handlevogn|checkout|kassa|kasse|my account|mijn account|mein konto|min side|min konto|account|login|log in|inloggen|anmelden|einloggen|logg inn|sign in|signin|sign up|signup|register|registreren|registrieren|registrer|wishlist|verlanglijst|wunschliste|onskeliste|search|zoeken|suche|sok|sitemap|rss|feed|wp login|wp admin|admin|password|wachtwoord|passwort)\b/;
const HOME_ANCHOR =
    /^(home|homepage|start|startseite|startpagina|hjem|forside|hovedside|accueil|inicio)$/;
const HOME_SEGMENT = /^(home|index|index html|index htm|index php|start|startseite|hjem|forside)$/;

/** A leading path segment that only names the language of the page. */
const LANGUAGE_PREFIX =
    /^(en|nl|de|no|nb|nn|fr|es|it|sv|da|fi|pt|pl|us|uk|gb|int|en us|en gb|de de|nl nl|nb no)$/;

/** Anchor texts longer than this are teasers, not navigation labels. */
const MAX_ANCHOR_WORDS = 5;
/** Path segments longer than this are article slugs, not section names. */
const MAX_SEGMENT_WORDS = 4;
/** A CJK navigation label is a few characters; a sentence is not a label. */
const MAX_CJK_ANCHOR_CHARS = 16;

/** Lower-case, strip accents, keep letters and digits, single spaces. */
export function fold(text: string): string {
    return text
        .toLowerCase()
        .replace(/ß/g, "ss")
        .replace(/ø/g, "o")
        .replace(/æ/g, "ae")
        .replace(/ł/g, "l")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** Folded path segments, without a leading language segment. */
export function pathSegments(url: string): string[] {
    let pathname: string;
    try {
        pathname = new URL(url).pathname;
    } catch {
        return [];
    }
    const segments = pathname
        .split("/")
        .map(part => {
            try {
                return fold(decodeURIComponent(part));
            } catch {
                return fold(part);
            }
        })
        .filter(part => part.length > 0);
    if (segments.length > 1 && LANGUAGE_PREFIX.test(segments[0]!)) segments.shift();
    return segments;
}

function wordCount(folded: string): number {
    return folded === "" ? 0 : folded.split(" ").length;
}

export interface LinkScore {
    cls: LinkClass;
    /** The weight of the kind of page the link names; 0 when its words name none, -1 for a utility link. */
    score: number;
}

/** Kind and weight of a link from its anchor text and URL path. Pass "" for a link without text. */
export function scoreLink(anchor: string, url: string): LinkScore {
    const a = fold(anchor);
    const anchorWords = wordCount(a);
    const anchorUsable = anchorWords > 0 && anchorWords <= MAX_ANCHOR_WORDS;
    const segments = pathSegments(url);
    const last = segments.length > 0 ? segments[segments.length - 1]! : "";
    const lastUsable = last !== "" && wordCount(last) <= MAX_SEGMENT_WORDS;
    const first = segments.length > 1 ? segments[0]! : "";

    if (
        (anchorUsable && (UTILITY.test(a) || HOME_ANCHOR.test(a))) ||
        (lastUsable && (UTILITY.test(last) || HOME_SEGMENT.test(last)))
    ) {
        return { cls: "other", score: -1 };
    }

    const hit = (rule: Rule): { inAnchor: boolean; inLast: boolean } => ({
        inAnchor: anchorUsable && (rule.re.test(a) || (rule.startRe?.test(a) ?? false)),
        inLast:
            lastUsable &&
            (rule.re.test(last) || (segments.length === 1 && (rule.startRe?.test(last) ?? false))),
    });

    // A link that says "privacy", "terms" or "cookies" is that page, whatever
    // else its words suggest: "terms of service" is not a services page. Only
    // a contact page or an imprint outranks it.
    const legal = hit(LEGAL_OTHER);
    if (legal.inAnchor || legal.inLast) {
        const outranked = [CONTACT, IMPRINT].some(rule => {
            const h = hit(rule);
            return h.inAnchor || h.inLast;
        });
        if (!outranked)
            return {
                cls: LEGAL_OTHER.cls,
                score: LEGAL_OTHER.weight + (legal.inAnchor && legal.inLast ? 0.5 : 0),
            };
    }

    let best: LinkScore | null = null;
    for (const rule of RULES) {
        const { inAnchor, inLast } = hit(rule);
        const inFirst = first !== "" && rule.re.test(first);
        let score: number | null = null;
        if (inAnchor || inLast) score = rule.weight + (inAnchor && inLast ? 0.5 : 0);
        else if (inFirst) score = rule.weight * 0.5;
        if (score !== null && (best === null || score > best.score))
            best = { cls: rule.cls, score };
    }

    const label = anchor.trim();
    if (label.length > 0 && label.length <= MAX_CJK_ANCHOR_CHARS) {
        if (best === null && CJK_UTILITY.test(label)) return { cls: "other", score: -1 };
        for (const { rule, re } of CJK_RULES) {
            if (re.test(label) && (best === null || rule.weight > best.score))
                best = { cls: rule.cls, score: rule.weight };
        }
    }
    return best ?? { cls: "other", score: 0 };
}

/** Files, not pages: never worth a request. */
const FILE_EXTENSION =
    /\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|bmp|tiff?|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|odt|csv|mp[34]|m4[av]|mov|avi|wmv|webm|wav|ogg|exe|dmg|apk|ics|vcf|xml|json|rss|atom|css|js|woff2?|ttf|eot|txt)$/i;

/** Texts kept per link: a page can link the same URL from its menu, its footer and a button. */
const MAX_TEXTS_PER_LINK = 6;

/** Same site: the same hostname, with or without a leading "www.". */
function bareHost(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, "");
}

export interface SiteLink {
    /** Absolute URL, on the scheme and host the page itself answered on. */
    url: string;
    /** `normalizeUrlForMatch` of it: one entry per page of the site. */
    key: string;
    /** Every distinct text the page links it with, in page order. */
    texts: string[];
    cls: LinkClass;
    score: number;
}

/**
 * The links of a page that are worth a request, best first: other pages of
 * the same site (never a file, another host, or the page itself), each scored
 * by its best text, ties in page order. Login, cart, search and "home" links
 * are left out.
 *
 * Empty when the page has no such link, or when it carries no links at all (a
 * page that did not come from `fetchReadable`).
 */
export function rankSiteLinks(page: Pick<ReadablePage, "url" | "finalUrl" | "links">): SiteLink[] {
    let home: URL;
    try {
        home = new URL(page.finalUrl);
    } catch {
        return [];
    }
    const own = new Set([normalizeUrlForMatch(page.finalUrl), normalizeUrlForMatch(page.url)]);
    const found = new Map<string, { url: string; texts: string[] }>();
    for (const link of page.links ?? []) {
        let target: URL;
        try {
            target = new URL(link.url);
        } catch {
            continue;
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") continue;
        if (bareHost(target.hostname) !== bareHost(home.hostname)) continue;
        // One spelling per page: the scheme and host the page itself answered on.
        target.protocol = home.protocol;
        target.hostname = home.hostname;
        target.port = home.port;
        target.hash = "";
        target.username = "";
        target.password = "";
        if (FILE_EXTENSION.test(target.pathname)) continue;
        // Cloudflare's own endpoints (email protection, challenges), not pages of the site.
        if (target.pathname.startsWith("/cdn-cgi/")) continue;
        const key = normalizeUrlForMatch(target.href);
        if (own.has(key)) continue;
        const known = found.get(key);
        if (known) {
            if (
                link.text &&
                !known.texts.includes(link.text) &&
                known.texts.length < MAX_TEXTS_PER_LINK
            )
                known.texts.push(link.text);
            continue;
        }
        found.set(key, { url: target.href, texts: link.text ? [link.text] : [] });
    }

    const ranked: Array<SiteLink & { order: number }> = [];
    let order = 0;
    for (const [key, link] of found) {
        let best = scoreLink("", link.url);
        for (const text of link.texts) {
            const scored = scoreLink(text, link.url);
            if (scored.score > best.score) best = scored;
        }
        if (best.score >= 0) ranked.push({ ...link, key, cls: best.cls, score: best.score, order });
        order += 1;
    }
    ranked.sort((a, b) => b.score - a.score || a.order - b.order);
    return ranked.map(({ order: _order, ...link }) => link);
}
