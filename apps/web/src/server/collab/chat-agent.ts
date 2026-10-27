/**
 * An agent inside a chat turn.
 *
 * The chat route already takes a response style and a set of per-turn
 * toggles. An agent is those things with a name: its standing instructions
 * go above the style prompt, its tool policy decides which toggles survive,
 * and its route and temperature reach the model factory. Everything decided
 * here is pure except the roster lookup, so the composer's preview and the
 * route's enforcement cannot disagree.
 */

import {
    resolveChatTurn,
    usableAsPrimary,
    usableAsSubagent,
    type ChatTurnRequest,
    type ResolvedChatTurn,
} from "~/lib/agents/definition";

import { copy, type Copy } from "~/i18n/copy";
import { englishCopy } from "~/i18n/translate";

import { getPersonaByKey, personaToDefinition, type PersonaRecord } from "./personas";

export interface ChatAgentResolution {
    persona: PersonaRecord;
    turn: ResolvedChatTurn;
}

/**
 * Why a turn's agent was refused. `message` is the English; `copy` is the
 * sentence the route words in the reader's language (`agents.server.chatAgent`).
 */
export class ChatAgentError extends Error {
    readonly copy: Copy | null;

    constructor(
        message: string | Copy,
        readonly status: number
    ) {
        super(typeof message === "string" ? message : englishCopy(message));
        this.name = "ChatAgentError";
        this.copy = typeof message === "string" ? null : message;
    }
}

/**
 * Finds the agent and applies its policy to the requested turn. Throws a
 * 404 for an unknown or retired handle and a 400 for an agent that may not
 * answer directly (a subagent addressed by `@handle` is fine; a
 * `subagent`-only agent picked as the chat's voice is not).
 */
export async function resolveChatAgent(
    companyId: bigint,
    agentKey: string | null | undefined,
    request: ChatTurnRequest & { mentioned?: boolean }
): Promise<ChatAgentResolution | null> {
    if (!agentKey) return null;
    const persona = await getPersonaByKey(companyId, agentKey);
    if (!persona || persona.archived) {
        throw new ChatAgentError(
            copy("agents.server.chatAgent.notFound", { handle: agentKey }),
            404
        );
    }
    const allowed = request.mentioned ? usableAsSubagent(persona) : usableAsPrimary(persona);
    if (!allowed) {
        throw new ChatAgentError(
            copy(
                request.mentioned
                    ? "agents.server.chatAgent.primaryOnly"
                    : "agents.server.chatAgent.subagentOnly",
                { handle: persona.id }
            ),
            400
        );
    }
    return { persona, turn: resolveChatTurn(personaToDefinition(persona), request) };
}

/** The block that goes above the style prompt: who is speaking, and how. */
export function agentSystemPromptBlock(persona: PersonaRecord): string {
    const lines = [
        `You are ${persona.displayName}, the workspace's ${persona.role}. You are answering a colleague directly, in a one-to-one chat, on behalf of Launchstack.`,
        "",
        persona.systemPrompt.trim(),
        "",
        "Stay in this role for the whole answer. If the question is outside what this role should answer, say so in one line and answer what you can from the sources.",
    ];
    if (persona.maxTurnChars) {
        lines.push(`Keep the answer under ${persona.maxTurnChars} characters.`);
    }
    return lines.join("\n");
}

/** What the response echoes back so the transcript can attribute the turn. */
export function agentResponseInfo(resolution: ChatAgentResolution | null) {
    if (!resolution) return null;
    return {
        key: resolution.persona.id,
        displayName: resolution.persona.displayName,
        role: resolution.persona.role,
        accent: resolution.persona.accent ?? null,
        avatarUrl: resolution.persona.avatarUrl ?? null,
        notes: resolution.turn.notes,
    };
}
