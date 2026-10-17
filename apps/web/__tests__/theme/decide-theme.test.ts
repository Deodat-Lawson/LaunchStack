/**
 * Which theme a workspace opens in when the account setting and this
 * browser's latest choice disagree: the later one.
 */

import { decideTheme } from "~/app/employer/_chrome/themeChoice";

const at = (iso: string) => Date.parse(iso);

describe("decideTheme", () => {
    it("opens dark for someone who never chose (the registry default)", () => {
        expect(decideTheme({ value: "dark", updatedAt: null }, null)).toEqual({
            theme: "dark",
            save: false,
        });
    });

    it("takes a choice made on the landing site and saves it to the account", () => {
        expect(decideTheme({ value: "dark", updatedAt: null }, { theme: "light", at: 1 })).toEqual({
            theme: "light",
            save: true,
        });
    });

    it("takes this browser's choice when it is newer than the saved one", () => {
        expect(
            decideTheme(
                { value: "dark", updatedAt: "2026-10-01T00:00:00.000Z" },
                { theme: "light", at: at("2026-10-02T00:00:00.000Z") }
            )
        ).toEqual({ theme: "light", save: true });
    });

    it("takes the account when it was saved later (another browser)", () => {
        expect(
            decideTheme(
                { value: "dark", updatedAt: "2026-10-03T00:00:00.000Z" },
                { theme: "light", at: at("2026-10-02T00:00:00.000Z") }
            )
        ).toEqual({ theme: "dark", save: false });
    });

    it("does not save when the two already agree", () => {
        expect(
            decideTheme(
                { value: "light", updatedAt: "2026-10-01T00:00:00.000Z" },
                { theme: "light", at: at("2026-10-05T00:00:00.000Z") }
            )
        ).toEqual({ theme: "light", save: false });
    });

    it("respects an explicit System", () => {
        expect(
            decideTheme({ value: "system", updatedAt: "2026-10-01T00:00:00.000Z" }, null)
        ).toEqual({ theme: "system", save: false });
    });

    it("gives up on a value that is not a theme", () => {
        expect(decideTheme({ value: "sepia", updatedAt: null }, null)).toBeNull();
    });
});
