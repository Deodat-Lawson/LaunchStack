/**
 * The line under General access says who will be able to open the thing —
 * including people added to something that otherwise follows its folder.
 */
import { createTranslator } from "use-intl";

import {
    shareSummary,
    type ShareGrant,
    type ShareOpen,
} from "~/app/employer/documents/_workspace/access/ShareDialog";
import { englishMessages } from "~/i18n/messages";

const t = createTranslator({ locale: "en", messages: englishMessages, namespace: "team.access" });

const me: ShareGrant = {
    principalType: "user",
    principalId: "7",
    principalName: "Ada",
    level: "manage",
    authUserId: "ada",
};
const ben: ShareGrant = {
    principalType: "user",
    principalId: "8",
    principalName: "Ben",
    level: "view",
    authUserId: "ben",
};
const sales: ShareGrant = {
    principalType: "group",
    principalId: "3",
    principalName: "Sales",
    level: "edit",
};
const inherit: ShareOpen = { kind: "inherit", folder: "Q4" };
const workspace: ShareOpen = { kind: "workspace", workspaceName: "Acme", verb: "open" };

const base = { selfAuthId: "ada", audienceCount: null, dirty: true };

describe("shareSummary", () => {
    it("says only you when nobody else is listed", () => {
        expect(
            shareSummary(t, { ...base, general: "restricted", grants: [me], open: workspace })
        ).toBe("Only you can open it.");
    });

    it("counts the people and groups listed", () => {
        expect(
            shareSummary(t, {
                ...base,
                general: "restricted",
                grants: [me, ben, sales],
                open: workspace,
            })
        ).toBe("You and 1 person, 1 group can open it.");
    });

    it("says the folder's audience plus whoever was added, for something that inherits", () => {
        expect(
            shareSummary(t, { ...base, general: "open", grants: [me, ben], open: inherit })
        ).toBe("Whoever can open Q4, plus 1 person, can open this.");
        expect(shareSummary(t, { ...base, general: "open", grants: [me], open: inherit })).toBe(
            "Whoever can open Q4 can open this."
        );
    });

    it("adds the saved head count once nothing is being edited", () => {
        expect(
            shareSummary(t, {
                general: "open",
                grants: [me],
                open: workspace,
                selfAuthId: "ada",
                audienceCount: 4,
                dirty: false,
            })
        ).toBe("Anyone in Acme can open it. (4 people)");
    });
});
