import { driveFileUrl, driveUrlOfSyncedDocument } from "../google-drive-link";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("driveFileUrl", () => {
    it("opens native Google files in their editor", () => {
        expect(driveFileUrl(ID, "application/vnd.google-apps.document")).toBe(
            `https://docs.google.com/document/d/${ID}/edit`
        );
        expect(driveFileUrl(ID, "application/vnd.google-apps.spreadsheet")).toBe(
            `https://docs.google.com/spreadsheets/d/${ID}/edit`
        );
        expect(driveFileUrl(ID, "application/vnd.google-apps.presentation")).toBe(
            `https://docs.google.com/presentation/d/${ID}/edit`
        );
    });

    it("opens uploaded files in Drive's preview", () => {
        expect(driveFileUrl(ID, "application/pdf")).toBe(
            `https://drive.google.com/file/d/${ID}/view`
        );
        expect(driveFileUrl(ID)).toBe(`https://drive.google.com/file/d/${ID}/view`);
    });
});

describe("driveUrlOfSyncedDocument", () => {
    it("reads the Drive page of a connector-synced document", () => {
        expect(
            driveUrlOfSyncedDocument({
                connector: "google-drive",
                driveFileId: ID,
                driveMimeType: "application/vnd.google-apps.document",
            })
        ).toBe(`https://docs.google.com/document/d/${ID}/edit`);
    });

    it("is null for anything the Drive connector did not bring in", () => {
        expect(driveUrlOfSyncedDocument(null)).toBeNull();
        expect(driveUrlOfSyncedDocument({ connector: "notion", driveFileId: ID })).toBeNull();
        expect(driveUrlOfSyncedDocument({ connector: "google-drive" })).toBeNull();
        expect(
            driveUrlOfSyncedDocument({ connector: "google-drive", driveFileId: "../../x?y" })
        ).toBeNull();
    });
});
