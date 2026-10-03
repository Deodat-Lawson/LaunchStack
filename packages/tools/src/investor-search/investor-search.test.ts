import { beforeEach, describe, expect, it } from "vitest";

import {
    buildSearchUrl,
    filingUrl,
    findInvestors,
    keywordTerms,
    latestPerFund,
    parseFormD,
    isSingleDealVehicle,
    parseSearchResponse,
    relatedPerson,
    resetInvestorSearchCache,
} from "./index";

function urlOf(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    return input instanceof URL ? input.href : input.url;
}

/** Trimmed from a real filing: DCVC Energy & Climate II, L.P., May 2026. */
const FORM_D = `<?xml version="1.0"?>
<edgarSubmission>
    <submissionType>D</submissionType>
    <primaryIssuer>
        <cik>0002129288</cik>
        <entityName>DCVC Energy &amp; Climate II, L.P.</entityName>
        <issuerAddress><city>PALO ALTO</city><stateOrCountry>CA</stateOrCountry></issuerAddress>
        <issuerPhoneNumber>415-840-7337</issuerPhoneNumber>
    </primaryIssuer>
    <relatedPersonsList>
        <relatedPersonInfo>
            <relatedPersonName><firstName>Zachary</firstName><lastName>Bogue</lastName></relatedPersonName>
            <relatedPersonRelationshipList><relationship>Executive Officer</relationship></relatedPersonRelationshipList>
            <relationshipClarification>Managing Member of the General Partner</relationshipClarification>
        </relatedPersonInfo>
        <relatedPersonInfo>
            <relatedPersonName><firstName>Matthew</firstName><middleName>C.</middleName><lastName>Ocko</lastName></relatedPersonName>
            <relatedPersonRelationshipList>
                <relationship>Executive Officer</relationship>
                <relationship>Director</relationship>
            </relatedPersonRelationshipList>
        </relatedPersonInfo>
    </relatedPersonsList>
    <offeringData>
        <industryGroup><investmentFundInfo><investmentFundType>Venture Capital Fund</investmentFundType></investmentFundInfo></industryGroup>
        <typeOfFiling><dateOfFirstSale><yetToOccur>true</yetToOccur></dateOfFirstSale></typeOfFiling>
        <minimumInvestmentAccepted>0</minimumInvestmentAccepted>
        <offeringSalesAmounts>
            <totalOfferingAmount>500000000</totalOfferingAmount>
            <totalAmountSold>0</totalAmountSold>
        </offeringSalesAmounts>
        <investors><totalNumberAlreadyInvested>0</totalNumberAlreadyInvested></investors>
    </offeringData>
</edgarSubmission>`;

function hit(
    cik: string,
    name: string,
    fileDate: string,
    form = "D",
    adsh = `${cik}-26-000001`
): Record<string, unknown> {
    return {
        _id: `${adsh}:primary_doc.xml`,
        _source: {
            ciks: [cik],
            display_names: [`${name}  (CIK ${cik})`],
            biz_locations: ["Palo Alto, CA"],
            biz_states: ["CA"],
            file_date: fileDate,
            form,
            adsh,
        },
    };
}

const SEARCH = {
    hits: {
        total: { value: 3 },
        hits: [
            hit("0002129288", "DCVC Energy & Climate II, L.P.", "2026-05-29"),
            hit("0002083393", "Overture Climate Fund II LP", "2026-01-07"),
            // An amendment of the first fund, filed later: it wins.
            hit(
                "0002129288",
                "DCVC Energy & Climate II, L.P.",
                "2026-07-02",
                "D/A",
                "0002129288-26-000004"
            ),
            { _id: "broken", _source: { ciks: [] } },
        ],
    },
};

describe("the search query", () => {
    const now = new Date("2026-09-23T12:00:00Z");

    it("asks for venture funds over the last year by default", () => {
        const url = new URL(buildSearchUrl({}, now));
        expect(url.origin + url.pathname).toBe("https://efts.sec.gov/LATEST/search-index");
        expect(url.searchParams.get("q")).toBe('"Venture Capital Fund"');
        expect(url.searchParams.get("forms")).toBe("D");
        expect(url.searchParams.get("startdt")).toBe("2025-09-23");
        expect(url.searchParams.get("enddt")).toBe("2026-09-23");
        expect(url.searchParams.has("locationCodes")).toBe(false);
    });

    it("matches any of the words typed, and narrows to a state", () => {
        const url = new URL(
            buildSearchUrl({ keywords: ["climate, health care", "Climate"], state: "ca" }, now)
        );
        expect(url.searchParams.get("q")).toBe('"Venture Capital Fund" (climate OR "health care")');
        expect(url.searchParams.get("locationCodes")).toBe("CA");
    });

    it("cannot be turned into a different query by what is typed", () => {
        // Quotes and brackets are stripped, so an operator typed inside a
        // phrase stays part of the phrase; a bare operator is dropped.
        expect(keywordTerms(['seed") OR (x', "or", "a"])).toEqual(['"seed or x"']);
        const url = new URL(buildSearchUrl({ state: "California" }, now));
        expect(url.searchParams.has("locationCodes")).toBe(false);
    });
});

