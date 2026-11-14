import type { AgentPersona, ChannelMessage } from "../types";

function seat(id: string, displayName: string, role: string): AgentPersona {
    return { id, displayName, role, systemPrompt: "" };
}

/** The DACI and pre-mortem rooms from the starter roster, as the meetings seat them. */
export const FACILITATOR = seat("facilitator", "Ada", "Facilitator");
export const ANALYST = seat("analyst", "Ravi", "Analyst");
export const FINANCE = seat("finance", "Dana", "Finance partner");
export const ENGINEER = seat("engineer", "Sam", "Engineering lead");
export const CRITIC = seat("critic", "Vera", "Critic");
export const SALES = seat("sales", "Noor", "Sales lead");
export const COUNSEL = seat("counsel", "Mira", "Counsel");

/** Builds a channel transcript in order, assigning seq and ids. */
export class Transcript {
    readonly messages: ChannelMessage[] = [];

    private push(message: Omit<ChannelMessage, "id" | "seq" | "ts" | "channelId">): this {
        const seq = this.messages.length + 1;
        this.messages.push({
            id: `m${seq}`,
            channelId: "c",
            seq,
            ts: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
            ...message,
        });
        return this;
    }

    /** An agent's turn. */
    say(persona: AgentPersona, text: string): this {
        return this.push({
            author: { kind: "agent", id: persona.id, displayName: persona.displayName },
            kind: "chat",
            text,
        });
    }

    /** A person in the channel, optionally speaking through an agent's seat. */
    human(text: string, asPersonaId?: string): this {
        return this.push({
            author: {
                kind: "human",
                id: "u_1",
                displayName: "Alex",
                onBehalfOfPersonaId: asPersonaId,
            },
            kind: "chat",
            text,
        });
    }

    system(text: string, meta?: Record<string, unknown>): this {
        return this.push({
            author: { kind: "agent", id: "system", displayName: "Launchstack" },
            kind: "system",
            text,
            meta,
        });
    }

    /** The orchestrator's note for a turn that failed: the seat's turn is spent. */
    failed(persona: AgentPersona): this {
        return this.system(`@${persona.id} could not respond (timeout). Passing the floor on.`, {
            event: "turn_failed",
            personaId: persona.id,
        });
    }
}
