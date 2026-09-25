/**
 * Profile fields: their limits, how they validate, and the photo rules.
 *
 * Client-safe. The settings form and the `/api/profile` routes both read
 * from here, so a limit the form enforces is the limit the server enforces,
 * and the column widths in `server/db/schema/identity.ts` match them.
 */

import { z } from "zod";

export const PROFILE_LIMITS = {
    name: 120,
    displayName: 80,
    title: 100,
    pronouns: 40,
    timeZone: 64,
    bio: 280,
} as const;

/** Where a write lands: the person's own profile, or their look in the active workspace. */
export type ProfileScope = "global" | "workspace";

export function isProfileScope(value: unknown): value is ProfileScope {
    return value === "global" || value === "workspace";
}

/** An IANA zone the runtime knows (`Europe/Paris`), per `Intl`. */
export function isValidTimeZone(value: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

/** Trimmed text; empty or null clears the field. */
function clearable(max: number) {
    return z
        .string()
        .trim()
        .max(max, `Keep it under ${max} characters.`)
        .nullable()
        .transform(value => (value === "" ? null : value));
}

export const ProfilePatchSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "Your name can't be empty.")
            .max(PROFILE_LIMITS.name, `Keep it under ${PROFILE_LIMITS.name} characters.`)
            .optional(),
        displayName: clearable(PROFILE_LIMITS.displayName).optional(),
        title: clearable(PROFILE_LIMITS.title).optional(),
        pronouns: clearable(PROFILE_LIMITS.pronouns).optional(),
        timeZone: clearable(PROFILE_LIMITS.timeZone)
            .refine(value => value === null || isValidTimeZone(value), "Unknown time zone.")
            .optional(),
        bio: clearable(PROFILE_LIMITS.bio).optional(),
    })
    .strict();

export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

/** The fields a workspace may show differently. Null means "use my profile". */
export const WorkspaceProfilePatchSchema = z
    .object({
        displayName: clearable(PROFILE_LIMITS.displayName).optional(),
        title: clearable(PROFILE_LIMITS.title).optional(),
    })
    .strict();

export type WorkspaceProfilePatch = z.infer<typeof WorkspaceProfilePatchSchema>;

/**
 * Photo rules. The browser crops to a square and uploads the result; the
 * server re-encodes whatever arrives to a `outputSize` WebP with metadata
 * stripped (phone JPGs carry GPS in EXIF), so the stored bytes are always
 * ours, never the upload.
 */
export const PROFILE_PHOTO = {
    /** Upload ceiling. The cropped PNG the settings form sends is well under it. */
    maxBytes: 10 * 1024 * 1024,
    /** Stored edge length, px. Covers a 96px card at 4× and a 32px chip easily. */
    outputSize: 512,
    /** Smallest source edge accepted, px. */
    minSide: 64,
    /** What the file picker offers. HEIC arrives as JPEG from iOS pickers. */
    accept: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
    acceptLabel: "JPG, PNG, WebP, GIF or AVIF",
} as const;
