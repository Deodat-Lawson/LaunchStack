/**
 * The Google stand-in's world: one signed-in account (Alex Rivera), a small
 * My Drive, a data room someone else shared with Alex (with subfolders), and
 * a shared drive Alex belongs to. Content is short Markdown, CSV and text so
 * ingestion has something real to index.
 *
 * Access follows Google's two scopes, which is the point of the stand-in:
 * - `drive.readonly` sees everything the account can open.
 * - `drive.file` sees only what was picked in the Picker (or created by the
 *   app). Picking a folder grants the folder itself — listing it returns only
 *   children that were granted too, usually none.
 */

import { globalSlot, standInClock } from "../shared/store";

export const GOOGLE_BASE_PATH = "/dev/stand-ins/google";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_FULL_SCOPE = "https://www.googleapis.com/auth/drive";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DOC_MIME = "application/vnd.google-apps.document";

export const ACCOUNT = {
    sub: "stand-in-alex-rivera",
    email: "alex.rivera@example.com",
    name: "Alex Rivera",
} as const;

export interface StandInFile {
    id: string;
    name: string;
    mimeType: string;
    /** Parent folder id; `root` is My Drive. */
    parent: string | null;
    /** Set inside a shared drive. */
    driveId?: string;
    owner: string;
    /** In Alex's My Drive (owned); otherwise Shared with me or a shared drive. */
    ownedByMe: boolean;
    content?: string;
    version: number;
    modifiedTime: string;
    trashed: boolean;
}

export interface SharedDrive {
    id: string;
    name: string;
}

interface IssuedToken {
    scopes: string[];
    expiresAt: number;
}

interface IssuedCode {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    expiresAt: number;
}

export interface CallEntry {
    at: number;
    method: string;
    path: string;
    status: number;
}

export interface GoogleWorld {
    schema: number;
    files: Record<string, StandInFile>;
    drives: SharedDrive[];
    /** drive.file grants: ids picked in the Picker. */
    granted: string[];
    tokens: Record<string, IssuedToken>;
    refreshTokens: Record<string, string[]>;
    codes: Record<string, IssuedCode>;
    /** Changes feed: every write appends one entry. */
    changes: { seq: number; fileId: string }[];
    seq: number;
    calls: CallEntry[];
    counter: number;
}

const JORDAN = "jordan.lee@acme.example";

function iso(minutesAgo: number): string {
    return new Date(standInClock.now() - minutesAgo * 60_000).toISOString();
}

