/**
 * How much an agent may do without a person in the loop.
 *
 * Roles govern people. Nothing governed agents: any persona in a meeting could
 * take turns unattended, mirror them into Slack, and speak there under its
 * own name. These four levels are the dial. They are ordered, so "at least
 * `write`" is a meaningful check, and they are enforced where the action
 * happens (meeting creation and meeting control), not only stored.
 *
 * Dependency-free: the roster UI, the meeting dialog and the API routes all
 * read the same list.
 */

export const AGENT_AUTONOMY_LEVELS = ["observe", "propose", "write", "full"] as const;
export type AgentAutonomy = (typeof AGENT_AUTONOMY_LEVELS)[number];

/** Today's behaviour: everything allowed. Existing workspaces keep it. */
export const DEFAULT_AGENT_AUTONOMY: AgentAutonomy = "full";

export const AGENT_AUTONOMY_META: Record<AgentAutonomy, { label: string; description: string }> = {
    observe: {
        label: "Read only",
        description:
            "Answers when asked. In a meeting a person triggers every turn; it never runs on its own.",
    },
    propose: {
        label: "Propose",
        description:
            "Takes turns on its own, but nothing leaves the workspace: meetings it joins cannot mirror to Slack.",
    },
    write: {
        label: "Write",
        description:
            "Takes turns on its own and its turns may be mirrored to Slack under the workspace bot.",
    },
    full: {
        label: "Full",
        description: "Everything, including speaking in Slack under its own name.",
    },
};

export function isAgentAutonomy(value: unknown): value is AgentAutonomy {
    return (
        typeof value === "string" && (AGENT_AUTONOMY_LEVELS as readonly string[]).includes(value)
    );
}

export function autonomyRank(level: AgentAutonomy): number {
    return AGENT_AUTONOMY_LEVELS.indexOf(level);
}

export function autonomyAtLeast(level: AgentAutonomy, floor: AgentAutonomy): boolean {
    return autonomyRank(level) >= autonomyRank(floor);
}

/** The most restrictive level in a room decides what the room may do. */
export function minAutonomy(levels: readonly AgentAutonomy[]): AgentAutonomy {
    let min: AgentAutonomy = "full";
    for (const level of levels) if (autonomyRank(level) < autonomyRank(min)) min = level;
    return min;
}

/** A persona's own level, or the workspace default when it has none. */
export function effectiveAutonomy(
    own: string | null | undefined,
    workspaceDefault: AgentAutonomy
): AgentAutonomy {
    return isAgentAutonomy(own) ? own : workspaceDefault;
}

export interface MeetingPlan {
    /** Effective level of every participant. */
    participants: readonly AgentAutonomy[];
    slackMirrorEnabled?: boolean;
    slackUseAgentIdentity?: boolean;
}

/**
 * Why a meeting as planned is not allowed, in words the dialog can show.
 * Empty when it is fine.
 */
export function meetingPlanViolations(plan: MeetingPlan): string[] {
    const floor = minAutonomy(plan.participants);
    const problems: string[] = [];
    if (plan.slackMirrorEnabled && !autonomyAtLeast(floor, "write")) {
        problems.push(
            `Mirroring to Slack needs every agent in the room at "${AGENT_AUTONOMY_META.write.label}" or above; one is set to "${AGENT_AUTONOMY_META[floor].label}".`
        );
    }
    if (plan.slackMirrorEnabled && plan.slackUseAgentIdentity && !autonomyAtLeast(floor, "full")) {
        problems.push(
            `Posting to Slack under an agent's own name needs every agent at "${AGENT_AUTONOMY_META.full.label}".`
        );
    }
    return problems;
}

/** Whether the room may take turns without a person pressing Step each time. */
export function canRunUnattended(participants: readonly AgentAutonomy[]): boolean {
    return autonomyAtLeast(minAutonomy(participants), "propose");
}
