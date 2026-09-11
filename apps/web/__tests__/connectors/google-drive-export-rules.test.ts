/**
 * The MIME decision table: what gets downloaded, what gets exported (and to
 * which target), what recurses, and what is skipped with a reason.
 */

import { resolveDriveAction } from "@launchstack/pipelines/connectors/google-drive";

describe("resolveDriveAction", () => {
    it("recurses into folders and resolves shortcuts", () => {
        expect(resolveDriveAction({ mimeType: "application/vnd.google-apps.folder" })).toEqual({
            action: "recurse",
        });
        expect(resolveDriveAction({ mimeType: "application/vnd.google-apps.shortcut" })).toEqual({
            action: "resolve-shortcut",
        });
    });

    it("exports Google-native files to formats the ingestion pipeline parses", () => {
        expect(resolveDriveAction({ mimeType: "application/vnd.google-apps.document" })).toEqual({
            action: "export",
            exportMime: "text/markdown",
            extension: ".md",
        });
        expect(
            resolveDriveAction({ mimeType: "application/vnd.google-apps.spreadsheet" })
        ).toMatchObject({ action: "export", extension: ".xlsx" });
        expect(
            resolveDriveAction({ mimeType: "application/vnd.google-apps.presentation" })
        ).toMatchObject({ action: "export", extension: ".pptx" });
        expect(
            resolveDriveAction({ mimeType: "application/vnd.google-apps.drawing" })
        ).toMatchObject({ action: "export", exportMime: "image/png" });
    });

    it("downloads types the ingestion pipeline already supports", () => {
        for (const mime of [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/csv",
            "image/png",
            "text/markdown",
        ]) {
            expect(resolveDriveAction({ mimeType: mime })).toEqual({ action: "download" });
        }
    });

    it("skips exportless Google types and unsupported formats, with reasons", () => {
        const form = resolveDriveAction({ mimeType: "application/vnd.google-apps.form" });
        expect(form.action).toBe("skip");

        const exe = resolveDriveAction({ mimeType: "application/x-msdownload" });
        expect(exe.action).toBe("skip");
    });
});