function seedFiles(): StandInFile[] {
    const file = (f: Omit<StandInFile, "version" | "modifiedTime" | "trashed">, ago: number) => ({
        ...f,
        version: 1,
        modifiedTime: iso(ago),
        trashed: false,
    });
    return [
        // ── My Drive ───────────────────────────────────────────────────────
        file(
            {
                id: "sa-mydrive-pitch",
                name: "Pitch notes",
                mimeType: DOC_MIME,
                parent: "root",
                owner: ACCOUNT.email,
                ownedByMe: true,
                content:
                    "# Pitch notes\n\nWe help seed-stage teams keep one record of what they decided and why.\n\n- Lead with the weekly review\n- Show the data room import live\n",
            },
            300
        ),
        // ── Shared with me: Jordan's data room ─────────────────────────────
        file(
            {
                id: "sa-dataroom",
                name: "Acme Seed Data Room",
                mimeType: FOLDER_MIME,
                parent: null,
                owner: JORDAN,
                ownedByMe: false,
            },
            2000
        ),
        file(
            {
                id: "sa-readme",
                name: "Read me first",
                mimeType: DOC_MIME,
                parent: "sa-dataroom",
                owner: JORDAN,
                ownedByMe: false,
                content:
                    "# Read me first\n\nThis room holds Acme's seed materials. Financials are in **Financials**, contracts in **Legal**.\n\nQuestions go to Jordan Lee.\n",
            },
            1900
        ),
        file(
            {
                id: "sa-captable",
                name: "Cap table summary.csv",
                mimeType: "text/csv",
                parent: "sa-dataroom",
                owner: JORDAN,
                ownedByMe: false,
                content:
                    "holder,class,shares,percent\nFounders,Common,8000000,72.7\nOption pool,Common,1500000,13.6\nSeed investors,Preferred,1500000,13.6\n",
            },
            1800
        ),
        file(
            {
                id: "sa-financials",
                name: "Financials",
                mimeType: FOLDER_MIME,
                parent: "sa-dataroom",
                owner: JORDAN,
                ownedByMe: false,
            },
            1700
        ),
        file(
            {
                id: "sa-plan",
                name: "FY2027 operating plan",
                mimeType: DOC_MIME,
                parent: "sa-financials",
                owner: JORDAN,
                ownedByMe: false,
                content:
                    "# FY2027 operating plan\n\nRevenue target: $1.2M ARR by December.\n\nHiring: two engineers in Q1, one seller in Q2.\n\nBurn stays under $95k a month.\n",
            },
            1600
        ),
        file(
            {
                id: "sa-unit",
                name: "Unit economics.md",
                mimeType: "text/markdown",
                parent: "sa-financials",
                owner: JORDAN,
                ownedByMe: false,
                content:
                    "# Unit economics\n\n| Metric | Value |\n| --- | --- |\n| CAC | $1,400 |\n| Gross margin | 81% |\n| Payback | 9 months |\n",
            },
            1500
        ),
        file(
            {
                id: "sa-archive",
                name: "Archive",
                mimeType: FOLDER_MIME,
                parent: "sa-financials",
                owner: JORDAN,
                ownedByMe: false,
            },
            1400
        ),
        file(
            {
                id: "sa-board",
                name: "2026 board update.txt",
                mimeType: "text/plain",
                parent: "sa-archive",
                owner: JORDAN,
                ownedByMe: false,
                content:
                    "2026 board update\n\nWe closed 14 design partners and shipped the folder import.\nNext: pricing test in March.\n",
            },
            1300
        ),
        file(
            {
                id: "sa-legal",
                name: "Legal",
                mimeType: FOLDER_MIME,
                parent: "sa-dataroom",
                owner: JORDAN,
                ownedByMe: false,
            },
            1200
        ),
        file(
            {
                id: "sa-termsheet",
                name: "Term sheet draft",
                mimeType: DOC_MIME,
                parent: "sa-legal",
                owner: JORDAN,
                ownedByMe: false,
                content:
                    "# Term sheet draft\n\nRaise: $3M seed on a $15M post-money SAFE.\n\nPro rata rights for investors above $250k.\n",
            },
            1100
        ),
        file(
            {
                id: "sa-figma",
                name: "Brand board.fig",
                mimeType: "application/octet-stream",
                parent: "sa-legal",
                owner: JORDAN,
                ownedByMe: false,
                content: "not a document",
            },
            1000
        ),
        // ── Shared drive: Founders Team ─────────────────────────────────────
        file(
            {
                id: "sa-research",
                name: "Customer research",
                mimeType: FOLDER_MIME,
                parent: "sa-drive-team",
                driveId: "sa-drive-team",
                owner: "Founders Team",
                ownedByMe: false,
            },
            900
        ),
        file(
            {
                id: "sa-interviews",
                name: "Interview notes — October",
                mimeType: DOC_MIME,
                parent: "sa-research",
                driveId: "sa-drive-team",
                owner: "Founders Team",
                ownedByMe: false,
                content:
                    "# Interview notes — October\n\nSix of eight founders keep decisions in Slack threads and lose them.\n\nTwo asked for a Google Drive import on day one.\n",
            },
            800
        ),
    ];
}

function seed(): GoogleWorld {
    const files: Record<string, StandInFile> = {};
    for (const f of seedFiles()) files[f.id] = f;
    // The shared drive's root folder: Drive gives it the drive's id.
    files["sa-drive-team"] = {
        id: "sa-drive-team",
        name: "Founders Team",
        mimeType: FOLDER_MIME,
        parent: null,
        driveId: "sa-drive-team",
        owner: "Founders Team",
        ownedByMe: false,
        version: 1,
        modifiedTime: iso(3000),
        trashed: false,
    };
    return {
        schema: 1,
        files,
        drives: [{ id: "sa-drive-team", name: "Founders Team" }],
        granted: [],
        tokens: {},
        refreshTokens: {},
        codes: {},
        changes: [],
        seq: 1,
        calls: [],
        counter: 0,
    };
}

