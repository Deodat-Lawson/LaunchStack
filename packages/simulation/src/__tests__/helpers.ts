import { createWorld } from "../world";
import type { ModelReply, ModelRequest, Persona, SimulationModel, World } from "../types";

export function persona(id: string, overrides: Partial<Persona> = {}): Persona {
    return {
        id,
        name: `Person ${id}`,
        handle: `@person_${id}`,
        role: "Operator at a small firm",
        bio: "Runs operations. Watches costs closely.",
        interests: ["operations", "costs"],
        stance: 0,
        activity: 1,
        influence: 0.2,
        grounding: "grounded",
        sourceIds: ["E1"],
        ...overrides,
    };
}

export function smallWorld(overrides: { personas?: Persona[]; seed?: number } = {}): World {
    return createWorld({
        subject: "Acme raises prices by 20%",
        brief: "Acme sells invoicing software to small firms.",
        personas: overrides.personas ?? [
            persona("a1"),
            persona("a2"),
            persona("a3"),
            persona("a4"),
        ],
        accounts: [{ id: "narrator", name: "Newswire", handle: "@newswire" }],
        seedPosts: [
            { authorId: "narrator", text: "Acme announces a 20% price increase for all plans." },
        ],
        config: { seed: overrides.seed ?? 7, swapRate: 0 },
    });
}

/** Post ids in a decision prompt's feed, in order. */
export function feedIds(prompt: string): string[] {
    return [...prompt.matchAll(/^\[(p\d+)\]/gm)].map(m => m[1]!);
}

/** The persona id a decision request is for, from "(@person_a1)". */
export function agentOf(request: ModelRequest): string {
    return /\(@person_(a\d+)\)/.exec(request.system)?.[1] ?? "?";
}

export type Script = (request: ModelRequest) => unknown;

/** A model that answers from a script; returns JSON for objects, text for strings. */
export function fakeModel(script: Script): SimulationModel & { requests: ModelRequest[] } {
    const requests: ModelRequest[] = [];
    return {
        requests,
        async complete(request: ModelRequest): Promise<ModelReply> {
            requests.push(request);
            const out = script(request);
            if (out instanceof Error) throw out;
            return {
                text: typeof out === "string" ? out : JSON.stringify(out),
                usage: { inputTokens: 100, outputTokens: 20 },
            };
        },
    };
}

/** Every agent likes the first post in its feed, comments on it, and posts once in round 1. */
export const chattyScript: Script = request => {
    if (request.purpose !== "decide") return {};
    const ids = feedIds(request.prompt);
    const round = Number(/^Round (\d+)\./m.exec(request.prompt)?.[1] ?? 0);
    const agent = agentOf(request);
    const actions: unknown[] = [];
    if (ids[0]) {
        actions.push({ type: "like", postId: ids[0], text: null, handle: null });
        actions.push({ type: "comment", postId: ids[0], text: `${agent} says hi`, handle: null });
    }
    if (round === 1)
        actions.push({
            type: "create_post",
            postId: null,
            text: `${agent} thinks prices matter`,
            handle: null,
        });
    return { thought: `${agent} is reading`, stance: agent === "a1" ? -2 : 1, actions };
};
