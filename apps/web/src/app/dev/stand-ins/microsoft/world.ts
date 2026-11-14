/**
 * The Microsoft stand-in's world: one tenant (Harlow Reed LLP), two accounts
 * that can sign in, each with a OneDrive and a mailbox, and two SharePoint
 * sites with a document library each. Files are real, small .docx / .xlsx /
 * .pdf / text payloads so ingestion has something to parse.
 *
 * Everything a sync has to notice can be made to happen from here: a file
 * edited (cTag and eTag move), renamed (eTag only), removed or added; a reply
 * arriving in a conversation; a message deleted; consent revoked; delta
 * tokens expired.
 */

import { globalSlot, standInClock } from "../shared/store";
import { ACCOUNTS, DANA, type StandInAccount, type StandInPerson } from "./directory";
import {
    docxFromMarkdown,
    pdfFromLines,
    quickXorHash,
    utf8,
    xlsxFromRows,
    type Bytes,
} from "./office";
import {
    SEED_DRIVES,
    SEED_SITES,
    seedItems,
    type FileSource,
    type SeedDrive,
    type SeedSite,
} from "./seed-drive";
import {
    composeBodies,
    mailFolderId,
    seedMail,
    type SeedMailFolder,
    type SeedMessage,
} from "./seed-mail";

export {
    ACCOUNTS,
    MICROSOFT_BASE_PATH,
    MORGAN,
    PRIYA,
    TENANT_ID,
    TENANT_NAME,
    type StandInAccount,
    type StandInPerson,
} from "./directory";
export {
    CLIENTS_DRIVE_ID,
    CLIENTS_SITE_ID,
    KNOWLEDGE_DRIVE_ID,
    KNOWLEDGE_SITE_ID,
    SAMPLE_SHARING_URL,
} from "./seed-drive";

export const FILES_SCOPES = ["Files.Read.All", "Sites.Read.All"] as const;
export const MAIL_SCOPE = "Mail.Read";

export type StandInSite = SeedSite;
export type StandInDrive = SeedDrive;
export type StandInMailFolder = SeedMailFolder;

export interface StandInItem {
    id: string;
    driveId: string;
    /** Parent folder id; null only for a drive's root. */
    parent: string | null;
    name: string;
    kind: "folder" | "file" | "notebook";
    mimeType?: string;
    /** What the bytes were built from, so an edit can rebuild them. */
    source?: FileSource;
    content?: Bytes;
    /** Moves on any change: the eTag. */
    version: number;
    /** Moves when the bytes change: the cTag. */
    contentVersion: number;
    lastModifiedDateTime: string;
    sharingUrl?: string;
}

export interface StandInMessage extends SeedMessage {
    /** Position in the mailbox's change order; delta reads from it. */
    seq: number;
}

interface IssuedCode {
    clientId: string;
    redirectUri: string;
    oid: string;
    scopes: string[];
    expiresAt: number;
}

interface IssuedToken {
    oid: string;
    scopes: string[];
    expiresAt: number;
}

interface IssuedRefreshToken {
    oid: string;
    scopes: string[];
}

export interface CallEntry {
    at: number;
    method: string;
    path: string;
    status: number;
}

export interface MicrosoftWorld {
    schema: number;
    sites: StandInSite[];
    drives: Record<string, StandInDrive>;
    items: Record<string, StandInItem>;
    mailFolders: Record<string, StandInMailFolder>;
    messages: Record<string, StandInMessage>;
    /** Deleted messages, kept so delta can report them. */
    removedMessages: { id: string; oid: string; folderId: string; seq: number }[];
    mailSeq: number;
    /** Delta and paging tokens carry this; bumping it invalidates them all. */
    deltaEpoch: number;
    codes: Record<string, IssuedCode>;
    tokens: Record<string, IssuedToken>;
    refreshTokens: Record<string, IssuedRefreshToken>;
    calls: CallEntry[];
    counter: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pdf: "application/pdf",
    md: "text/markdown",
    txt: "text/plain",
    csv: "text/csv",
    png: "image/png",
};

