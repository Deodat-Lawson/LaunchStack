/**
 * The fixed, multilingual keyword prior over links, and the link classes the
 * learned policies keep a posterior for.
 *
 * It was written before any site was recorded and is not tuned on the
 * results: the weights say which page a person would open first when looking
 * for a contact address, what the company does, how big it is, which
 * certificates it holds and what it calls itself. Languages: English, Dutch,
 * German, Norwegian, with a few French, Spanish and Italian words.
 */

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

/** Best first. A link takes the heaviest rule that matches it. */
const RULES: Rule[] = [
    {
        id: "contact",
        cls: "contact",
        weight: 10,
        re: /\b(contact|contacts|contactus|contacteer|contactgegevens|contactpagina|contactformulier|kontakt|kontakte|kontaktformular|kontaktskjema|kontaktinfo|kontaktinformasjon|kontakta|contacto|contactez|contatti|contatto|get in touch|reach us|ta kontakt|neem contact|kom i kontakt)\b/,
    },
    {
        id: "imprint",
        cls: "legal",
        weight: 9,
        re: /\b(impressum|imprint|colofon|colophon|legal notice|site notice|mentions legales|aviso legal|bedrijfsgegevens|anbieterkennzeichnung)\b/,
    },
    {
        id: "about",
        cls: "about",
        weight: 8,
        re: /\b(about us|aboutus|about|over ons|overons|wie zijn wij|wie zijn we|wie we zijn|wie wij zijn|uber uns|ueber uns|uber mich|ueber mich|wir uber uns|wer wir sind|unternehmen|firma|om oss|omoss|om bedriften|om selskapet|hvem er vi|hvem vi er|who we are|our story|our company|company|ons verhaal|ons bedrijf|het bedrijf|bedrijf|bedrijfsprofiel|unternehmensprofil|firmenprofil|bedriftsprofil|firmaprofil|unsere geschichte|historie|history|geschichte|geschiedenis|mission|missie|visie|vision|values|verdier|waarden|werte|leitbild|organisatie|organisation|organization|organisasjon|a propos|qui sommes nous|sobre nosotros|quienes somos|chi siamo|philosophie|filosofie)\b/,
        startRe: /^(about|over|om|uber|ueber)\b/,
    },
    {
        id: "team",
        cls: "team",
        weight: 6,
        re: /\b(team|teamet|medewerkers|mitarbeiter|mitarbeitende|mitarbeiterinnen|ansatte|people|mensen|leadership|management team|managementteam|ledelse|ledelsen|ledergruppe|ledergruppen|directie|geschaftsfuhrung|geschaeftsfuehrung|geschaftsleitung|geschaeftsleitung|vorstand|founders|oprichters|grunnleggere|board of directors|bestuur|styret|staff|personeel|wie is wie|ansprechpartner|contactpersonen|kontaktpersoner)\b/,
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
    if (!rule) throw new Error(`No prior rule called ${id}`);
    return rule;
}
const CONTACT = ruleById("contact");
const IMPRINT = ruleById("imprint");
const LEGAL_OTHER = ruleById("legal-other");

/** Utility links nobody opens to learn about a company: they sort last. */
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

/** Lower-case, strip accents, keep letters and digits, single spaces. */
export function fold(text: string): string {
    return text
        .toLowerCase()
        .replace(/ß/g, "ss")
        .replace(/ø/g, "o")
        .replace(/æ/g, "ae")
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
    score: number;
}

/**
 * Class and prior score of a link from its anchor text and URL path. A
 * sitemap URL has no anchor text: pass "".
 */
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
    return best ?? { cls: "other", score: 0 };
}

/** Rule weights, for the README and the results file. */
export function priorWeights(): Array<{ rule: string; cls: LinkClass; weight: number }> {
    return RULES.map(rule => ({ rule: rule.id, cls: rule.cls, weight: rule.weight }));
}
