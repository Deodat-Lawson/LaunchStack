/**
 * Notion connector constants. The OAuth handshake is the generic provider
 * layer's (`../providers/notion`, `../config`); what is here is where synced
 * pages land (see ./folder.ts).
 */

export const NOTION_PROVIDER = "notion" as const;

/** Every connected Notion workspace's pages nest under this folder. */
export const NOTION_ROOT_FOLDER = "Notion";

/**
 * Why a sync paused, as stored in the sync state's `lastSyncError`. These
 * exact strings are what the status route recognises (`notionPauseReason`),
 * so the card can say them in the reader's language; the English stays for
 * logs and anything that reads the raw error.
 */
export const NOTION_PAUSED = {
    noUpload:
        "Paused: you can no longer add files in this workspace. Ask an admin for upload access.",
} as const;

export type NotionPauseReason = keyof typeof NOTION_PAUSED;

/** The pause a stored error stands for, or null for any other error. */
export function notionPauseReason(error: string | null | undefined): NotionPauseReason | null {
    for (const [reason, text] of Object.entries(NOTION_PAUSED)) {
        if (error === text) return reason as NotionPauseReason;
    }
    return null;
}
