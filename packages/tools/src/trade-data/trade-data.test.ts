import { describe, expect, it } from "vitest";

import {
    createStaticTradeDataProvider,
    registerTradeDataProvider,
    resolveTradeDataProvider,
} from "./index";

const records = [
    {
        consignee: "Acme Import GmbH",
        consigneeCountry: "DE",
        shipper: "Beta Roasters",
        shipperCountry: "CO",
        hsCode: "0901.21",
        description: "roasted coffee",
        date: "2026-03-01",
        source: "static",
    },
    {
        consignee: "Dutch Delights BV",
        consigneeCountry: "NL",
        shipper: "Beta Roasters",
        shipperCountry: "CO",
        hsCode: "090121",
        description: "roasted coffee beans",
        date: "2025-01-01",
        source: "static",
    },
    {
        consignee: "Acme Import GmbH",
        consigneeCountry: "DE",
        shipper: "Gamma Tea",
        shipperCountry: "IN",
        hsCode: "0902",
        description: "black tea",
        date: "2026-05-01",
        source: "static",
    },
];

describe("static trade-data provider", () => {
    const provider = createStaticTradeDataProvider(records);
    it("filters by country, role, hs prefix and date", async () => {
        const de = await provider.searchShipments({
            country: "de",
            role: "importer",
            hsCodes: ["0901"],
        });
        expect(de.map(r => r.shipper)).toEqual(["Beta Roasters"]);
        const nl = await provider.searchShipments({
            country: "NL",
            role: "importer",
            keywords: ["coffee"],
            since: "2026-01-01",
        });
        expect(nl).toHaveLength(0);
        const co = await provider.searchShipments({ country: "CO", role: "exporter" });
        expect(co).toHaveLength(2);
    });
});

describe("resolveTradeDataProvider", () => {
    it("returns null for none or unknown, a provider for a registered name", () => {
        expect(resolveTradeDataProvider("none")).toBeNull();
        expect(resolveTradeDataProvider("does-not-exist")).toBeNull();
        registerTradeDataProvider("test-static", () =>
            createStaticTradeDataProvider(records, "test-static")
        );
        expect(resolveTradeDataProvider("test-static")?.name).toBe("test-static");
    });
});
