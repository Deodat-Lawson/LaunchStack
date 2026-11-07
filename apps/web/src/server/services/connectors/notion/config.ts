/**
 * Notion connector constants. The OAuth handshake is the generic provider
 * layer's (`../providers/notion`, `../config`); what is here is where synced
 * pages land (see ./folder.ts).
 */

export const NOTION_PROVIDER = "notion" as const;

/** Every connected Notion workspace's pages nest under this folder. */
export const NOTION_ROOT_FOLDER = "Notion";
