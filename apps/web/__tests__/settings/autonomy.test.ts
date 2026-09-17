/**
 * Agent autonomy: the room's least autonomous agent decides, and the rules
 * the dialog shows are the rules the API enforces.
 */

import {
    canRunUnattended,
    effectiveAutonomy,
    meetingPlanViolations,
    minAutonomy,
} from "~/lib/agents/autonomy";

describe("agent autonomy", () => {
    it("inherits the workspace default when an agent has no level", () => {
        expect(effectiveAutonomy(null, "propose")).toBe("propose");
        expect(effectiveAutonomy("garbage", "propose")).toBe("propose");
        expect(effectiveAutonomy("observe", "full")).toBe("observe");
    });

    it("takes the most restrictive level in the room", () => {
        expect(minAutonomy(["full", "write", "propose"])).toBe("propose");
        expect(minAutonomy([])).toBe("full");
    });

    it("lets a room run unattended only above read-only", () => {
        expect(canRunUnattended(["propose", "full"])).toBe(true);
        expect(canRunUnattended(["observe", "full"])).toBe(false);
    });

    it("refuses Slack mirroring below write, and agent identity below full", () => {
        expect(
            meetingPlanViolations({
                participants: ["full", "full"],
                slackMirrorEnabled: true,
                slackUseAgentIdentity: true,
            })
        ).toEqual([]);
        expect(
            meetingPlanViolations({
                participants: ["write", "full"],
                slackMirrorEnabled: true,
                slackUseAgentIdentity: true,
            })
        ).toHaveLength(1);
        expect(
            meetingPlanViolations({ participants: ["propose"], slackMirrorEnabled: true })
        ).toHaveLength(1);
        expect(
            meetingPlanViolations({ participants: ["observe"], slackMirrorEnabled: false })
        ).toEqual([]);
    });
});
