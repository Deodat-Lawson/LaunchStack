/**
 * Notion connector constants. The OAuth handshake is the generic provider
 * layer's (`../providers/notion`, `../config`); what is here is where synced
 * pages land.
 */
import { MAX_FOLDER_NAME_CHARS } from "~/lib/folders/path";

export const NOTION_PROVIDER = "notion" as const;

/** Every connected Notion workspace's pages nest under this folder. */
export const NOTION_ROOT_FOLDER = "Notion";

/**
 * `Notion/<workspace>` — one folder per connected workspace. The name is
 * trimmed to the folder-name limit and stripped of the path separator so it
 * always passes the folder rules.
 */
export function notionFolderFor(workspaceName: string | null | undefined): string {
    const segment = (workspaceName ?? "")
        .replace(/\//g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_FOLDER_NAME_CHARS);
    return `${NOTION_ROOT_FOLDER}/${segment || "Workspace"}`;
}
