/** @jest-environment jsdom */

import {
    clearJoinIntent,
    hasJoinIntent,
    JOIN_INTENT_TTL_MS,
    leaveJoinWelcome,
    rememberJoinIntent,
    takeJoinWelcome,
} from "~/lib/join-handoff";

beforeEach(() => window.sessionStorage.clear());

describe("join intent", () => {
    it("holds for the same link, in either case, until cleared", () => {
        rememberJoinIntent("link", "ABCD1234", 1_000);
        expect(hasJoinIntent("link", "abcd1234", 2_000)).toBe(true);
        // Reading doesn't spend it: a join cut off by a navigation is retried.
        expect(hasJoinIntent("link", "abcd1234", 2_000)).toBe(true);
        clearJoinIntent();
        expect(hasJoinIntent("link", "abcd1234", 2_000)).toBe(false);
    });

    it("is not honoured for another link, another kind, or after half an hour", () => {
        rememberJoinIntent("link", "abcd1234", 0);
        expect(hasJoinIntent("link", "ffff0000", 1)).toBe(false);
        expect(hasJoinIntent("invite", "abcd1234", 1)).toBe(false);
        // Left in place for the link it belongs to.
        expect(hasJoinIntent("link", "abcd1234", 1)).toBe(true);

        expect(hasJoinIntent("link", "abcd1234", JOIN_INTENT_TTL_MS + 1)).toBe(false);
        // A stale one is dropped, not kept around.
        expect(hasJoinIntent("link", "abcd1234", 1)).toBe(false);
    });

    it("treats unreadable storage as no intent", () => {
        window.sessionStorage.setItem("ls:join-intent", "{not json");
        expect(hasJoinIntent("link", "abcd1234")).toBe(false);
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
