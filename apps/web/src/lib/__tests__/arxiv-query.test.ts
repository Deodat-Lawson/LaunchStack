import { arxivSearchQuery } from "../arxiv-query";

describe("arxivSearchQuery", () => {
    it("sends each word as its own term", () => {
        expect(arxivSearchQuery("large language model")).toBe(
            "%28all:large+OR+all:language+OR+all:model%29"
        );
    });

    it("applies the category to the whole query", () => {
        expect(arxivSearchQuery("dynamic pricing", "econ.*")).toBe(
            "%28all:dynamic+OR+all:pricing%29+AND+cat:econ.*"
        );
    });

    it("drops characters that would break the query syntax", () => {
        expect(arxivSearchQuery('  "graph (neural)"  nets ')).toBe(
            "%28all:graph+OR+all:neural+OR+all:nets%29"
        );
    });

    it("encodes each word and skips bare symbols", () => {
        expect(arxivSearchQuery("C++ & Rust")).toBe("%28all:C%2B%2B+OR+all:Rust%29");
    });
});
