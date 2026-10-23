/**
 * Where an imported vault's notes land: `Obsidian/<vault>`, with the vault's
 * own folders beneath it, always inside the folder rules (name length,
 * depth, path length) however deep or long the vault's folders are.
 */

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/folders", () => ({ createFolder: jest.fn() }));

import {
    MAX_FOLDER_DEPTH,
    MAX_FOLDER_NAME_CHARS,
    MAX_FOLDER_PATH_CHARS,
    splitFolderPath,
    validateFolderPath,
} from "~/lib/folders/path";
import { noteFolderPath, vaultFolderFor } from "~/server/services/connectors/obsidian/folder";

describe("vaultFolderFor", () => {
    it("nests the vault under Obsidian, and numbers a second vault of the same name", () => {
        expect(vaultFolderFor("Work")).toBe("Obsidian/Work");
        expect(vaultFolderFor("Work", 2)).toBe("Obsidian/Work (2)");
    });

    it("keeps an awkward vault name within the folder rules", () => {
        const long = vaultFolderFor(`${"x".repeat(200)}/sub`, 12);
        expect(validateFolderPath(long)).toBeNull();
        expect(long.endsWith(" (12)")).toBe(true);
        expect(splitFolderPath(long)[1]!.length).toBeLessThanOrEqual(MAX_FOLDER_NAME_CHARS);
        expect(vaultFolderFor("   ")).toBe("Obsidian/Vault");
    });
});

describe("noteFolderPath", () => {
    it("rebuilds the vault's folders beneath the vault folder", () => {
        expect(noteFolderPath("Obsidian/Work", "Projects/Q4")).toBe("Obsidian/Work/Projects/Q4");
        expect(noteFolderPath("Obsidian/Work", "")).toBe("Obsidian/Work");
    });

    it("folds folders deeper than the limit into the deepest allowed one", () => {
        const path = noteFolderPath("Obsidian/Work", "a/b/c/d/e/f/g/h/i");
        expect(splitFolderPath(path)).toHaveLength(MAX_FOLDER_DEPTH);
        expect(validateFolderPath(path)).toBeNull();
    });

    it("drops trailing folders until the path fits", () => {
        const segment = "y".repeat(MAX_FOLDER_NAME_CHARS);
        const path = noteFolderPath(
            "Obsidian/Work",
            [segment, segment, segment, segment].join("/")
        );
        expect(path.length).toBeLessThanOrEqual(MAX_FOLDER_PATH_CHARS);
        expect(validateFolderPath(path)).toBeNull();
        expect(path.startsWith("Obsidian/Work")).toBe(true);
    });
});
