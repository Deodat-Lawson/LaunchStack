/**
 * The keyless reader chooses its next pages from the homepage's own links.
 * These pin what a link's words are worth, in the languages the keyless
 * search serves, and which links are worth a request at all.
 */
import { describe, expect, it } from "vitest";

import type { PageLink } from "@launchstack/tools/web-research";

import { rankSiteLinks, scoreLink, type LinkClass } from "./site-links";

const on = (path: string): string => `https://acme.example${path}`;

describe("scoreLink", () => {
    it("puts contact, imprint, about and team ahead of products, news and the shop", () => {
        const order = [
            scoreLink("Contact", on("/contact")),
            scoreLink("Impressum", on("/impressum")),
            scoreLink("About us", on("/about-us")),
            scoreLink("Our team", on("/team")),
            scoreLink("Careers", on("/careers")),
            scoreLink("Products", on("/products")),
            scoreLink("Privacy policy", on("/privacy")),
            scoreLink("Blog", on("/blog")),
            scoreLink("Shop", on("/shop")),
        ];
        expect(order.map(s => s.cls)).toEqual([
            "contact",
            "legal",
            "about",
            "team",
            "careers",
            "products",
            "legal",
            "news",
            "shop",
        ]);
        const scores = order.map(s => s.score);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
        expect(scores[0]).toBe(10.5);
        expect(scores[scores.length - 1]).toBe(0.5);
    });

    it("reads the words of every language the keyless search serves", () => {
        const cases: Array<[label: string, path: string, cls: LinkClass]> = [
            // Measured in the experiment: English, Dutch, German, Norwegian.
            ["Get in touch", "/p/17", "contact"],
            ["Neem contact op", "/p/17", "contact"],
            ["Kontakt", "/p/17", "contact"],
            ["Kontakt oss", "/p/17", "contact"],
            ["Over ons", "/p/17", "about"],
            ["Über uns", "/p/17", "about"],
            ["Om oss", "/p/17", "about"],
            ["Unternehmen", "/p/17", "about"],
            ["Medewerkers", "/p/17", "team"],
            ["Ansatte", "/p/17", "team"],
            ["Geschäftsführung", "/p/17", "team"],
            ["Colofon", "/p/17", "legal"],
            // The other countries served: words only, no recorded site behind them.
            ["Nous contacter", "/p/17", "contact"],
            ["Contáctenos", "/p/17", "contact"],
            ["Fale conosco", "/p/17", "contact"],
            ["Contattaci", "/p/17", "contact"],
            ["Yhteystiedot", "/p/17", "contact"],
            ["Kontakty", "/p/17", "contact"],
            ["Qui sommes-nous ?", "/p/17", "about"],
            ["À propos", "/p/17", "about"],
            ["Quiénes somos", "/p/17", "about"],
            ["Sobre nós", "/p/17", "about"],
            ["Chi siamo", "/p/17", "about"],
            ["Om os", "/p/17", "about"],
            ["Om företaget", "/p/17", "about"],
            ["Tietoa meistä", "/p/17", "about"],
            ["O nas", "/p/17", "about"],
            ["O společnosti", "/p/17", "about"],
            ["Notre équipe", "/p/17", "team"],
            ["Nuestro equipo", "/p/17", "team"],
            ["Medarbejdere", "/p/17", "team"],
            ["Henkilöstö", "/p/17", "team"],
            ["Nasz zespół", "/p/17", "team"],
            ["Mentions légales", "/p/17", "legal"],
            ["Aviso legal", "/p/17", "legal"],
            ["Note legali", "/p/17", "legal"],
            // Japanese and Chinese, as written.
            ["お問い合わせ", "/p/17", "contact"],
            ["会社概要", "/p/17", "about"],
            ["联系我们", "/p/17", "contact"],
            ["关于我们", "/p/17", "about"],
        ];
        for (const [label, path, cls] of cases) {
            const scored = scoreLink(label, on(path));
            expect(scored.cls, label).toBe(cls);
            expect(scored.score, label).toBeGreaterThanOrEqual(6);
        }
    });

    it("falls back on the path when the link has no words", () => {
        expect(scoreLink("", on("/over-ons"))).toEqual({ cls: "about", score: 8 });
        expect(scoreLink("", on("/nl/contact/"))).toEqual({ cls: "contact", score: 10 });
        // A section name higher up the path counts for half.
        expect(scoreLink("", on("/about/a-page-with-a-long-title-of-its-own"))).toEqual({
            cls: "about",
            score: 4,
        });
        expect(scoreLink("", on("/p/17"))).toEqual({ cls: "other", score: 0 });
    });

    it("does not take a terms page for a services page, nor a teaser for a label", () => {
        expect(scoreLink("Terms of service", on("/terms-of-service"))).toEqual({
            cls: "legal",
            score: 2.5,
        });
        // Six words: a sentence that happens to say "contact", not a navigation label.
        expect(scoreLink("Read how we handled a contact request", on("/news/2026/story")).cls).toBe(
            "news"
        );
        // "ledning" is management in Swedish and a cable in Norwegian; "tym" is "team" in Czech and "this" in Polish.
        expect(scoreLink("Ledning", on("/p/17")).cls).toBe("other");
        expect(scoreLink("W tym miesiącu", on("/p/17")).cls).toBe("other");
    });

    it("marks login, cart, search and home links as never worth a request", () => {
        for (const [label, path] of [
            ["Log in", "/login"],
            ["Winkelwagen", "/cart"],
            ["Suche", "/suche"],
            ["Home", "/index.html"],
            ["", "/wp-admin"],
            ["ログイン", "/p/17"],
            // The word can sit anywhere in the path, not only at its end.
            ["Bestelhistorie", "/mijn-account/orders/"],
            ["Kaffeeabo verwalten", "/de/account/subscription"],
            ["", "/customer_authentication/redirect"],
        ] as const)
            expect(scoreLink(label, on(path)).score, `${label} ${path}`).toBe(-1);
    });
});

