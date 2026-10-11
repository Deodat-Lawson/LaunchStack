/** @jest-environment jsdom */

import {
    JOIN_INTENT_TTL_MS,
    leaveJoinWelcome,
    rememberJoinIntent,
    takeJoinIntent,
    takeJoinWelcome,
} from "~/lib/join-handoff";

beforeEach(() => window.sessionStorage.clear());

describe("join intent", () => {
    it("is honoured once, for the same link, in either case", () => {
        rememberJoinIntent("link", "ABCD1234", 1_000);
        expect(takeJoinIntent("link", "abcd1234", 2_000)).toBe(true);
        expect(takeJoinIntent("link", "abcd1234", 2_000)).toBe(false);
    });

    it("is not honoured for another link, another kind, or after half an hour", () => {
        rememberJoinIntent("link", "abcd1234", 0);
        expect(takeJoinIntent("link", "ffff0000", 1)).toBe(false);

        rememberJoinIntent("link", "abcd1234", 0);
        expect(takeJoinIntent("invite", "abcd1234", 1)).toBe(false);

        rememberJoinIntent("link", "abcd1234", 0);
        expect(takeJoinIntent("link", "abcd1234", JOIN_INTENT_TTL_MS + 1)).toBe(false);
    });

    it("treats unreadable storage as no intent", () => {
        window.sessionStorage.setItem("ls:join-intent", "{not json");
        expect(takeJoinIntent("link", "abcd1234")).toBe(false);
    });
});

describe("join welcome", () => {
    it("is read once", () => {
        leaveJoinWelcome({ workspaceName: "Acme", roleName: "Member", invitedBy: null });
        expect(takeJoinWelcome()).toEqual({
            workspaceName: "Acme",
            roleName: "Member",
            invitedBy: null,
        });
        expect(takeJoinWelcome()).toBeNull();
    });
});
