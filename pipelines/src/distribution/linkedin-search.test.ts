import { describe, expect, it } from "vitest";

import { linkedInProfileUrl, openProfilesWith } from "./linkedin-search";

function profile(title: string, body: string): string {
    return `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

const wall = {
    html: profile("Sign Up | LinkedIn", "Agree & Join. New to LinkedIn."),
    finalUrl:
        "https://www.linkedin.com/authwall?sessionRedirect=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fkelly-fitzsimmons",
};

describe("linkedInProfileUrl", () => {
    it("looks the person up instead of guessing linkedin.com/in/first-last", () => {
        expect(linkedInProfileUrl("Kelly Fitzsimmons", ["Project Evident"])).toBe(
            "https://www.linkedin.com/search/results/people/?keywords=Kelly%20Fitzsimmons%20Project%20Evident"
        );
        expect(linkedInProfileUrl("Kelly Fitzsimmons", ["Project Evident"])).not.toContain(
            "/in/kelly-fitzsimmons"
        );
    });
});

function searchPage(cards: Array<{ url: string; name: string; line: string }>): string {
    const items = cards
        .map(
            card =>
                `<li><a href="${card.url}"><span>${card.name}</span></a><div>${card.line}</div></li>`
        )
        .join("");
    return `<html><head><title>Search | LinkedIn</title></head><body><ul>${items}</ul></body></html>`;
}

describe("opening a LinkedIn people search", () => {
    it("keeps the one result that names the person at the company", async () => {
        const found = await openProfilesWith(
            [{ name: "Kelly Fitzsimmons", orgs: ["Project Evident"] }],
            async () => ({
                html: searchPage([
                    {
                        url: "https://www.linkedin.com/in/kellyfitzsimmonsimpact",
                        name: "Kelly Fitzsimmons",
                        line: "Chief Executive Officer at Project Evident",
                    },
                ]),
                finalUrl: "https://www.linkedin.com/search/results/people/",
            })
        );
        expect(found.get("Kelly Fitzsimmons")).toEqual({
            status: "matched",
            url: "https://www.linkedin.com/in/kellyfitzsimmonsimpact",
        });
    });

    it("does not match the same name at a different organisation", async () => {
        const found = await openProfilesWith(
            [{ name: "Sam Brasch", orgs: ["HealthQuest Capital"] }],
            async () => ({
                html: searchPage([
                    {
                        url: "https://www.linkedin.com/in/sambrasch",
                        name: "Sam Brasch",
                        line: "Reporter at Colorado Public Radio",
                    },
                ]),
                finalUrl: "https://www.linkedin.com/search/results/people/",
            })
        );
        expect(found.get("Sam Brasch")).toEqual({ status: "not_found", url: null });
    });

    it("uses the job title when several people share the name and the company", async () => {
        const found = await openProfilesWith(
            [
                {
                    name: "Kelly Fitzsimmons",
                    orgs: ["Project Evident"],
                    title: "Chief Executive Officer",
                },
            ],
            async () => ({
                html: searchPage([
                    {
                        url: "https://www.linkedin.com/in/kelly-fitzsimmons",
                        name: "Kelly Fitzsimmons",
                        line: "Owner at Project Evident",
                    },
                    {
                        url: "https://www.linkedin.com/in/kellyfitzsimmonsimpact",
                        name: "Kelly Fitzsimmons",
                        line: "Chief Executive Officer at Project Evident",
                    },
                ]),
                finalUrl: "https://www.linkedin.com/search/results/people/",
            })
        );
        expect(found.get("Kelly Fitzsimmons")).toEqual({
            status: "matched",
            url: "https://www.linkedin.com/in/kellyfitzsimmonsimpact",
        });
    });

    it("keeps neither result when the job title does not separate them", async () => {
        const found = await openProfilesWith(
            [{ name: "Sam Brasch", orgs: ["HealthQuest Capital"], title: "Partner" }],
            async () => ({
                html: searchPage([
                    {
                        url: "https://www.linkedin.com/in/sambrasch74",
                        name: "Sam Brasch",
                        line: "Partner at HealthQuest Capital",
                    },
                    {
                        url: "https://www.linkedin.com/in/sam-brasch",
                        name: "Sam Brasch",
                        line: "Partner at HealthQuest Capital",
                    },
                ]),
                finalUrl: "https://www.linkedin.com/search/results/people/",
            })
        );
        expect(found.get("Sam Brasch")).toEqual({ status: "ambiguous", url: null });
    });

    it("does not treat a surname inside the person's own name as the organisation", async () => {
        const found = await openProfilesWith(
            [{ name: "Rob Ammons", orgs: ["The Ammons Law Firm"] }],
            async () => ({
                html: searchPage([
                    {
                        url: "https://www.linkedin.com/in/robammons",
                        name: "Rob Ammons",
                        line: "Partner",
                    },
                ]),
                finalUrl: "https://www.linkedin.com/search/results/people/",
            })
        );
        expect(found.get("Rob Ammons")).toEqual({ status: "not_found", url: null });
    });

    it("reports a page that is not a profile", async () => {
        const found = await openProfilesWith(
            [{ name: "Kelly Fitzsimmons", orgs: ["Project Evident"] }],
            async url => ({
                html: "<html><head><title>Page not found</title></head><body>Missing</body></html>",
                finalUrl: url,
            })
        );
        expect(found.get("Kelly Fitzsimmons")).toEqual({ status: "not_found", url: null });
    });

    it("stops when LinkedIn shows the sign-up wall and does not open the next person", async () => {
        const opened: string[] = [];
        const found = await openProfilesWith(
            [
                { name: "Kelly Fitzsimmons", orgs: ["Project Evident"] },
                { name: "Cecilia Corral", orgs: ["CareMessage"] },
            ],
            async url => {
                opened.push(url);
                return wall;
            }
        );
        expect(opened).toEqual([
            "https://www.linkedin.com/search/results/people/?keywords=Kelly%20Fitzsimmons%20Project%20Evident",
        ]);
        expect(found.get("Kelly Fitzsimmons")).toEqual({ status: "search_blocked", url: null });
        expect(found.get("Cecilia Corral")).toEqual({ status: "search_blocked", url: null });
    });

    it("records a timeout as an error", async () => {
        const found = await openProfilesWith(
            [{ name: "Kelly Fitzsimmons", orgs: ["Project Evident"] }],
            async () => ({ error: "timeout" })
        );
        expect(found.get("Kelly Fitzsimmons")).toEqual({ status: "search_error", url: null });
    });

    it("keeps one profile when the same address is listed twice", async () => {
        const found = await openProfilesWith(
            [{ name: "Kelly Fitzsimmons", orgs: ["Project Evident"] }],
            async () => ({
                html: searchPage([
                    {
                        url: "https://www.linkedin.com/in/kellyfitzsimmons/",
                        name: "Kelly Fitzsimmons",
                        line: "Chief Executive Officer at Project Evident",
                    },
                    {
                        url: "https://www.linkedin.com/in/kellyfitzsimmons",
                        name: "Kelly Fitzsimmons",
                        line: "Chief Executive Officer at Project Evident",
                    },
                ]),
                finalUrl: "https://www.linkedin.com/search/results/people/",
            })
        );
        expect(found.get("Kelly Fitzsimmons")).toEqual({
            status: "matched",
            url: "https://www.linkedin.com/in/kellyfitzsimmons",
        });
    });
});
