import {
    ProfilePatchSchema,
    WorkspaceProfilePatchSchema,
    isValidTimeZone,
} from "~/lib/profile/fields";
import {
    NO_OVERRIDE,
    hasOverride,
    profileImageUrl,
    profileInitials,
    resolveProfile,
    type ProfileFields,
} from "~/lib/profile/resolve";

const ada: ProfileFields = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    displayName: null,
    title: "Founder",
    pronouns: "she/her",
    timeZone: "Europe/London",
    bio: "Analytical engines.",
    avatarUrl: "/api/profile-images/profile-photo-id",
};

describe("resolveProfile", () => {
    it("uses the profile when the workspace has no override", () => {
        const look = resolveProfile(ada, NO_OVERRIDE);
        expect(look.displayName).toBe("Ada Lovelace");
        expect(look.title).toBe("Founder");
        expect(look.avatarUrl).toBe(ada.avatarUrl);
        expect(look.initials).toBe("AL");
    });

    it("prefers the display name over the full name", () => {
        expect(resolveProfile({ ...ada, displayName: "Ada" }).displayName).toBe("Ada");
    });

    it("lets a workspace replace photo, display name and title — and nothing else", () => {
        const look = resolveProfile(ada, {
            displayName: "Countess",
            title: "Advisor",
            avatarUrl: "/api/profile-images/workspace-photo-id",
        });
        expect(look).toMatchObject({
            displayName: "Countess",
            title: "Advisor",
            avatarUrl: "/api/profile-images/workspace-photo-id",
            // Person-level fields never vary by workspace.
            name: "Ada Lovelace",
            pronouns: "she/her",
            timeZone: "Europe/London",
            bio: "Analytical engines.",
        });
        expect(look.initials).toBe("C");
    });

    it("overrides field by field: a blank override field falls through to the profile", () => {
        const look = resolveProfile(ada, { displayName: null, title: "Advisor", avatarUrl: null });
        expect(look.displayName).toBe("Ada Lovelace");
        expect(look.title).toBe("Advisor");
        expect(look.avatarUrl).toBe(ada.avatarUrl);
    });

    it("never produces an empty display name", () => {
        const look = resolveProfile({ ...ada, name: "  ", displayName: "" });
        expect(look.displayName).toBe("ada@example.com");
        expect(look.initials).toBe("A");
    });
});

describe("profile helpers", () => {
    it("builds image URLs only for real ids", () => {
        expect(profileImageUrl("abc")).toBe("/api/profile-images/abc");
        expect(profileImageUrl(null)).toBeNull();
        expect(profileImageUrl("")).toBeNull();
    });

    it("derives initials from first and last words, else the email", () => {
        expect(profileInitials("grace brewster murray hopper")).toBe("GH");
        expect(profileInitials("", "zed@example.com")).toBe("Z");
        expect(profileInitials(null)).toBe("U");
    });

    it("knows when a workspace override is in effect", () => {
        expect(hasOverride(NO_OVERRIDE)).toBe(false);
        expect(hasOverride({ ...NO_OVERRIDE, title: "Advisor" })).toBe(true);
        expect(hasOverride(null)).toBe(false);
    });
});

describe("profile field validation", () => {
    it("trims text and turns blanks into cleared fields", () => {
        const parsed = ProfilePatchSchema.parse({
            displayName: "  Ada  ",
            title: "   ",
            bio: null,
        });
        expect(parsed).toEqual({ displayName: "Ada", title: null, bio: null });
    });

    it("refuses an empty full name, over-long fields and unknown keys", () => {
        expect(ProfilePatchSchema.safeParse({ name: "   " }).success).toBe(false);
        expect(ProfilePatchSchema.safeParse({ pronouns: "x".repeat(41) }).success).toBe(false);
        expect(ProfilePatchSchema.safeParse({ email: "a@b.c" }).success).toBe(false);
    });

    it("accepts IANA time zones only", () => {
        expect(isValidTimeZone("America/New_York")).toBe(true);
        expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
        expect(ProfilePatchSchema.safeParse({ timeZone: "Mars/Olympus_Mons" }).success).toBe(false);
        expect(ProfilePatchSchema.parse({ timeZone: "" })).toEqual({ timeZone: null });
    });

    it("lets a workspace override only display name and title", () => {
        expect(WorkspaceProfilePatchSchema.parse({ title: "Advisor" })).toEqual({
            title: "Advisor",
        });
        expect(WorkspaceProfilePatchSchema.safeParse({ pronouns: "they/them" }).success).toBe(
            false
        );
    });
});
