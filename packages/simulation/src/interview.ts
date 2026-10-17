/**
 * Interviews — OASIS's INTERVIEW action and MiroFish's "deep interaction":
 * ask one simulated person about what they saw and did, or ask the analyst
 * about the whole run.
 */

import { personaSystem } from "./decide";
import { clip } from "./text";
import type { ModelRequest, World } from "./types";
import { author, findAgent, stanceLabel } from "./world";

export interface InterviewTurn {
    question: string;
    answer: string;
}

export const MAX_QUESTION_CHARS = 600;

export function buildInterviewRequest(
    world: World,
    agentId: string,
    question: string,
    history: InterviewTurn[] = []
): ModelRequest {
    const agent = findAgent(world, agentId);
    if (!agent) throw new Error(`Unknown agent ${agentId}`);
    const own = [
        ...world.posts
            .filter(p => p.authorId === agentId && p.kind !== "repost")
            .map(p => ({ round: p.round, line: `Round ${p.round}, you posted [${p.id}]: "${clip(p.text, 200)}"` })),
        ...world.comments
            .filter(c => c.authorId === agentId)
            .map(c => ({ round: c.round, line: `Round ${c.round}, you commented on [${c.postId}]: "${clip(c.text, 160)}"` })),
    ]
        .sort((a, b) => a.round - b.round)
        .map(x => x.line);
    const stanceTrail = agent.stanceHistory.map(stanceLabel).join(" → ");
    const system = [
        personaSystem(world, agent),
        "",
        "Someone from the team is interviewing you about the conversation on the network. Answer in the first person, in your own voice, honestly reflecting what you saw, did and think. At most 120 words. If you didn't see or do something, say so. Never say you are an AI, a model, a character or in a simulation.",
    ].join("\n");
    const prompt = [
        "What you remember:",
        agent.memory.map(m => `- Round ${m.round}: ${m.text}`).join("\n") || "- You mostly watched.",
        "",
        "What you wrote:",
        own.join("\n") || "- Nothing.",
        "",
        `How your view moved: ${stanceTrail}.`,
        agent.lastThought ? `Your last private thought: "${agent.lastThought}"` : "",
        "",
        ...history.flatMap(t => [`Q: ${t.question}`, `A: ${t.answer}`]),
        `Q: ${clip(question, MAX_QUESTION_CHARS)}`,
        "A:",
    ]
        .filter(line => line !== "")
        .join("\n");
    return { purpose: "interview", system, prompt, maxOutputTokens: 400 };
}

export function buildAnalystRequest(
    world: World,
    reportSummary: string,
    question: string,
    history: InterviewTurn[] = []
): ModelRequest {
    const posts = world.posts
        .filter(p => p.kind !== "repost")
        .slice(-60)
        .map(p => `[${p.id}] round ${p.round} ${author(world, p.authorId).handle}: "${clip(p.text, 160)}" (${p.likes} likes, ${p.comments} comments, ${p.shares} shares)`);
    const rounds = world.rounds
        .map(r => `round ${r.round}: ${r.active} active, ${r.posts} posts, ${r.comments} comments, mean stance ${r.meanStance}`)
        .join("\n");
    const people = world.agents
        .map(a => `${a.persona.handle} (${a.persona.role}): ${stanceLabel(a.stanceHistory[0] ?? a.stance)} → ${stanceLabel(a.stance)}`)
        .join("\n");
    const system = [
        "You answer questions about a finished social-network simulation run for a founder team.",
        "Answer only from the run's data below. Cite posts as [p12]. When the run doesn't show something, say so.",
        "This was a scenario among simulated people, not a forecast; never present it as what will happen in reality.",
        "At most 150 words.",
    ].join("\n");
    const prompt = [
        `Subject: ${world.subject}`,
        reportSummary ? `Report summary: ${reportSummary}` : "",
        "",
        "Rounds:",
        rounds,
        "",
        "People (start → end):",
        people,
        "",
        "Posts:",
        posts.join("\n"),
        "",
        ...history.flatMap(t => [`Q: ${t.question}`, `A: ${t.answer}`]),
        `Q: ${clip(question, MAX_QUESTION_CHARS)}`,
        "A:",
    ]
        .filter(line => line !== "")
        .join("\n");
    return { purpose: "interview", system, prompt, maxOutputTokens: 500 };
}

export function cleanAnswer(text: string): string {
    return clip(text.replace(/^\s*A:\s*/i, ""), 1500);
}