describe("reading the search response", () => {
    it("keeps each fund's latest filing, newest first, and drops broken rows", () => {
        const { total, hits } = parseSearchResponse(SEARCH);
        expect(total).toBe(3);
        expect(hits).toHaveLength(3);
        expect(hits[0]!.name).toBe("DCVC Energy & Climate II, L.P.");

        const latest = latestPerFund(hits);
        expect(latest.map(h => [h.name, h.filedAt, h.form])).toEqual([
            ["DCVC Energy & Climate II, L.P.", "2026-07-02", "D/A"],
            ["Overture Climate Fund II LP", "2026-01-07", "D"],
        ]);
    });

    it("links the form as SEC renders it", () => {
        expect(filingUrl({ cik: "0002129288", accession: "0002129288-26-000002" })).toBe(
            "https://www.sec.gov/Archives/edgar/data/2129288/000212928826000002/xslFormDX01/primary_doc.xml"
        );
    });
});

describe("reading a Form D", () => {
    it("names the people who run the fund and what it is raising", () => {
        const d = parseFormD(FORM_D);
        expect(d.managers).toEqual([
            {
                name: "Zachary Bogue",
                kind: "person",
                roles: ["Executive Officer"],
                title: "Managing Member of the General Partner",
            },
            {
                name: "Matthew C. Ocko",
                kind: "person",
                roles: ["Executive Officer", "Director"],
                title: undefined,
            },
        ]);
        expect(d.phone).toBe("415-840-7337");
        expect(d.fundType).toBe("Venture Capital Fund");
        expect(d.offeringAmount).toBe(500_000_000);
        expect(d.amountSold).toBe(0);
        expect(d.firstSale).toBeNull();
    });

    it("tells a general partner filed in the name fields from a person, and lists people first", () => {
        expect(relatedPerson("General Partner", undefined, "n2 Venture Capital I GP, LP")).toEqual({
            name: "n2 Venture Capital I GP, LP",
            kind: "entity",
        });
        expect(relatedPerson("N/A", undefined, "GPIH GP Limited")).toEqual({
            name: "GPIH GP Limited",
            kind: "entity",
        });
        expect(relatedPerson("Anujeshwar", undefined, "Totapudi")).toEqual({
            name: "Anujeshwar Totapudi",
            kind: "person",
        });

        const withGp = FORM_D.replace(
            "<relatedPersonsList>",
            `<relatedPersonsList><relatedPersonInfo>
                <relatedPersonName><firstName>General Partner</firstName><lastName>DCVC GP II, LLC</lastName></relatedPersonName>
                <relatedPersonRelationshipList><relationship>Promoter</relationship></relatedPersonRelationshipList>
            </relatedPersonInfo>`
        );
        expect(parseFormD(withGp).managers.map(m => [m.name, m.kind])).toEqual([
            ["Zachary Bogue", "person"],
            ["Matthew C. Ocko", "person"],
            ["DCVC GP II, LLC", "entity"],
        ]);
    });

    it('treats an "Indefinite" size as unknown, not zero', () => {
        const d = parseFormD(
            FORM_D.replace(
                "<totalOfferingAmount>500000000</totalOfferingAmount>",
                "<totalOfferingAmount>Indefinite</totalOfferingAmount>"
            ).replace("<yetToOccur>true</yetToOccur>", "<value>2026-06-15</value>")
        );
        expect(d.offeringAmount).toBeNull();
        expect(d.firstSale).toBe("2026-06-15");
    });
});

