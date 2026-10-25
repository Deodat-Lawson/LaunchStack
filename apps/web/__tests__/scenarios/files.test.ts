/**
 * The new-scenario form's files as plain functions: what kind a file is, which
 * are the company's own (and so listed first), which uploads the form takes,
 * and which size preset a pair of sliders matches.
 */
import {
    SIZE_PRESETS,
    acceptsUpload,
    fileKind,
    filterFiles,
    isCompanyFile,
    presetFor,
} from "~/app/employer/tools/scenarios/_lib/files";
import { SCENARIO_LIMITS, type ScenarioFileOption } from "~/lib/scenarios/types";

function file(over: Partial<ScenarioFileOption> & { id: number }): ScenarioFileOption {
    return {
        title: `File ${over.id}.pdf`,
        folder: null,
        mimeType: null,
        addedAt: "2026-10-01T00:00:00.000Z",
        status: "ready",
        aboutCompany: false,
        ...over,
    };
}

describe("fileKind", () => {
    it("reads the title's extension before a generic stored type", () => {
        expect(fileKind({ title: "Plan.md", mimeType: "text/plain" })).toBe("text");
        expect(fileKind({ title: "Deck.pptx", mimeType: null })).toBe("slides");
        expect(fileKind({ title: "Numbers.csv", mimeType: "text/plain" })).toBe("sheet");
        expect(fileKind({ title: "Terms.PDF", mimeType: null })).toBe("pdf");
    });

    it("falls back to the stored type, then to a plain file", () => {
        expect(
            fileKind({
                title: "Board update",
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            })
        ).toBe("doc");
        expect(fileKind({ title: "Pricing", mimeType: "application/pdf; charset=binary" })).toBe(
            "pdf"
        );
        expect(fileKind({ title: "https://acme.com/pricing", mimeType: null })).toBe("web");
        expect(fileKind({ title: "Untitled", mimeType: "" })).toBe("file");
        expect(fileKind({ title: "Untitled", mimeType: null })).toBe("file");
    });

    it("calls a recording's transcript a transcript", () => {
        expect(fileKind({ title: "All hands (transcription)", mimeType: "text/plain" })).toBe(
            "transcript"
        );
    });
});

describe("isCompanyFile", () => {
    it("is what the profile counts, or anything in the Company folder", () => {
        expect(isCompanyFile({ aboutCompany: true, folder: "Research" })).toBe(true);
        expect(isCompanyFile({ aboutCompany: false, folder: "Company" })).toBe(true);
        expect(isCompanyFile({ aboutCompany: false, folder: "Company/Decks" })).toBe(true);
        expect(isCompanyFile({ aboutCompany: false, folder: "Companyish" })).toBe(false);
        expect(isCompanyFile({ aboutCompany: false, folder: null })).toBe(false);
    });
});

describe("filterFiles", () => {
    const files = [
        file({ id: 1, title: "Churn notes.docx", folder: "Research" }),
        file({ id: 2, title: "Pitch deck.pptx", folder: "Company" }),
        file({ id: 3, title: "Press kit.pdf", folder: "Marketing", aboutCompany: true }),
        file({ id: 4, title: "Pricing page.md", folder: "Marketing" }),
    ];

    it("puts the company's files first and keeps the server's order within each", () => {
        expect(filterFiles(files, "").map(f => f.id)).toEqual([2, 3, 1, 4]);
    });

    it("matches a title or a folder, ignoring case", () => {
        expect(filterFiles(files, "PRIC").map(f => f.id)).toEqual([4]);
        expect(filterFiles(files, "marketing").map(f => f.id)).toEqual([3, 4]);
        expect(filterFiles(files, "  ").map(f => f.id)).toEqual([2, 3, 1, 4]);
    });

    it("leaves the list it was given alone", () => {
        filterFiles(files, "");
        expect(files.map(f => f.id)).toEqual([1, 2, 3, 4]);
    });
});

describe("acceptsUpload", () => {
    it("takes the documents a company keeps about itself", () => {
        for (const name of ["deck.pptx", "Plan.DOCX", "prices.xlsx", "notes.md", "page.html"])
            expect(acceptsUpload(name)).toBe(true);
    });

    it("refuses anything else, including files with no extension", () => {
        for (const name of ["song.mp3", "photo.png", "archive.zip", "README", ".env"])
            expect(acceptsUpload(name)).toBe(false);
    });
});

describe("presetFor", () => {
    it("names the preset the sliders match, and none when they match none", () => {
        const standard = presetFor(SCENARIO_LIMITS.agents.default, SCENARIO_LIMITS.rounds.default);
        expect(standard?.id).toBe("standard");
        expect(presetFor(31, 8)).toBeNull();
    });

    it("keeps every preset inside the limits the server enforces", () => {
        const { agents, rounds } = SCENARIO_LIMITS;
        for (const p of SIZE_PRESETS) {
            expect(p.agents).toBeGreaterThanOrEqual(agents.min);
            expect(p.agents).toBeLessThanOrEqual(agents.max);
            expect(p.rounds).toBeGreaterThanOrEqual(rounds.min);
            expect(p.rounds).toBeLessThanOrEqual(rounds.max);
        }
    });
});