describe("rankSiteLinks", () => {
    const page = (links: PageLink[], finalUrl = "https://www.acme.example/") => ({
        url: "https://acme.example/",
        finalUrl,
        links,
    });

    it("keeps the site's own pages, one entry each, best words first and ties in page order", () => {
        const ranked = rankSiteLinks(
            page([
                { url: "https://www.acme.example/", text: "Home" },
                { url: "https://www.acme.example/producten", text: "Producten" },
                { url: "https://www.acme.example/blog", text: "Blog" },
                { url: "https://www.acme.example/over-ons", text: "" },
                { url: "http://acme.example/contact#form", text: "Stuur ons een bericht" },
                { url: "https://www.acme.example/login", text: "Inloggen" },
                { url: "https://www.acme.example/brochure.pdf", text: "Contact" },
                { url: "https://www.acme.example/cdn-cgi/l/email-protection", text: "Contact" },
                { url: "https://shop.acme.example/", text: "Contact" },
                { url: "https://facebook.com/acme", text: "About us" },
                { url: "https://www.acme.example/Contact/", text: "Contact" },
                { url: "https://www.acme.example/over-ons", text: "Wie zijn wij" },
                { url: "https://www.acme.example/vestigingen", text: "Vestigingen" },
                { url: "https://www.acme.example/dealers", text: "Dealers" },
            ])
        );
        expect(ranked.map(link => [link.url, link.cls, link.score])).toEqual([
            // The menu's "Contact" and the button's longer text are one page.
            ["https://www.acme.example/contact", "contact", 10.5],
            ["https://www.acme.example/over-ons", "about", 8.5],
            ["https://www.acme.example/producten", "products", 3.5],
            ["https://www.acme.example/dealers", "products", 3.5],
            ["https://www.acme.example/blog", "news", 1.5],
            ["https://www.acme.example/vestigingen", "other", 0],
        ]);
        expect(ranked[0]!.texts).toEqual(["Stuur ons een bericht", "Contact"]);
        expect(ranked[0]!.key).toBe("https://www.acme.example/contact");
    });

    it("leaves out a link the page calls nothing but a login, wherever it points", () => {
        const ranked = rankSiteLinks(
            page([
                // A shop platform's sign-in: "customer" in its path is not a page about customers.
                {
                    url: "https://www.acme.example/customer_authentication/redirect?locale=nl",
                    text: "Inloggen",
                },
                { url: "https://www.acme.example/portal", text: "Log in" },
                { url: "https://www.acme.example/portal", text: "Mijn account" },
                // Called a login once and by its own name once: the name counts.
                { url: "https://www.acme.example/klanten", text: "Inloggen" },
                { url: "https://www.acme.example/klanten", text: "Onze klanten" },
                // No words at all: the path speaks for it.
                { url: "https://www.acme.example/over-ons", text: "" },
                { url: "https://www.acme.example/zoeken", text: "" },
            ])
        );
        expect(ranked.map(link => [new URL(link.url).pathname, link.cls, link.score])).toEqual([
            ["/over-ons", "about", 8],
            ["/klanten", "products", 3.5],
        ]);
    });

    it("has nothing to offer for a page without links, or one that only links to itself", () => {
        expect(rankSiteLinks(page([]))).toEqual([]);
        expect(
            rankSiteLinks({ url: "https://acme.example/", finalUrl: "https://acme.example/" })
        ).toEqual([]);
        expect(
            rankSiteLinks(
                page(
                    [
                        { url: "https://acme.example/", text: "Acme" },
                        { url: "https://acme.example/en/", text: "English" },
                        { url: "https://acme.example/en/#pricing", text: "Pricing" },
                    ],
                    "https://acme.example/en/"
                )
            )
        ).toEqual([]);
    });
});
