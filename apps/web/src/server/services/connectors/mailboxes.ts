/**
 * The mail providers, in one place. A member's mailbox (Gmail, Outlook) is
 * the one kind of connector content that is never handed on: when its owner
 * goes, the mail still in `<Root>/<address>` is deleted with the connection
 * (`personal-connections.ts`), and no heir is ever granted anything there
 * (`~/server/workspace/ownership.ts`). Both rules ask this module what a
 * mailbox is, so a new mail provider gets the same treatment by being listed
 * here and nowhere else.
 */
import { isFolderDescendant, normalizeFolderPath } from "~/lib/folders/path";

import { OUTLOOK_PROVIDER } from "../microsoft/config";
import { GMAIL_PROVIDER, GMAIL_ROOT_FOLDER, gmailFolderFor } from "./gmail/config";
import { OUTLOOK_ROOT_FOLDER, outlookFolderFor } from "./outlook/config";

export interface MailboxProvider {
    readonly provider: string;
    /** The restricted root every member's mailbox folder nests under. */
    readonly root: string;
    /** The folder a connected account syncs into (the sync's own naming). */
    readonly folderFor: (accountEmail: string) => string;
}

export const MAILBOX_PROVIDERS: readonly MailboxProvider[] = [
    { provider: GMAIL_PROVIDER, root: GMAIL_ROOT_FOLDER, folderFor: gmailFolderFor },
    { provider: OUTLOOK_PROVIDER, root: OUTLOOK_ROOT_FOLDER, folderFor: outlookFolderFor },
];

export const MAILBOX_PROVIDER_IDS: readonly string[] = MAILBOX_PROVIDERS.map(m => m.provider);
export const MAILBOX_ROOT_FOLDERS: readonly string[] = MAILBOX_PROVIDERS.map(m => m.root);

export function mailboxProviderFor(provider: string): MailboxProvider | null {
    return MAILBOX_PROVIDERS.find(m => m.provider === provider) ?? null;
}

/**
 * True for a member's mailbox folder or anything beneath it, for any mail
 * provider, and never for a shared root (`Gmail`, `Outlook`) itself.
 */
export function isPersonalMailboxPath(path: string | null | undefined): boolean {
    const normalized = normalizeFolderPath(path);
    return MAILBOX_ROOT_FOLDERS.some(root => isFolderDescendant(normalized, root));
}
