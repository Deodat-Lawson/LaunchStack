/**
 * The subtree predicate is a LIKE pattern, so a folder name that contains a
 * LIKE metacharacter must not widen the match. Everything else in the module
 * is SQL against a live database and is exercised by the route tests and the
 * manual run in docs/design/nested-folders.md.
 */

jest.mock("~/server/db", () => ({ db: {} }));

import { FolderError, descendantPattern, escapeLikeLiteral } from "~/server/folders";

describe("escapeLikeLiteral", () => {
    it("escapes percent, underscore, and backslash", () => {
        expect(escapeLikeLiteral("50%_done\\x")).toBe("50\\%\\_done\\\\x");
        expect(escapeLikeLiteral("Contracts")).toBe("Contracts");
    });
});

describe("descendantPattern", () => {
    it("matches only paths strictly beneath the folder", () => {
        expect(descendantPattern("Contracts/2026")).toBe("Contracts/2026/%");
        expect(descendantPattern("Q&A_2026")).toBe("Q&A\\_2026/%");
    });
});

describe("FolderError", () => {
    it("carries a code and a status the route can report", () => {
        const error = new FolderError("folder_exists", 409, "exists");
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe("folder_exists");
        expect(error.status).toBe(409);
        expect(error.name).toBe("FolderError");
    });
});
