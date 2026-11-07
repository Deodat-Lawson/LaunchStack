/**
 * A workspace's own details — what it is called, its URL handle, what it
 * does, how big the team is and its colour — as the create form, the
 * Workspace tab's General screen and `/api/workspace/details` all describe
 * them. Dependency-free apart from zod, so a client form and a route handler
 * validate with the same words.
 *
 * The slug routes nothing: it is shown as `<host>/<slug>` in the workspace
 * picker and kept unique, so it can be changed as long as no other workspace
 * holds it.
 */

import { z } from "zod";

import { V } from "~/i18n/validation";

/** Lowercase letters, digits and inner dashes; 1–64 characters (2+ to choose one). */
export const WORKSPACE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** The colours a workspace's mark can take. Drawn by `WorkspaceSwitcherPill.module.css`. */
export const WORKSPACE_SWATCHES = [1, 2, 3, 4, 5, 6] as const;

/**
 * "Who's joining you?" on the create form, and the team size afterwards.
 * `value` is what is stored (English, as it always was); the words a person
 * reads are `auth.workspaces.editor.teamSizes.<key>`.
 */
export const WORKSPACE_TEAM_SIZES = [
    { key: "solo", value: "Just me — I'm a solo founder" },
    { key: "small", value: "2–5 people" },
    { key: "medium", value: "6–20 people" },
    { key: "large", value: "20+ people" },
] as const;
export type WorkspaceTeamSize = (typeof WORKSPACE_TEAM_SIZES)[number];

/** The create form's option a stored team size is, or undefined for anything else ("1"). */
export function workspaceTeamSizeOf(value: string): WorkspaceTeamSize | undefined {
    return WORKSPACE_TEAM_SIZES.find(size => size.value === value);
}

export const WORKSPACE_DETAIL_LIMITS = {
    name: 120,
    slug: 64,
    description: 2000,
    industry: 256,
    teamSize: 64,
} as const;

export interface WorkspaceDetails {
    id: number;
    name: string;
    /** Null only for workspaces made before slugs existed. */
    slug: string | null;
    description: string | null;
    industry: string | null;
    /** Free text: a create-form option, or a number from sign-up ("1"). */
    teamSize: string;
    swatch: number;
}

/** `GET /api/workspace/details`. */
export interface WorkspaceDetailsResponse {
    workspace: WorkspaceDetails;
    /** Whether the viewer may change them (`settings.manage`). */
    canEdit: boolean;
}

/** Empty text clears an optional field rather than storing "". */
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullable()
        .optional()
        .transform(value => (value === "" ? null : value));

export const WorkspaceDetailsPatchSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, V.workspaceNameRequired)
            .max(WORKSPACE_DETAIL_LIMITS.name)
            .optional(),
        slug: z
            .string()
            .trim()
            .toLowerCase()
            .min(2, V.workspaceUrlTooShort)
            .max(WORKSPACE_DETAIL_LIMITS.slug)
            .regex(WORKSPACE_SLUG_RE, V.workspaceUrlCharacters)
            .optional(),
        description: optionalText(WORKSPACE_DETAIL_LIMITS.description),
        industry: optionalText(WORKSPACE_DETAIL_LIMITS.industry),
        teamSize: z.string().trim().min(1).max(WORKSPACE_DETAIL_LIMITS.teamSize).optional(),
        swatch: z
            .number()
            .int()
            .min(WORKSPACE_SWATCHES[0])
            .max(WORKSPACE_SWATCHES[WORKSPACE_SWATCHES.length - 1]!)
            .optional(),
    })
    .strict()
    .refine(patch => Object.values(patch).some(value => value !== undefined), {
        message: V.nothingToChange,
    });

export type WorkspaceDetailsPatch = z.infer<typeof WorkspaceDetailsPatchSchema>;

/** "NL" for "Northwind Labs" — the letters on the workspace's mark. */
export function workspaceInitials(name: string): string {
    const initials = name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("");
    return initials || "✶";
}
