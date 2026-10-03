/**
 * How a person appears: their profile, optionally overridden per workspace.
 *
 * Client-safe and pure. One profile follows a person into every workspace;
 * a workspace may carry an override for the three things that plausibly
 * differ between companies — photo, display name, title. Everything else
 * (full name, pronouns, time zone, bio) describes the person, not the
 * membership, and is never overridden.
 *
 * Resolution is per field: override → profile → fallback. An override is a
 * replacement, not an addition — a workspace that has one never sees the
 * profile value (the image route enforces the same rule for photos).
 */

export interface ProfileFields {
    /** Full name. Also the sign-in name (Better Auth) and what audit trails record. */
    name: string;
    email: string;
    /** What people call you. Null falls back to `name`. */
    displayName: string | null;
    title: string | null;
    pronouns: string | null;
    timeZone: string | null;
    bio: string | null;
    avatarUrl: string | null;
}

export interface WorkspaceProfileOverride {
    displayName: string | null;
    title: string | null;
    avatarUrl: string | null;
}

export interface EffectiveProfile {
    name: string;
    email: string;
    /** Never empty: override, then profile, then full name, then email. */
    displayName: string;
    title: string | null;
    pronouns: string | null;
    timeZone: string | null;
    bio: string | null;
    avatarUrl: string | null;
    initials: string;
}

/**
 * How one person appears in one workspace — the single shape every avatar and
 * name in the app renders from (member lists, the audit log, presence,
 * meetings, viewers). Built server-side by `workspaceLooks`.
 */
export interface PersonLook {
    authUserId: string;
    /** Full name. */
    name: string;
    email: string;
    /** Override here, else profile display name, else full name, else email. */
    displayName: string;
    title: string | null;
    pronouns: string | null;
    /** Null when they have no photo — or have left the workspace, since the image route would refuse it. */
    avatarUrl: string | null;
    /** Still has a membership (any status) in the workspace. */
    member: boolean;
}

/** `GET /api/profile` — the caller's profile, their override in the active workspace, and the result. */
export interface MyProfile {
    profile: ProfileFields;
    /** Null when the caller has no active workspace yet (signup, workspace picker). */
    workspace: {
        id: string;
        name: string;
        override: WorkspaceProfileOverride;
    } | null;
    /** What the active workspace sees; the profile itself when there is none. */
    effective: EffectiveProfile;
}

export const NO_OVERRIDE: WorkspaceProfileOverride = {
    displayName: null,
    title: null,
    avatarUrl: null,
};

export function profileImageUrl(imageId: string | null | undefined): string | null {
    return imageId ? `/api/profile-images/${encodeURIComponent(imageId)}` : null;
}

/** "Ada Lovelace" → "AL", "ada" → "A", "" + email → first letter of the email. */
export function profileInitials(name: string | null | undefined, email?: string | null): string {
    const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
    const first = words[0]?.[0];
    const last = words.length > 1 ? words[words.length - 1]?.[0] : undefined;
    const letters = `${first ?? ""}${last ?? ""}`;
    if (letters) return letters.toUpperCase();
    return (email?.trim()[0] ?? "U").toUpperCase();
}

/** The first value with something in it after trimming. */
export function firstFilled(...values: (string | null | undefined)[]): string | null {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) return trimmed;
    }
    return null;
}

export function hasOverride(override: WorkspaceProfileOverride | null | undefined): boolean {
    if (!override) return false;
    return firstFilled(override.displayName, override.title, override.avatarUrl) !== null;
}

export function resolveProfile(
    profile: ProfileFields,
    override?: WorkspaceProfileOverride | null
): EffectiveProfile {
    const displayName =
        firstFilled(override?.displayName, profile.displayName, profile.name) ?? profile.email;
    return {
        name: profile.name,
        email: profile.email,
        displayName,
        title: override?.title ?? profile.title,
        pronouns: profile.pronouns,
        timeZone: profile.timeZone,
        bio: profile.bio,
        avatarUrl: override?.avatarUrl ?? profile.avatarUrl,
        initials: profileInitials(displayName, profile.email),
    };
}

/** "3:42 PM" in the person's zone, or null when unknown/invalid. */
export function localTimeIn(timeZone: string | null, now: Date = new Date()): string | null {
    if (!timeZone) return null;
    try {
        return new Intl.DateTimeFormat(undefined, {
            timeZone,
            hour: "numeric",
            minute: "2-digit",
        }).format(now);
    } catch {
        return null;
    }
}
