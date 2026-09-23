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

import { getPersonaByKey, personaToDefinition, type PersonaRecord } from "./personas";

export interface ChatAgentResolution {
    persona: PersonaRecord;
    turn: ResolvedChatTurn;
}

export class ChatAgentError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "ChatAgentError";
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
        throw new ChatAgentError(`No agent with the handle "@${agentKey}" in this workspace`, 404);
    }
    const allowed = request.mentioned ? usableAsSubagent(persona) : usableAsPrimary(persona);
    if (!allowed) {
        throw new ChatAgentError(
            request.mentioned
                ? `@${persona.id} is a primary-only agent — pick it in the composer instead of mentioning it`
                : `@${persona.id} is a subagent — summon it with @${persona.id} in a message`,
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
        notes: resolution.turn.notes,
    };
}
