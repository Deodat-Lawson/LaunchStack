/**
 * Autonomy is enforced where agents act unattended. The roster and the
 * workspace default are substituted; the rules are the real ones.
 */

import { wordOr } from "~/i18n/translate";
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

    it("words its refusals for a Chinese reader and keeps the English otherwise", async () => {
        const plan = {
            participantKeys: ["ada", "ravi"],
            slackMirrorEnabled: true,
            slackUseAgentIdentity: true,
        };
        await expect(assertMeetingPlanAllowed(7n, plan)).rejects.toMatchObject({
            message:
                'Mirroring to Slack needs every agent in the room at "Write" or above; one is set to "Propose". ' +
                'Posting to Slack under an agent\'s own name needs every agent at "Full".',
        });
        await expect(assertMeetingPlanAllowed(7n, plan, "zh-CN")).rejects.toMatchObject({
            message:
                "同步到 Slack 要求会议中的每个智能体都至少为“写入”；其中有一个设为了“提议”。" +
                "要以智能体自己的名义在 Slack 发帖，每个智能体都需要设为“完全”。",
        });

        const refused = (await assertRoomMayRun(7n, ["mira"]).catch(
            (err: unknown) => err
        )) as WorkspaceError;
        expect(refused.message).toMatch(/^An agent in this room is set to "Read only"/);
        expect(wordOr(refused.copy, refused.message, "zh-CN")).toBe(
            "这个会议中有智能体设为“只读”，因此只有有人点击“进行一轮”时才会发言。请在“设置 → 智能体”中提高它的自主程度，让会议自行运行。"
        );
    });
});
