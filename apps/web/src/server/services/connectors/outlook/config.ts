/**
 * What is Outlook-specific about where a member's mail lands. The provider
 * id, the scopes and the "is it configured" switches live with the shared
 * Microsoft layer (`~/server/services/microsoft/config`).
 */
import { MAX_FOLDER_NAME_CHARS } from "~/lib/folders/path";

/**
 * Every member's Outlook mailbox folder nests under this restricted root.
 * What counts as a mailbox folder (never handed on) is asked of
 * `../mailboxes.ts`, which knows every mail provider's root.
 */
export const OUTLOOK_ROOT_FOLDER = "Outlook";

/** Where the member starts the Microsoft round trip for their mailbox. */
export const OUTLOOK_CONNECT_URL = "/api/connectors/microsoft/oauth/start?provider=outlook";

/**
 * `Outlook/<address>`: one folder per connected mailbox, named exactly the
 * way Gmail names its own (`gmailFolderFor`), so the two never collide and
 * the address always passes the folder rules.
 */
export function outlookFolderFor(accountEmail: string): string {
    const segment = accountEmail
        .replace(/\//g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_FOLDER_NAME_CHARS);
    return `${OUTLOOK_ROOT_FOLDER}/${segment || "mailbox"}`;
}
