/**
 * What the team layer hands back to the workspace shell: something to open.
 * A notification or an activity row names its target; the shell knows how to
 * open each kind (a source tab, a folder filter, a chat).
 */
export type TeamTarget =
    | { type: "document"; id: number }
    | { type: "folder"; path: string }
    | { type: "chat"; id: string };

/** What the sidebar's inbox bell needs: somewhere to open what was shared. */
export interface InboxRailProps {
    onOpenTarget: (target: TeamTarget) => void;
}
