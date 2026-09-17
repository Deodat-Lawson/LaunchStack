/**
 * Autonomy, enforced where the action happens.
 *
 * Storing a level per agent is easy; the level only means something if the
 * two places an agent acts unattended — starting a meeting with Slack
 * mirroring, and running turns without a person pressing Step — refuse when
 * the room is not allowed to. Both checks read the roster and the workspace
 * default here, so the dialog and the API give the same answer.
 */

import {
    DEFAULT_AGENT_AUTONOMY,
    canRunUnattended,
    effectiveAutonomy,
    meetingPlanViolations,
    type AgentAutonomy,
} from "~/lib/agents/autonomy";
import { badRequest } from "~/server/workspace/errors";
import { readWorkspaceSetting } from "~/server/settings/store";

import { listPersonas } from "./personas";

export async function workspaceDefaultAutonomy(companyId: bigint): Promise<AgentAutonomy> {
    return readWorkspaceSetting<AgentAutonomy>(companyId, "agents.defaultAutonomy").catch(
        () => DEFAULT_AGENT_AUTONOMY
    );
}

/** Effective level of each persona key, from the live roster (archived included — frozen rosters name them). */
export async function effectiveLevelsFor(
    companyId: bigint,
    personaKeys: readonly string[]
): Promise<AgentAutonomy[]> {
    const [roster, fallback] = await Promise.all([
        listPersonas(companyId, true),
        workspaceDefaultAutonomy(companyId),
    ]);
    const byKey = new Map(roster.map(persona => [persona.id, persona]));
    return personaKeys.map(key => effectiveAutonomy(byKey.get(key)?.autonomy, fallback));
}

/** Throws a 400 when the planned meeting exceeds what its agents may do. */
export async function assertMeetingPlanAllowed(
    companyId: bigint,
    plan: {
        participantKeys: readonly string[];
        slackMirrorEnabled?: boolean;
        slackUseAgentIdentity?: boolean;
    }
): Promise<void> {
    const levels = await effectiveLevelsFor(companyId, plan.participantKeys);
    const problems = meetingPlanViolations({
        participants: levels,
        slackMirrorEnabled: plan.slackMirrorEnabled,
        slackUseAgentIdentity: plan.slackUseAgentIdentity,
    });
    if (problems.length > 0) throw badRequest(problems.join(" "));
}

/** Throws a 400 when a room contains an agent that may only speak when a person asks. */
export async function assertRoomMayRun(
    companyId: bigint,
    participantKeys: readonly string[]
): Promise<void> {
    const levels = await effectiveLevelsFor(companyId, participantKeys);
    if (!canRunUnattended(levels)) {
        throw badRequest(
            'An agent in this room is set to "Read only", so turns only happen when someone presses Step. Raise its autonomy under Settings → Agents to let the meeting run on its own.'
        );
    }
}
