/**
 * The kinds of team activity a reader can narrow the feed to, and the verbs
 * each one covers. Plain data shared by the activity route (which filters on
 * the verbs) and the Team tab (which shows the labels), so the two can't
 * disagree about what "Sharing" means.
 */

export const ACTIVITY_KINDS = {
    added: {
        label: "Added",
        verbs: ["added", "created_folder", "created_group", "forked"],
    },
    shared: {
        label: "Sharing",
        verbs: ["shared", "unshared"],
    },
    moved: {
        label: "Moves and renames",
        verbs: ["moved", "renamed"],
    },
    deleted: {
        label: "Deletions",
        verbs: ["deleted"],
    },
} as const satisfies Record<string, { label: string; verbs: readonly string[] }>;

export type ActivityKind = keyof typeof ACTIVITY_KINDS;

export const ACTIVITY_KIND_IDS = Object.keys(ACTIVITY_KINDS) as [ActivityKind, ...ActivityKind[]];

export function isActivityKind(value: string): value is ActivityKind {
    return Object.prototype.hasOwnProperty.call(ACTIVITY_KINDS, value);
}
