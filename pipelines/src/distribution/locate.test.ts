import { describe, expect, it } from "vitest";

import {
    bestTerritoryFit,
    countryFromHost,
    locateFromEvidence,
    mentionsPlace,
    parsePlace,
    parsePlaces,
    placeLabel,
    territoryFit,
} from "./locate";

describe("locateFromEvidence", () => {
    const baltimore = { country: "US", region: "Baltimore" };

    it("takes the location a result states, not the search's", () => {
        // A Baltimore search that returns a San Francisco company.
        expect(
            locateFromEvidence(
                "Mango — AI notes. Located in San Francisco, CA, USA.",
                "trymango.com",
                baltimore
            )
        ).toEqual({ country: "US", region: null });
        expect(
            locateFromEvidence(
                "Charm City Roasters, Baltimore, MD, USA",
                "charmroast.com",
                baltimore
            )
        ).toEqual({ country: "US", region: "Baltimore" });
    });

    it("knows nothing when the result says nothing (a .com is not a country)", () => {
        expect(
            locateFromEvidence("Coffee subscriptions for offices", "beanly.com", baltimore)
        ).toEqual({
            country: null,
            region: null,
        });
    });

    it("reads a country-code domain, and a country named in the text", () => {
        expect(locateFromEvidence("Kaffeerösterei", "roesterei.de", baltimore).country).toBe("DE");
        expect(locateFromEvidence("Roasters in Germany and Austria", null, baltimore).country).toBe(
            "DE"
        );
    });

    it("prefers the wanted country when the text names several", () => {
        expect(
            locateFromEvidence("Offices in Germany and the United States", null, baltimore).country
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
    it("maps country-code domains only", () => {
        expect(countryFromHost("acme.co.uk")).toBe("GB");
        expect(countryFromHost("acme.com")).toBeNull();
        expect(countryFromHost("acme.ai")).toBeNull();
    });

    it("matches places as whole words", () => {
        expect(mentionsPlace("Baltimore, MD", "baltimore")).toBe(true);
        expect(mentionsPlace("Baltimoreans love coffee", "Baltimore")).toBe(false);
        expect(mentionsPlace("Brussels", "us")).toBe(false);
    });
});

describe("parsePlace", () => {
    it("reads places the way people write them", () => {
        expect(parsePlace("Baltimore, MD, USA")).toEqual({ country: "US", region: "Baltimore" });
        expect(parsePlace("Amsterdam, Netherlands")).toEqual({
            country: "NL",
            region: "Amsterdam",
        });
        expect(parsePlace("Germany")).toEqual({ country: "DE" });
        expect(parsePlace("NL")).toEqual({ country: "NL" });
        expect(parsePlace("London, UK")).toEqual({ country: "GB", region: "London" });
    });

    it("reads a US state code after a city as the US", () => {
        expect(parsePlace("Austin, TX")).toEqual({ country: "US", region: "Austin" });
        expect(parsePlace("San Francisco, CA", "US")).toEqual({
            country: "US",
            region: "San Francisco",
        });
    });

    it("gives a bare city the company's own country, and nothing without one", () => {
        expect(parsePlace("Austin", "US")).toEqual({ country: "US", region: "Austin" });
        expect(parsePlace("Austin")).toBeNull();
    });

    it("splits several places on ';' or new lines, never on commas", () => {
        expect(parsePlaces("Baltimore, MD, USA; Netherlands\nBerlin, Germany")).toEqual([
            { country: "US", region: "Baltimore" },
            { country: "NL" },
            { country: "DE", region: "Berlin" },
        ]);
    });

    it("labels a territory for people", () => {
        expect(placeLabel({ country: "US", region: "Baltimore" })).toBe("Baltimore, United States");
        expect(placeLabel({ country: "NL" })).toBe("Netherlands");
    });
});
