import {
    BusinessRoleInputSchema,
    parseConfirmedBusinessRole,
} from "~/server/vantage/weekly-review-business-role";

const actor = { companyId: "1", userId: "person" };
const role = {
    schemaVersion: "vantage-business-role/v1",
    primaryRole: "Finance lead",
    responsibilities: ["Forecast cash flow"],
    priorities: ["Extend runway"],
    confirmedBy: actor.userId,
    companyId: actor.companyId,
    revision: 3,
    confirmed: true,
};

describe("confirmed business role parsing", () => {
    it("validates explicit responsibility context and normalizes surrounding whitespace", () => {
        expect(
            parseConfirmedBusinessRole({ ...role, primaryRole: " Finance lead " }, actor)
        ).toEqual(role);
    });

    it.each([
        ["another actor", { ...role, confirmedBy: "other-person" }],
        ["another company", { ...role, companyId: "2" }],
        ["unconfirmed context", { ...role, confirmed: false }],
        ["missing confirmation", { ...role, confirmed: undefined }],
        ["unknown schema", { ...role, schemaVersion: "vantage-business-role/v2" }],
        ["invalid revision", { ...role, revision: 0 }],
        ["unknown fields", { ...role, membershipRole: "admin" }],
        ["blank primary role", { ...role, primaryRole: " " }],
        ["long primary role", { ...role, primaryRole: "x".repeat(81) }],
        ["too many responsibilities", { ...role, responsibilities: Array<string>(9).fill("work") }],
        ["long responsibility", { ...role, responsibilities: ["x".repeat(161)] }],
        ["blank priority", { ...role, priorities: [" "] }],
        ["null", null],
        ["legacy membership role", "admin"],
    ])("rejects %s", (_name, raw) => {
        expect(parseConfirmedBusinessRole(raw, actor)).toBeUndefined();
    });

    it("accepts bounded optional lists only after actor confirmation", () => {
        expect(
            BusinessRoleInputSchema.parse({
                primaryRole: "Operations",
                responsibilities: [],
                priorities: [],
                confirmed: true,
            })
        ).toEqual({
            primaryRole: "Operations",
            responsibilities: [],
            priorities: [],
            confirmed: true,
        });
    });

    it.each([undefined, { role: "admin" }, { role: "finance" }])(
        "does not infer business context from absent or membership-only preferences %p",
        raw => expect(parseConfirmedBusinessRole(raw, actor)).toBeUndefined()
    );
});
