/**
 * Autonomy, enforced where the action happens.
 *
 * Storing a level per agent is easy; the level only means something if the
 * two places an agent acts unattended — starting a meeting with Slack
 * mirroring, and running turns without a person pressing Step — refuse when
 * the room is not allowed to. Both checks read the roster and the workspace
 * default here, so the dialog and the API give the same answer.
 */

import { copy } from "~/i18n/copy";
import type { Locale } from "~/i18n/locales";
import { translatorFor } from "~/i18n/translate";
import {
    DEFAULT_AGENT_AUTONOMY,
    canRunUnattended,
    effectiveAutonomy,
    meetingPlanViolationCodes,
    meetingPlanViolations,
    type AgentAutonomy,
    type MeetingPlanViolation,
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

/** One violation in the reader's words (`agents.violations`, the dialog's own sentences). */
function violationText(violation: MeetingPlanViolation, locale: Locale): string {
    const t = translatorFor(locale, "agents");
    if (violation.code === "mirrorNeedsWrite") {
        return t("violations.mirrorNeedsWrite", {
            required: t(`autonomy.${violation.required}.label`),
            current: t(`autonomy.${violation.current}.label`),
        });
    }
    return t("violations.agentIdentityNeedsFull", {
        required: t(`autonomy.${violation.required}.label`),
    });
}

/**
 * Throws a 400 when the planned meeting exceeds what its agents may do. The
 * sentences are in `locale` (English, as `meetingPlanViolations` words them,
 * for API readers); the route shows the message as it is.
 */
export async function assertMeetingPlanAllowed(
    companyId: bigint,
    plan: {
        participantKeys: readonly string[];
        slackMirrorEnabled?: boolean;
        slackUseAgentIdentity?: boolean;
    },
    locale: Locale = "en"
): Promise<void> {
    const levels = await effectiveLevelsFor(companyId, plan.participantKeys);
    const meeting = {
        participants: levels,
        slackMirrorEnabled: plan.slackMirrorEnabled,
        slackUseAgentIdentity: plan.slackUseAgentIdentity,
    };
    if (locale === "en") {
        const problems = meetingPlanViolations(meeting);
        if (problems.length > 0) throw badRequest(problems.join(" "));
        return;
    }
    const problems = meetingPlanViolationCodes(meeting).map(v => violationText(v, locale));
    // Chinese sentences end in a full stop of their own and run on without a space.
    if (problems.length > 0) throw badRequest(problems.join(""));
}

/** Throws a 400 when a room contains an agent that may only speak when a person asks. */
export async function assertRoomMayRun(
    companyId: bigint,
    participantKeys: readonly string[]
): Promise<void> {
    const levels = await effectiveLevelsFor(companyId, participantKeys);
    if (!canRunUnattended(levels)) {
        throw badRequest(copy("collab.server.errors.roomReadOnly"));
    }
}
