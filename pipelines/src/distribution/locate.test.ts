import { describe, expect, it } from "vitest";

import { bestTerritoryFit, locateFromEvidence, mentionsPlace, territoryFit } from "./locate";

describe("locateFromEvidence", () => {
    const baltimore = { country: "US", region: "Baltimore" };

    it("takes the location a result states, not the search's", () => {
        // A Baltimore search that returns a San Francisco company.
        expect(
            locateFromEvidence("Mango — AI notes. Located in San Francisco, CA, USA.", baltimore)
        ).toEqual({ country: "US", region: null });
        expect(locateFromEvidence("Charm City Roasters, Baltimore, MD, USA", baltimore)).toEqual({
            country: "US",
            region: "Baltimore",
        });
    });

    it("knows nothing when the result says nothing (a .com is not a country)", () => {
        expect(locateFromEvidence("Coffee subscriptions for offices", baltimore)).toEqual({
            country: null,
            region: null,
        });
    });

    it("reads a country named in the text, and not one guessed from a domain", () => {
        expect(locateFromEvidence("Kaffeerösterei", baltimore).country).toBeNull();
        expect(locateFromEvidence("Roasters in Germany and Austria", baltimore).country).toBe("DE");
    });

    it("prefers the wanted country when the text names several", () => {
        expect(
            locateFromEvidence("Offices in Germany and the United States", baltimore).country
        ).toBe("US");
    });
});

describe("territoryFit", () => {
    it("is out only on evidence, unknown otherwise", () => {
        const nl = { country: "NL" };
        expect(territoryFit({ country: "DE" }, nl)).toBe("out");
        expect(territoryFit({ country: null }, nl)).toBe("unknown");
        expect(territoryFit({ country: "NL" }, nl)).toBe("in");
    });

    it("checks the city or region when the territory names one", () => {
        const balt = { country: "US", region: "Baltimore" };
        expect(territoryFit({ country: "US", city: "Baltimore" }, balt)).toBe("in");
        expect(territoryFit({ country: "US", city: "San Francisco" }, balt)).toBe("out");
        expect(territoryFit({ country: "US" }, balt)).toBe("unknown");
    });

    it("takes the best fit across a segment's territories", () => {
        const ts = [{ country: "NL" }, { country: "DE" }];
        expect(bestTerritoryFit({ country: "DE" }, ts)).toBe("in");
        expect(bestTerritoryFit({ country: "FR" }, ts)).toBe("out");
        expect(bestTerritoryFit({ country: null }, ts)).toBe("unknown");
    });
});

describe("helpers", () => {
    it("matches places as whole words", () => {
        expect(mentionsPlace("Baltimore, MD", "baltimore")).toBe(true);
        expect(mentionsPlace("Baltimoreans love coffee", "Baltimore")).toBe(false);
        expect(mentionsPlace("Brussels", "us")).toBe(false);
    });
});
