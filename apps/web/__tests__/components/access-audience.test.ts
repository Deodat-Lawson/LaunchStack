import {
    audienceSummary,
    describeGrants,
} from "~/app/employer/documents/_workspace/access/audience";

const user = (id: string) => ({
    principalType: "user" as const,
    principalId: id,
    level: "view" as const,
});
const group = (id: string) => ({
    principalType: "group" as const,
    principalId: id,
    level: "view" as const,
});
const role = (id: string, name?: string) => ({
    principalType: "role" as const,
    principalId: id,
    principalName: name,
    level: "view" as const,
});

describe("describeGrants", () => {
    it("lists people, groups, and roles with proper joins", () => {
        expect(describeGrants([])).toBe("no one yet");
        expect(describeGrants([user("1")])).toBe("1 person");
        expect(describeGrants([user("1"), user("2"), group("g")])).toBe("2 people and 1 group");
        expect(describeGrants([user("1"), group("g"), role("admin", "Admin")])).toBe(
            "1 person, 1 group, and the Admin role"
        );
        expect(describeGrants([role("a"), role("b")])).toBe("2 roles");
    });
});

describe("audienceSummary", () => {
    it("describes an open folder with the server's count when clean", () => {
        expect(
            audienceSummary({
                kind: "folder",
                restricted: false,
                grants: [],
                audienceCount: 12,
                dirty: false,
            })
        ).toBe("Visible to everyone in the workspace (12 people)");
    });

    it("uses the saved count for a restricted folder that has not been edited", () => {
        expect(
            audienceSummary({
                kind: "folder",
                restricted: true,
                grants: [user("1")],
                audienceCount: 4,
                dirty: false,
            })
        ).toBe("Visible to 4 people");
        expect(
            audienceSummary({
                kind: "document",
                restricted: true,
                grants: [],
                audienceCount: 0,
                dirty: false,
            })
        ).toBe("Visible only to workspace owners and admins");
    });

    it("describes the pending grant list while editing, and says it needs saving", () => {
        expect(
            audienceSummary({
                kind: "folder",
                restricted: true,
                grants: [user("1"), group("g")],
                audienceCount: 4,
                dirty: true,
            })
        ).toBe("Will be visible to 1 person and 1 group, plus workspace admins — save to apply");
    });
});
