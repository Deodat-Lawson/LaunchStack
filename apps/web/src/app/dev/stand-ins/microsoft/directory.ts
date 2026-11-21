/**
 * Who exists in the Microsoft stand-in: one tenant (Harlow Reed LLP, a
 * fictional accounting firm), two people who can sign in, and the outside
 * correspondents their mail is with. Every domain is under the reserved
 * `.example` name, so nothing here resolves.
 */

export const MICROSOFT_BASE_PATH = "/dev/stand-ins/microsoft";

export const TENANT_ID = "7c1f6a52-3b0e-4d7a-9f1e-5a2b8c4d6e10";
export const TENANT_NAME = "Harlow Reed LLP";

export const SHAREPOINT_HOST = "harlowreed.sharepoint.example";
export const ONEDRIVE_HOST = "harlowreed-my.sharepoint.example";

export interface StandInPerson {
    name: string;
    address: string;
}

export interface StandInAccount {
    /** Short key used in seeded ids (`mf-morgan-inbox`). */
    key: string;
    oid: string;
    email: string;
    name: string;
    jobTitle: string;
    /** Their OneDrive. */
    driveId: string;
}

export const MORGAN: StandInAccount = {
    key: "morgan",
    oid: "a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601",
    email: "morgan.ellis@harlowreed.example",
    name: "Morgan Ellis",
    jobTitle: "Partner",
    driveId: "b!morgan-onedrive",
};

export const PRIYA: StandInAccount = {
    key: "priya",
    oid: "b4e2d3c5-6c7f-4a81-9ba2-c3d4e5f6a702",
    email: "priya.nair@harlowreed.example",
    name: "Priya Nair",
    jobTitle: "Senior Associate",
    driveId: "b!priya-onedrive",
};

/** The accounts the consent screen offers; the first is the default. */
export const ACCOUNTS: readonly StandInAccount[] = [MORGAN, PRIYA];

export function person(account: StandInAccount): StandInPerson {
    return { name: account.name, address: account.email };
}

export const DANA: StandInPerson = {
    name: "Dana Whitfield",
    address: "dana.whitfield@northgate-bakery.example",
};
export const TOMAS: StandInPerson = {
    name: "Tomas Okafor",
    address: "tomas@lumendental.example",
};
export const ELENA: StandInPerson = {
    name: "Elena Marsh",
    address: "elena.marsh@brightwater-logistics.example",
};
export const BILLING: StandInPerson = {
    name: "Harlow Reed Accounts",
    address: "accounts@harlowreed.example",
};
export const LEARNING: StandInPerson = {
    name: "Harlow Reed Learning",
    address: "learning@harlowreed.example",
};