describe("findInvestors", () => {
    beforeEach(() => resetInvestorSearchCache());

    function fakeSec(failDocumentFor?: string) {
        const calls: Array<{ url: string; ua: string | null }> = [];
        const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = urlOf(input);
            calls.push({ url, ua: new Headers(init?.headers).get("User-Agent") });
            if (url.startsWith("https://efts.sec.gov/")) return Response.json(SEARCH);
            if (failDocumentFor && url.includes(failDocumentFor)) {
                return new Response("gone", { status: 404 });
            }
            return new Response(FORM_D, { status: 200 });
        }) as typeof fetch;
        return { calls, fetchImpl };
    }

    it("returns each fund with its people, declaring who is asking", async () => {
        const { calls, fetchImpl } = fakeSec();
        const result = await findInvestors(
            { keywords: ["climate"] },
            { fetchImpl, minGapMs: 0, userAgent: "Acme ops@acme.test" }
        );
        expect(result.source).toBe("sec-edgar-form-d");
        expect(result.totalFilings).toBe(3);
        expect(result.funds.map(f => f.name)).toEqual([
            "DCVC Energy & Climate II, L.P.",
            "Overture Climate Fund II LP",
        ]);
        const [first] = result.funds;
        expect(first!.amendment).toBe(true);
        expect(first!.detailed).toBe(true);
        expect(first!.managers[0]!.name).toBe("Zachary Bogue");
        expect(calls.every(c => c.ua === "Acme ops@acme.test")).toBe(true);
        // One search, then one document per fund.
        expect(calls).toHaveLength(3);
    });

    it("still returns a fund whose document could not be read", async () => {
        const { fetchImpl } = fakeSec("000208339326000001");
        const result = await findInvestors({}, { fetchImpl, minGapMs: 0 });
        const overture = result.funds.find(f => f.name.startsWith("Overture"));
        expect(overture).toMatchObject({
            detailed: false,
            managers: [],
            location: "Palo Alto, CA",
        });
    });

    it("reads a filing once per process", async () => {
        const { calls, fetchImpl } = fakeSec();
        await findInvestors({}, { fetchImpl, minGapMs: 0 });
        await findInvestors({}, { fetchImpl, minGapMs: 0 });
        expect(calls.filter(c => c.url.endsWith("primary_doc.xml"))).toHaveLength(2);
    });

    it("says when the search itself fails", async () => {
        const fetchImpl = (async () => new Response("", { status: 403 })) as typeof fetch;
        await expect(findInvestors({}, { fetchImpl, minGapMs: 0 })).rejects.toThrow(
            "SEC EDGAR 403"
        );
    });

    it("tries again when SEC answers a passing 500", async () => {
        let searches = 0;
        const fetchImpl = (async (input: RequestInfo | URL) => {
            const url = urlOf(input);
            if (url.startsWith("https://efts.sec.gov/")) {
                searches++;
                return searches === 1
                    ? new Response('{"message": "Internal server error"}', { status: 500 })
                    : Response.json(SEARCH);
            }
            return new Response(FORM_D);
        }) as typeof fetch;
        const result = await findInvestors({}, { fetchImpl, minGapMs: 0, retryDelayMs: 0 });
        expect(searches).toBe(2);
        expect(result.funds).toHaveLength(2);
    });
});

describe("single-deal vehicles", () => {
    beforeEach(() => resetInvestorSearchCache());

    it("recognises the names SPVs and syndicates file under", () => {
        for (const name of [
            "GVP Climate Series SPV LP - Zanskar",
            "Fund 12, a series of Acme Syndicates LLC",
            "Acme Co-Invest LP",
            "Climate Venture Capital, LP - F3 Series - Rivian",
            "IV Angels LLC - Series 6952",
            "922 Capital Fund LLC Series Z39",
            "Garage Syndicate Venture LLC - Series 13",
            "Beillion Capital LLC Project Grid",
        ]) {
            expect(isSingleDealVehicle(name)).toBe(true);
        }
        for (const name of [
            "DCVC Energy & Climate II, L.P.",
            "Overture Climate Fund II LP",
            "Series Seed Partners Fund I",
            "n2 Venture Capital Fund I, LP",
            "LMnT Ventures II, L.P.",
            "Series A Growth Fund LP",
        ]) {
            expect(isSingleDealVehicle(name)).toBe(false);
        }
    });

    function pagedSec() {
        const searches: string[] = [];
        const fetchImpl = (async (input: RequestInfo | URL) => {
            const url = urlOf(input);
            if (!url.startsWith("https://efts.sec.gov/")) return new Response(FORM_D);
            searches.push(url);
            const from = new URL(url).searchParams.get("from");
            const hits = from
                ? [hit("0000000003", "Later Page Ventures II LP", "2026-04-01")]
                : [
                      hit("0000000001", "GVP Climate Series SPV LP - Zanskar", "2026-08-01"),
                      hit("0000000002", "Overture Climate Fund II LP", "2026-01-07"),
                  ];
            return Response.json({ hits: { total: { value: 150 }, hits } });
        }) as typeof fetch;
        return { searches, fetchImpl };
    }

    it("leaves them out and says how many, reading on for real funds", async () => {
        const { searches, fetchImpl } = pagedSec();
        const result = await findInvestors({ limit: 5 }, { fetchImpl, minGapMs: 0 });
        expect(result.funds.map(f => f.name)).toEqual([
            "Later Page Ventures II LP",
            "Overture Climate Fund II LP",
        ]);
        expect(result.singleDealVehiclesHidden).toBe(1);
        expect(searches).toHaveLength(2);
        expect(new URL(searches[1]!).searchParams.get("from")).toBe("100");
    });

    it("keeps them when asked, and stops paging once the limit is met", async () => {
        const { searches, fetchImpl } = pagedSec();
        const result = await findInvestors(
            { limit: 2, includeSingleDealVehicles: true },
            { fetchImpl, minGapMs: 0 }
        );
        expect(result.funds.map(f => f.name)).toEqual([
            "GVP Climate Series SPV LP - Zanskar",
            "Overture Climate Fund II LP",
        ]);
        expect(result.singleDealVehiclesHidden).toBe(0);
        expect(searches).toHaveLength(1);
    });
});