const slot = globalSlot<GoogleWorld>("google", 1, seed);

export function googleWorld(): GoogleWorld {
    return slot.get();
}

export function resetGoogleWorld(): GoogleWorld {
    return slot.reset();
}

export function nextId(w: GoogleWorld, prefix: string): string {
    w.counter += 1;
    return `${prefix}-${w.counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Record a write in the changes feed. */
export function touch(w: GoogleWorld, fileId: string): void {
    w.seq += 1;
    w.changes.push({ seq: w.seq, fileId });
}

export function canReadEverything(scopes: readonly string[]): boolean {
    return scopes.includes(DRIVE_READONLY_SCOPE) || scopes.includes(DRIVE_FULL_SCOPE);
}

/** Whether a token with `scopes` may see this file. */
export function visible(w: GoogleWorld, scopes: readonly string[], file: StandInFile): boolean {
    if (canReadEverything(scopes)) return true;
    if (scopes.includes(DRIVE_FILE_SCOPE)) return w.granted.includes(file.id);
    return false;
}

/** The picker's own view: everything Alex can open, whatever the app was granted. */
export function pickerListing(
    w: GoogleWorld,
    view: "all" | "shared" | "drives",
    parent: string | null
): StandInFile[] {
    const all = Object.values(w.files).filter(f => !f.trashed);
    if (parent) return all.filter(f => f.parent === parent);
    if (view === "drives") return all.filter(f => w.drives.some(d => d.id === f.id));
    if (view === "shared") return all.filter(f => !f.ownedByMe && f.parent === null && !f.driveId);
    return all.filter(
        f => f.parent === "root" || (!f.ownedByMe && f.parent === null && !f.driveId)
    );
}

export function md5Of(file: StandInFile): string {
    // Not a real md5 — a stable fingerprint that changes with the content.
    let hash = 0;
    const text = `${file.content ?? ""}#${file.version}`;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return `standin${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Drive v3 file resource, the fields the app asks for. */
export function fileResource(file: StandInFile): Record<string, unknown> {
    // Google-native files and folders have no bytes, so no md5 or size; the
    // `version` counter is what moves when they change.
    const native = file.mimeType.startsWith("application/vnd.google-apps.");
    return {
        kind: "drive#file",
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        trashed: file.trashed,
        modifiedTime: file.modifiedTime,
        version: String(file.version),
        ...(file.parent ? { parents: [file.parent] } : {}),
        ...(file.driveId ? { driveId: file.driveId } : {}),
        ...(native
            ? {}
            : {
                  md5Checksum: md5Of(file),
                  size: String(new TextEncoder().encode(file.content ?? "").byteLength),
                  headRevisionId: `rev-${file.version}`,
              }),
    };
}

/** Stand-in actions for the viewer page and tests. */
export function addFileToFolder(w: GoogleWorld, folderId: string, name: string, content: string) {
    const parent = w.files[folderId];
    if (!parent || parent.mimeType !== FOLDER_MIME) throw new Error(`No folder ${folderId}`);
    const id = nextId(w, "sa-new");
    w.files[id] = {
        id,
        name,
        mimeType: name.endsWith(".md") ? "text/markdown" : "text/plain",
        parent: folderId,
        driveId: parent.driveId,
        owner: parent.owner,
        ownedByMe: parent.ownedByMe,
        content,
        version: 1,
        modifiedTime: new Date(standInClock.now()).toISOString(),
        trashed: false,
    };
    touch(w, id);
    return w.files[id];
}

export function editFile(w: GoogleWorld, fileId: string, append: string) {
    const file = w.files[fileId];
    if (!file) throw new Error(`No file ${fileId}`);
    file.content = `${file.content ?? ""}${append}`;
    file.version += 1;
    file.modifiedTime = new Date(standInClock.now()).toISOString();
    touch(w, fileId);
    return file;
}
