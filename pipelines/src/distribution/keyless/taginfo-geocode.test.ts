/**
 * The two pieces that replaced hand-written lists: OpenStreetMap's own tag
 * vocabulary (taginfo) and its geocoder (Nominatim). Network is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { geocodePlace } from "../geocode";
import { osmVocabulary, resetOsmVocabulary } from "./taginfo";

const urlOf = (input: RequestInfo | URL): string =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

afterEach(() => resetOsmVocabulary());

describe("OpenStreetMap's vocabulary from taginfo", () => {
    it("keeps documented values of the business keys, as selectors with their descriptions", async () => {
        const asked: string[] = [];
        const fetchImpl: typeof fetch = async input => {
            const u = urlOf(input);
            asked.push(new URL(u).searchParams.get("key")!);
            const key = new URL(u).searchParams.get("key");
            return new Response(
                JSON.stringify({
                    data:
                        key === "shop"
                            ? [
                                  {
                                      value: "coffee",
                                      in_wiki: true,
                                      description: "Sells coffee beans",
                                  },
                                  { value: "yes", in_wiki: true, description: "Some shop" },
                                  { value: "Coffee Shop", in_wiki: false, description: null },
                                  { value: "secret", in_wiki: false, description: "" },
                              ]
                            : [],
                })
            );
        };
        const vocabulary = await osmVocabulary({ fetchImpl });
        expect(asked.sort()).toEqual(["amenity", "craft", "office", "shop"]);
        expect(vocabulary).toEqual([
            { selector: '["shop"="coffee"]', description: "Sells coffee beans" },
        ]);
        // Loaded once per process.
        await osmVocabulary({ fetchImpl });
        expect(asked).toHaveLength(4);
    });

    it("is empty, never thrown, when taginfo cannot be reached — and tries again next time", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const down: typeof fetch = async () => new Response("", { status: 503 });
        await expect(osmVocabulary({ fetchImpl: down })).resolves.toEqual([]);
        const up: typeof fetch = async () =>
            new Response(
                JSON.stringify({ data: [{ value: "bakery", in_wiki: true, description: "Bread" }] })
            );
        await expect(osmVocabulary({ fetchImpl: up })).resolves.toHaveLength(4);
        warn.mockRestore();
    });
});

describe("places from the geocoder", () => {
    const answer =
        (hit: object | null): typeof fetch =>
        async () =>
            new Response(JSON.stringify(hit ? [hit] : []));

    it("reads a US state the way the geocoder does, not as a country code", async () => {
        const place = await geocodePlace("Wilmington, DE", {
            fetchImpl: answer({
                addresstype: "city",
                address: { city: "Wilmington", state: "Delaware", country_code: "us" },
            }),
        });
        expect(place).toEqual({ country: "US", region: "Wilmington" });
    });

    it("gives a country alone for a country, and a state when no city is named", async () => {
        await expect(
            geocodePlace("Netherlands", {
                fetchImpl: answer({ addresstype: "country", address: { country_code: "nl" } }),
            })
        ).resolves.toEqual({ country: "NL" });
        await expect(
            geocodePlace("Texas", {
                fetchImpl: answer({
                    addresstype: "state",
                    address: { state: "Texas", country_code: "us" },
                }),
            })
        ).resolves.toEqual({ country: "US", region: "Texas" });
    });

    it("looks for a bare city in the company's own country first", async () => {
        const asked: Array<string | null> = [];
        const fetchImpl: typeof fetch = async input => {
            asked.push(new URL(urlOf(input)).searchParams.get("countrycodes"));
            return new Response(
                JSON.stringify([
                    { addresstype: "city", address: { city: "Austin", country_code: "us" } },
                ])
            );
        };
        await expect(geocodePlace("Austin", { homeCountry: "US", fetchImpl })).resolves.toEqual({
            country: "US",
            region: "Austin",
        });
        expect(asked).toEqual(["us"]);
    });

    it("is null when nothing is found or the geocoder is down, so the caller reads it offline", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await expect(
            geocodePlace("Nowhere-ville", { fetchImpl: answer(null) })
        ).resolves.toBeNull();
        await expect(
            geocodePlace("Baltimore", {
                fetchImpl: async () => new Response("", { status: 429 }),
            })
        ).resolves.toBeNull();
        warn.mockRestore();
    });
});
