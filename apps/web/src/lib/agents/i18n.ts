/**
 * The agent vocabulary in the reader's language: autonomy levels, modes,
 * answer styles, model routes, tools, the policy notes on a chat turn, the
 * meeting-plan violations, definition-file errors and the meeting workflows.
 *
 * The modules beside this one keep their English (`AGENT_AUTONOMY_META`,
 * `AGENT_MODE_META`, `AGENT_TOOLS`, `MEETING_WORKFLOWS`, …) for the server,
 * the API, the definition file and the prompts a model reads; a screen reads
 * the same words from the `agents` namespace through `useAgentCopy()`, or
 * through the plain functions with a `t` it already has. Client-safe.
 */

import { useTranslations } from "next-intl";

import type { AgentFileError } from "./agent-file";
import type { AgentAutonomy, MeetingPlanViolation } from "./autonomy";
import {
    agentTool,
    agentTurnNoteId,
    type AgentMode,
    type AgentRouteId,
    type AgentStyleId,
} from "./definition";
import {
    meetingWorkflow,
    type MeetingWorkflow,
    type WorkflowPhaseTemplate,
} from "./meeting-workflows";

export type AgentsTranslator = ReturnType<typeof useTranslations<"agents">>;

/** `daci-decision` → `daciDecision`: catalogue keys are camelCase. */
function messageId(id: string): string {
    return id.replace(/[-_]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
}

/** A key computed from data (a workflow, a tool id): the English text when it is not catalogued. */
function lookup(t: AgentsTranslator, key: string, fallback: string): string {
    const loose = t as unknown as { has: (key: string) => boolean; (key: string): string };
    return loose.has(key) ? loose(key) : fallback;
}

export function autonomyLabel(t: AgentsTranslator, level: AgentAutonomy): string {
    return t(`autonomy.${level}.label`);
}

export function autonomyDescription(t: AgentsTranslator, level: AgentAutonomy): string {
    return t(`autonomy.${level}.description`);
}

export function modeLabel(t: AgentsTranslator, mode: AgentMode): string {
    return t(`modes.${mode}.label`);
}

export function modeDescription(t: AgentsTranslator, mode: AgentMode): string {
    return t(`modes.${mode}.description`);
}

/** "Concise", "Detailed"… */
export function styleLabel(t: AgentsTranslator, style: AgentStyleId): string {
    return t(`styles.${style}.label`);
}

/** One sentence on what the style does to an answer. */
export function styleDescription(t: AgentsTranslator, style: AgentStyleId): string {
    return t(`styles.${style}.description`);
}

/** "Concise — direct and short": the label and its gist on one line. */
export function styleSummary(t: AgentsTranslator, style: AgentStyleId): string {
    return t(`styles.${style}.summary`);
}

export function routeLabel(t: AgentsTranslator, route: AgentRouteId): string {
    return t(`routes.${route}`);
}

/** A registry tool's name; an id the registry no longer knows reads as itself. */
export function toolLabel(t: AgentsTranslator, id: string): string {
    return lookup(t, `tools.${messageId(id)}.label`, agentTool(id)?.label ?? id);
}

export function toolDescription(t: AgentsTranslator, id: string): string {
    return lookup(t, `tools.${messageId(id)}.description`, agentTool(id)?.description ?? "");
}

/** A note `resolveChatTurn` wrote (in English, often over the wire); other text is returned as is. */
export function turnNote(t: AgentsTranslator, note: string): string {
    const id = agentTurnNoteId(note);
    return id ? t(`turnNotes.${id}`) : note;
}

/** One `meetingPlanViolationCodes` entry as the dialog shows it. */
export function violationMessage(t: AgentsTranslator, violation: MeetingPlanViolation): string {
    if (violation.code === "mirrorNeedsWrite") {
        return t("violations.mirrorNeedsWrite", {
            required: autonomyLabel(t, violation.required),
            current: autonomyLabel(t, violation.current),
        });
    }
    return t("violations.agentIdentityNeedsFull", {
        required: autonomyLabel(t, violation.required),
    });
}

/** What went wrong reading a definition file; anything that is not an `AgentFileError` is "Could not read that file". */
export function fileErrorMessage(t: AgentsTranslator, error: unknown): string {
    const err = error as Partial<AgentFileError> | null;
    switch (err?.code) {
        case "missingFrontMatter":
            return t("fileErrors.missingFrontMatter");
        case "unexpectedListItem":
            return t("fileErrors.unexpectedListItem", { line: err.line ?? "" });
        case "unreadableLine":
            return t("fileErrors.unreadableLine", { line: err.line ?? "" });
        case "unexpectedIndent":
            return t("fileErrors.unexpectedIndent", { line: err.line ?? "" });
        case "missingName":
            return t("fileErrors.missingName");
        case "emptyBody":
            return t("fileErrors.emptyBody");
        default:
            return t("fileErrors.unreadable");
    }
}

export function workflowCategoryLabel(
    t: AgentsTranslator,
    category: MeetingWorkflow["category"]
): string {
    return t(`workflowCategories.${category}`);
}

/** The words a workflow card and the dialog show, in the reader's language. */
export interface WorkflowCopy {
    title: string;
    tagline: string;
    description: string;
    basis?: { name: string; origin: string; usedBy: string };
}

export function workflowCopy(
    t: AgentsTranslator,
    workflow: Pick<MeetingWorkflow, "key" | "title" | "tagline" | "description" | "basis">
): WorkflowCopy {
    const base = `workflows.${messageId(workflow.key)}`;
    return {
        title: lookup(t, `${base}.title`, workflow.title),
        tagline: lookup(t, `${base}.tagline`, workflow.tagline),
        description: lookup(t, `${base}.description`, workflow.description),
        ...(workflow.basis
            ? {
                  basis: {
                      name: lookup(t, `${base}.basis.name`, workflow.basis.name),
                      origin: lookup(t, `${base}.basis.origin`, workflow.basis.origin),
                      usedBy: lookup(t, `${base}.basis.usedBy`, workflow.basis.usedBy),
                  },
              }
            : {}),
    };
}

/**
 * A phase's title and goal for display. The meeting stores (and the model
 * reads) the English template; a phase still worded as its workflow's
 * template shows the catalogue's words, an edited one shows what was typed.
 */
export function phaseCopy(
    t: AgentsTranslator,
    workflowKey: string | null | undefined,
    phase: Pick<WorkflowPhaseTemplate, "id" | "title" | "goal">
): { title: string; goal: string } {
    const template = meetingWorkflow(workflowKey)?.phases.find(p => p.id === phase.id);
    if (!template || !workflowKey) return { title: phase.title, goal: phase.goal };
    const base = `workflows.${messageId(workflowKey)}.phases.${messageId(phase.id)}`;
    return {
        title:
            phase.title === template.title ? lookup(t, `${base}.title`, phase.title) : phase.title,
        goal: phase.goal === template.goal ? lookup(t, `${base}.goal`, phase.goal) : phase.goal,
    };
}

/** Every function above, bound to the reader's language. */
export function useAgentCopy() {
    const t = useTranslations("agents");
    return {
        t,
        autonomyLabel: (level: AgentAutonomy) => autonomyLabel(t, level),
        autonomyDescription: (level: AgentAutonomy) => autonomyDescription(t, level),
        modeLabel: (mode: AgentMode) => modeLabel(t, mode),
        modeDescription: (mode: AgentMode) => modeDescription(t, mode),
        styleLabel: (style: AgentStyleId) => styleLabel(t, style),
        styleDescription: (style: AgentStyleId) => styleDescription(t, style),
        styleSummary: (style: AgentStyleId) => styleSummary(t, style),
        routeLabel: (route: AgentRouteId) => routeLabel(t, route),
        toolLabel: (id: string) => toolLabel(t, id),
        toolDescription: (id: string) => toolDescription(t, id),
        turnNote: (note: string) => turnNote(t, note),
        violationMessage: (violation: MeetingPlanViolation) => violationMessage(t, violation),
        fileErrorMessage: (error: unknown) => fileErrorMessage(t, error),
        workflowCategoryLabel: (category: MeetingWorkflow["category"]) =>
            workflowCategoryLabel(t, category),
        workflowCopy: (
            workflow: Pick<MeetingWorkflow, "key" | "title" | "tagline" | "description" | "basis">
        ) => workflowCopy(t, workflow),
        phaseCopy: (
            workflowKey: string | null | undefined,
            phase: Pick<WorkflowPhaseTemplate, "id" | "title" | "goal">
        ) => phaseCopy(t, workflowKey, phase),
    };
}