export function mimeTypeFor(name: string): string {
    const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
    return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function render(source: FileSource): Bytes {
    switch (source.kind) {
        case "text":
            return utf8(source.text);
        case "docx":
            return docxFromMarkdown(source.markdown);
        case "xlsx":
            return xlsxFromRows(source.rows);
        case "pdf":
            return pdfFromLines(source.lines);
    }
}

/** Graph timestamps carry no milliseconds. */
export function isoSeconds(ms: number): string {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function seed(): MicrosoftWorld {
    const now = standInClock.now();
    const drives: Record<string, StandInDrive> = {};
    const items: Record<string, StandInItem> = {};
    for (const drive of SEED_DRIVES) {
        drives[drive.id] = drive;
        items[drive.rootId] = {
            id: drive.rootId,
            driveId: drive.id,
            parent: null,
            name: "root",
            kind: "folder",
            version: 1,
            contentVersion: 1,
            lastModifiedDateTime: isoSeconds(now - 30_000 * 60_000),
        };
    }
    for (const item of seedItems()) {
        items[item.id] = {
            id: item.id,
            driveId: item.driveId,
            parent: item.parent,
            name: item.name,
            kind: item.kind,
            mimeType: item.kind === "file" ? mimeTypeFor(item.name) : undefined,
            source: item.source,
            content: item.source ? render(item.source) : undefined,
            version: 1,
            contentVersion: 1,
            lastModifiedDateTime: isoSeconds(now - item.minutesAgo * 60_000),
            sharingUrl: item.sharingUrl,
        };
    }

    const mail = seedMail(now);
    const mailFolders: Record<string, StandInMailFolder> = {};
    for (const folder of mail.folders) mailFolders[folder.id] = folder;
    const messages: Record<string, StandInMessage> = {};
    // Oldest first, so the change order reads like the mailbox filled up over time.
    const ordered = [...mail.messages].sort((a, b) =>
        a.receivedDateTime.localeCompare(b.receivedDateTime)
    );
    ordered.forEach((message, i) => {
        messages[message.id] = { ...message, seq: i + 1 };
    });

    return {
        schema: 1,
        sites: SEED_SITES,
        drives,
        items,
        mailFolders,
        messages,
        removedMessages: [],
        mailSeq: ordered.length,
        deltaEpoch: 1,
        codes: {},
        tokens: {},
        refreshTokens: {},
        calls: [],
        counter: 0,
    };
}

const slot = globalSlot<MicrosoftWorld>("microsoft", 1, seed);

export function microsoftWorld(): MicrosoftWorld {
    return slot.get();
}

export function resetMicrosoftWorld(): MicrosoftWorld {
    return slot.reset();
}

export function nextId(w: MicrosoftWorld, prefix: string): string {
    w.counter += 1;
    return `${prefix}-${w.counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function accountByOid(oid: string): StandInAccount | undefined {
    return ACCOUNTS.find(a => a.oid === oid);
}

// ── Drive items ────────────────────────────────────────────────────────────

export function childrenOf(w: MicrosoftWorld, item: StandInItem): StandInItem[] {
    return Object.values(w.items)
        .filter(i => i.parent === item.id)
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Folder names from the drive's root down to (and including) this item. */
function pathNames(w: MicrosoftWorld, item: StandInItem): string[] {
    const names: string[] = [];
    for (let at: StandInItem | undefined = item; at?.parent; at = w.items[at.parent]) {
        names.unshift(at.name);
    }
    return names;
}

export function webUrlOf(w: MicrosoftWorld, item: StandInItem): string {
    const base = w.drives[item.driveId]!.webUrl;
    return [base, ...pathNames(w, item).map(encodeURIComponent)].join("/");
}

export function sizeOf(w: MicrosoftWorld, item: StandInItem): number {
    if (item.kind === "file") return item.content?.byteLength ?? 0;
    return childrenOf(w, item).reduce((total, child) => total + sizeOf(w, child), 0);
}

/** A Graph driveItem. */
export function driveItemResource(w: MicrosoftWorld, item: StandInItem): Record<string, unknown> {
    const drive = w.drives[item.driveId]!;
    const parent = item.parent ? w.items[item.parent] : undefined;
    const parentPath = parent
        ? [`/drives/${drive.id}/root:`, ...pathNames(w, parent).map(encodeURIComponent)].join("/")
        : undefined;
    return {
        id: item.id,
        name: item.name,
        size: sizeOf(w, item),
        eTag: `"{${item.id}},${item.version}"`,
        cTag: `"c:{${item.id}},${item.contentVersion}"`,
        lastModifiedDateTime: item.lastModifiedDateTime,
        webUrl: webUrlOf(w, item),
        parentReference: parent
            ? { driveId: drive.id, driveType: drive.driveType, id: parent.id, path: parentPath }
            : { driveId: drive.id, driveType: drive.driveType },
        ...(item.kind === "file"
            ? {
                  file: {
                      mimeType: item.mimeType ?? "application/octet-stream",
                      hashes: { quickXorHash: quickXorHash(item.content ?? new Uint8Array(0)) },
                  },
              }
            : item.kind === "folder"
              ? { folder: { childCount: childrenOf(w, item).length } }
              : { package: { type: "oneNote" } }),
        ...(parent ? {} : { root: {} }),
    };
}

function comparableUrl(raw: string): string {
    const bare = raw.split(/[?#]/)[0]!.replace(/\/+$/, "");
    try {
        return decodeURI(bare).toLowerCase();
    } catch {
        return bare.toLowerCase();
    }
}

/** The item a pasted link points at: its address-bar URL or its "Copy link" URL. */
export function itemBySharingUrl(w: MicrosoftWorld, url: string): StandInItem | undefined {
    const wanted = comparableUrl(url);
    return Object.values(w.items).find(
        item =>
            comparableUrl(webUrlOf(w, item)) === wanted ||
            (item.sharingUrl !== undefined && comparableUrl(item.sharingUrl) === wanted)
    );
}

/** Mark an item changed, and every folder above it, as OneDrive does. */
function bump(w: MicrosoftWorld, item: StandInItem, contentChanged: boolean): void {
    const now = isoSeconds(standInClock.now());
    for (
        let at: StandInItem | undefined = item;
        at;
        at = at.parent ? w.items[at.parent] : undefined
    ) {
        at.version += 1;
        if (contentChanged) at.contentVersion += 1;
        at.lastModifiedDateTime = now;
    }
}

function requireItem(w: MicrosoftWorld, itemId: string): StandInItem {
    const item = w.items[itemId];
    if (!item) throw new Error(`No item ${itemId}`);
    return item;
}

const DEFAULT_EDIT = "Edited after the import: fieldwork now ends on 27 October.";

/**
 * Change a file's content: a new paragraph, row or line, whichever the format
 * holds. Size, cTag, eTag, quickXorHash and lastModifiedDateTime all move.
 */
export function editFile(w: MicrosoftWorld, itemId: string, addition = DEFAULT_EDIT): StandInItem {
    const item = requireItem(w, itemId);
    if (item.kind !== "file") throw new Error(`${itemId} is not a file`);
    const source = item.source ?? { kind: "text", text: "" };
    switch (source.kind) {
        case "text":
            source.text = `${source.text}\n${addition}\n`;
            break;
        case "docx":
            source.markdown = `${source.markdown}\n${addition}\n`;
            break;
        case "xlsx":
            source.rows = [...source.rows, [addition]];
            break;
        case "pdf":
            source.lines = [...source.lines, "", addition];
            break;
    }
    item.source = source;
    item.content = render(source);
    bump(w, item, true);
    return item;
}

/** Rename a file or folder: eTag and webUrl move, cTag does not. */
export function renameItem(w: MicrosoftWorld, itemId: string, name: string): StandInItem {
    const item = requireItem(w, itemId);
    if (!item.parent) throw new Error("A drive's root cannot be renamed");
    item.name = name;
    if (item.kind === "file") item.mimeType = mimeTypeFor(name);
    item.version += 1;
    item.lastModifiedDateTime = isoSeconds(standInClock.now());
    return item;
}

/** Remove a file, or a folder with everything in it. Returns the ids removed. */
export function deleteItem(w: MicrosoftWorld, itemId: string): string[] {
    const item = requireItem(w, itemId);
    if (!item.parent) throw new Error("A drive's root cannot be deleted");
    const removed: string[] = [];
    const drop = (target: StandInItem) => {
        for (const child of childrenOf(w, target)) drop(child);
        delete w.items[target.id];
        removed.push(target.id);
    };
    const parent = w.items[item.parent];
    drop(item);
    if (parent) bump(w, parent, true);
    return removed;
}

/** Add a file to a folder (or a drive's root item). */
export function addFile(
    w: MicrosoftWorld,
    parentId: string,
    name: string,
    content: string | Bytes,
    mimeType = mimeTypeFor(name)
): StandInItem {
    const parent = requireItem(w, parentId);
    if (parent.kind !== "folder") throw new Error(`${parentId} is not a folder`);
    const id = nextId(w, "od-new");
    const item: StandInItem = {
        id,
        driveId: parent.driveId,
        parent: parent.id,
        name,
        kind: "file",
        mimeType,
        source: typeof content === "string" ? { kind: "text", text: content } : undefined,
        content: typeof content === "string" ? utf8(content) : content,
        version: 1,
        contentVersion: 1,
        lastModifiedDateTime: isoSeconds(standInClock.now()),
    };
    w.items[id] = item;
    bump(w, parent, true);
    return item;
}

// ── Mail ───────────────────────────────────────────────────────────────────

export function mailRootId(account: StandInAccount): string {
    return mailFolderId(account, "root");
}

/** A folder of this mailbox by id or by well-known name ("inbox", "sentitems"). */
export function findMailFolder(
    w: MicrosoftWorld,
    oid: string,
    idOrName: string
): StandInMailFolder | undefined {
    const direct = w.mailFolders[idOrName];
    if (direct?.oid === oid) return direct;
    const wanted = idOrName.toLowerCase();
    return Object.values(w.mailFolders).find(f => f.oid === oid && f.wellKnownName === wanted);
}

export function messagesIn(w: MicrosoftWorld, folderId: string): StandInMessage[] {
    return Object.values(w.messages).filter(m => m.folderId === folderId);
}

export function mailFolderResource(
    w: MicrosoftWorld,
    folder: StandInMailFolder
): Record<string, unknown> {
    const inside = messagesIn(w, folder.id);
    return {
        id: folder.id,
        displayName: folder.displayName,
        parentFolderId: folder.parentFolderId,
        childFolderCount: Object.values(w.mailFolders).filter(f => f.parentFolderId === folder.id)
            .length,
        totalItemCount: inside.length,
        unreadItemCount: inside.filter(m => !m.isRead).length,
        ...(folder.wellKnownName ? { wellKnownName: folder.wellKnownName } : {}),
    };
}

/** Messages of a conversation, oldest first. */
export function conversationMessages(w: MicrosoftWorld, conversationId: string): StandInMessage[] {
    return Object.values(w.messages)
        .filter(m => m.conversationId === conversationId)
        .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
}

export interface NewMessage {
    /** Defaults to whoever the mailbox owner was last talking to. */
    from?: StandInPerson;
    text?: string;
    /** Defaults to wherever the conversation's received mail is filed. */
    folderId?: string;
}

/**
 * A reply arrives in an existing conversation: a new message in the same
 * mailbox, quoting the latest one, which the folder's delta then reports.
 */
export function addMessage(
    w: MicrosoftWorld,
    conversationId: string,
    options: NewMessage = {}
): StandInMessage {
    const thread = conversationMessages(w, conversationId).filter(m => !m.isDraft);
    const latest = thread.at(-1);
    if (!latest) throw new Error(`No conversation ${conversationId}`);
    const owner = accountByOid(latest.oid)!;
    const received = [...thread].reverse().find(m => m.from.address !== owner.email);
    const from = options.from ?? received?.from ?? DANA;
    const subject = latest.subject.startsWith("RE: ") ? latest.subject : `RE: ${latest.subject}`;
    const now = standInClock.now();
    const bodies = composeBodies(
        options.text ??
            "One more thing on this: could we move our call to Friday morning? Same agenda.",
        {
            style: "on-wrote",
            previous: {
                from: latest.from,
                to: latest.to,
                sent: new Date(latest.sentDateTime),
                subject: latest.subject,
                text: latest.text ?? "",
            },
        }
    );
    const id = nextId(w, "msg-new");
    w.mailSeq += 1;
    const message: StandInMessage = {
        id,
        oid: owner.oid,
        folderId: options.folderId ?? received?.folderId ?? mailFolderId(owner, "inbox"),
        conversationId,
        subject,
        from,
        to: [{ name: owner.name, address: owner.email }],
        cc: [],
        sentDateTime: isoSeconds(now - 4000),
        receivedDateTime: isoSeconds(now),
        isDraft: false,
        isRead: false,
        html: bodies.html,
        text: bodies.text,
        internetMessageId: `<${id}@${from.address.split("@")[1] ?? "mail.example"}>`,
        attachments: [],
        seq: w.mailSeq,
    };
    w.messages[id] = message;
    return message;
}

/** Delete a message; its folder's delta reports it as `@removed`. */
export function deleteMessage(w: MicrosoftWorld, messageId: string): void {
    const message = w.messages[messageId];
    if (!message) throw new Error(`No message ${messageId}`);
    w.mailSeq += 1;
    w.removedMessages.push({
        id: message.id,
        oid: message.oid,
        folderId: message.folderId,
        seq: w.mailSeq,
    });
    delete w.messages[messageId];
}

// ── Consent and sync state ─────────────────────────────────────────────────

/**
 * Withdraw consent: every access and refresh token (of one account, or of
 * all) stops working, so the next refresh answers `invalid_grant`.
 */
export function revokeGrants(w: MicrosoftWorld, oid?: string): void {
    for (const [token, issued] of Object.entries(w.tokens)) {
        if (!oid || issued.oid === oid) delete w.tokens[token];
    }
    for (const [token, issued] of Object.entries(w.refreshTokens)) {
        if (!oid || issued.oid === oid) delete w.refreshTokens[token];
    }
}

/** Expire every delta link handed out so far: the next delta call answers 410. */
export function invalidateDeltaTokens(w: MicrosoftWorld): void {
    w.deltaEpoch += 1;
}
