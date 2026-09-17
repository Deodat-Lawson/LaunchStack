/**
 * Autonomy is enforced where agents act unattended. The roster and the
 * workspace default are substituted; the rules are the real ones.
 */

import { WorkspaceError } from "~/server/workspace/errors";

const mockCtx: {
    defaultAutonomy: string;
    personas: Array<{ id: string; autonomy: string | null }>;
} = { defaultAutonomy: "full", personas: [] };

jest.mock("~/server/settings/store", () => ({
    readWorkspaceSetting: () => Promise.resolve(mockCtx.defaultAutonomy),
}));

jest.mock("~/server/collab/personas", () => ({
    listPersonas: () => Promise.resolve(mockCtx.personas),
}));

import {
    assertMeetingPlanAllowed,
    assertRoomMayRun,
    effectiveLevelsFor,
} from "~/server/collab/autonomy";

beforeEach(() => {
    mockCtx.defaultAutonomy = "full";
    mockCtx.personas = [
        { id: "ada", autonomy: null },
        { id: "ravi", autonomy: "propose" },
        { id: "mira", autonomy: "observe" },
    ];
});

describe("autonomy enforcement", () => {
    it("resolves each persona's level against the workspace default", async () => {
        mockCtx.defaultAutonomy = "write";
        await expect(effectiveLevelsFor(7n, ["ada", "ravi", "ghost"])).resolves.toEqual([
            "write",
            "propose",
            "write",
        ]);
    });

    it("allows a room of full agents to mirror to Slack under their own names", async () => {
        await expect(
            assertMeetingPlanAllowed(7n, {
                participantKeys: ["ada"],
                slackMirrorEnabled: true,
                slackUseAgentIdentity: true,
            })
        ).resolves.toBeUndefined();
    });

    it("refuses Slack mirroring when one agent may only propose", async () => {
        await expect(
            assertMeetingPlanAllowed(7n, {
                participantKeys: ["ada", "ravi"],
                slackMirrorEnabled: true,
            })
        ).rejects.toMatchObject({ status: 400 });
    });

    it("lets a lowered workspace default bite agents with no level of their own", async () => {
        mockCtx.defaultAutonomy = "propose";
        await expect(
            assertMeetingPlanAllowed(7n, { participantKeys: ["ada"], slackMirrorEnabled: true })
        ).rejects.toBeInstanceOf(WorkspaceError);
    });

    it("refuses to run a room with a read-only agent, but never refuses a plain plan", async () => {
        await expect(assertRoomMayRun(7n, ["ada", "mira"])).rejects.toMatchObject({ status: 400 });
        await expect(assertRoomMayRun(7n, ["ada", "ravi"])).resolves.toBeUndefined();
        await expect(
            assertMeetingPlanAllowed(7n, { participantKeys: ["mira"], slackMirrorEnabled: false })
        ).resolves.toBeUndefined();
    });
});
