/**
 * The website a person types at onboarding becomes a profile fact and the
 * address its homepage is imported from, so anything that is not a web
 * address has to be refused rather than saved and fetched.
 */
import { normalizeWebsite } from "~/lib/company-profile/website";

describe("normalizeWebsite", () => {
    it.each([
        ["acme.com", "https://acme.com/"],
        ["  acme.com  ", "https://acme.com/"],
        ["www.acme.co.uk/about", "https://www.acme.co.uk/about"],
        ["http://acme.com", "http://acme.com/"],
        ["https://acme.com/#team", "https://acme.com/"],
        ["HTTPS://Acme.com/Path?q=1", "https://acme.com/Path?q=1"],
    ])("%s → %s", (raw, expected) => {
        expect(normalizeWebsite(raw)).toBe(expected);
    });

    it.each([
        [""],
        ["   "],
        ["acme"],
        ["acme .com"],
        ["we make software"],
        ["ftp://acme.com"],
        ["javascript:alert(1)"],
        ["mailto:hi@acme.com"],
        ["acme."],
        ["https://"],
    ])("refuses %j", raw => {
        expect(normalizeWebsite(raw)).toBeNull();
    });

    it("refuses nothing at all", () => {
        expect(normalizeWebsite(undefined)).toBeNull();
        expect(normalizeWebsite(null)).toBeNull();
    });
});

describe("normalizeWebsite and credentials", () => {
    it("refuses an address that carries a login", () => {
        expect(normalizeWebsite("https://user:pass@acme.com")).toBeNull();
        expect(normalizeWebsite("admin@acme.com")).toBeNull();
    });

    it("keeps a port", () => {
        expect(normalizeWebsite("acme.com:8080")).toBe("https://acme.com:8080/");
    });
});
