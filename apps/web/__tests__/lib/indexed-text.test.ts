import { readableMarkdown } from "~/lib/indexed-text";

/**
 * Stored sections open with the chunker's breadcrumb and have lost their
 * heading lines. Read back, each heading appears once, where the path
 * changes, at its depth — not a breadcrumb atop every section.
 */
describe("readableMarkdown", () => {
    const title = "Acme – Rockets for small teams";

    it("turns breadcrumbs back into headings, each written once", () => {
        expect(
            readableMarkdown(
                [
                    `${title} › Launch every week\n\nWe fly weekly.`,
                    `${title} › Launch every week\n\nFrom three pads.`,
                    `${title} › Launch every week › Pricing\n\nFree to start.`,
                    `${title} › Customers\n\nTeams in 12 countries.`,
                ],
                title
            )
        ).toBe(
            [
                "# Launch every week",
                "We fly weekly.",
                "From three pads.",
                "## Pricing",
                "Free to start.",
                "# Customers",
                "Teams in 12 countries.",
            ].join("\n\n")
        );
    });

    it("drops a breadcrumb that is only the title, and leaves prose alone", () => {
        expect(
            readableMarkdown(
                [`${title}\n\nIntro.`, "A first line of prose\n\nand a second paragraph."],
                title
            )
        ).toBe("Intro.\n\nA first line of prose\n\nand a second paragraph.");
    });

    it("never treats a long first paragraph as a breadcrumb", () => {
        const long = `${"word › ".repeat(60)}end`;
        expect(readableMarkdown([`${long}\n\nBody.`], title)).toBe(`${long}\n\nBody.`);
    });
});
