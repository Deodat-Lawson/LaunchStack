/**
 * What the team layer hands back to the workspace shell: something to open.
 * A notification or an activity row names its target; the shell knows how to
 * open each kind (a source tab, a folder filter, a chat).
 */
export type TeamTarget =
    | { type: "document"; id: number }
    | { type: "folder"; path: string }
    | { type: "chat"; id: string };

export interface TeamRailProps {
    /** The rail's filter box text. */
    query: string;
    onOpenTarget: (target: TeamTarget) => void;
    /** Open the Share dialog for something (from a person's page). */
    onShare?: (target: TeamTarget & { name: string }) => void;
}
