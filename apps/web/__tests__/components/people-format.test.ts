import {
    actionLabel,
    auditSentence,
    relativeTime,
    untilTime,
} from "~/app/employer/documents/_workspace/settings/people/format";

const NOW = Date.parse("2026-09-03T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
    it("reads naturally at every scale", () => {
        expect(relativeTime(ago(10_000), NOW)).toBe("just now");
        expect(relativeTime(ago(5 * 60_000), NOW)).toBe("5 min ago");
        expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe("3 h ago");
        expect(relativeTime(ago(26 * 3_600_000), NOW)).toBe("yesterday");
        expect(relativeTime(ago(4 * 86_400_000), NOW)).toBe("4 days ago");
    });

    it("says Never for a missing time rather than inventing one", () => {
        expect(relativeTime(null, NOW)).toBe("Never");
        expect(relativeTime("not a date", NOW)).toBe("Unknown");
    });
});

describe("untilTime", () => {
    it("counts forward, and says so once past", () => {
        expect(untilTime(new Date(NOW + 3 * 86_400_000).toISOString(), NOW)).toBe("in 3 days");
        expect(untilTime(new Date(NOW + 2 * 3_600_000).toISOString(), NOW)).toBe("in 2 h");
        expect(untilTime(ago(2 * 86_400_000), NOW)).toBe("expired 2 days ago");
        expect(untilTime(null, NOW)).toBe("Never");
    });
});

describe("auditSentence", () => {
    const actor = { authUserId: "u1", name: "Ada", email: "ada@example.com" };

    it("writes the role change the brief uses as its example", () => {
        expect(
            auditSentence({
                action: "member.role_changed",
                actor,
                targetType: "member",
                targetId: "7",
                detail: { targetName: "Ben", fromRole: "member", toRole: "admin" },
            })
        ).toBe("Ada changed Ben’s role from Member to Admin");
    });

    it("uses a custom role's name when the detail carries one", () => {
        expect(
            auditSentence({
                action: "member.role_changed",
                actor,
                targetType: "member",
                targetId: "7",
                detail: {
                    targetName: "Ben",
                    fromRole: "viewer",
                    toRole: "legal-reviewer",
                    toRoleName: "Legal reviewer",
                },
            })
        ).toBe("Ada changed Ben’s role from Viewer to Legal reviewer");
    });

    it("covers invitations, groups, and folders", () => {
        expect(
            auditSentence({
                action: "invitation.created",
                actor,
                targetType: "invitation",
                targetId: "3",
                detail: { email: "ben@example.com", role: "member" },
            })
        ).toBe("Ada invited ben@example.com as Member");
        expect(
            auditSentence({
                action: "group.deleted",
                actor,
                targetType: "group",
                targetId: "2",
                detail: { name: "Finance", removedGrants: 3 },
            })
        ).toBe("Ada deleted the group Finance (3 access grants removed)");
        expect(
            auditSentence({
                action: "folder.access_changed",
                actor,
                targetType: "folder",
                targetId: "9",
                detail: { folderName: "Board papers", visibility: "restricted" },
            })
        ).toBe("Ada restricted the folder Board papers");
    });

    it("falls back to a readable verb for an action it has never seen", () => {
        expect(
            auditSentence({
                action: "connector.disconnected",
                actor,
                targetType: "connector",
                targetId: "slack",
                detail: null,
            })
        ).toBe("Ada disconnected connector slack");
    });

    it("names an unknown actor honestly", () => {
        expect(
            auditSentence({
                action: "member.left",
                actor: null,
                targetType: "member",
                targetId: "1",
                detail: null,
            })
        ).toBe("Someone left the workspace");
    });
});

describe("actionLabel", () => {
    it("turns a dotted action into a filter label", () => {
        expect(actionLabel("member.role_changed")).toBe("Member · role changed");
        expect(actionLabel("workspace")).toBe("Workspace");
    });
});
