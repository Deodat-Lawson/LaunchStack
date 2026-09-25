/**
 * Battle test: every starter agent's prompt, and a phased meeting between
 * them, run against a real model. No mocks, no scripted turns.
 *
 * Uses any OpenAI-compatible endpoint (LM Studio by default) so it runs
 * without the deployment's model configuration:
 *
 *   BATTLE_BASE_URL=http://localhost:1234/v1 BATTLE_MODEL=qwen/qwen3.5-9b \
 *   SKIP_ENV_VALIDATION=true pnpm exec tsx scripts/battle-test-agents.ts
 *
 * Writes a markdown report with every prompt's output and the meeting
 * transcript to scripts/out/battle-test-agents.md (gitignored), and exits
 * non-zero when a turn is empty, refuses the task, or breaks character.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    buildMinutes,
    createMeeting,
    InMemoryChannelStore,
    LlmAgentRuntime,
    type CollabChatFn,
} from "@launchstack/collab";
import { meetingWorkflow, phasesForRoom } from "~/lib/agents/meeting-workflows";
import { STARTER_AGENTS, starterDefinition } from "~/lib/agents/starter-agents";

const BASE_URL = process.env.BATTLE_BASE_URL ?? "http://localhost:1234/v1";
const MODEL = process.env.BATTLE_MODEL ?? "qwen/qwen3.5-9b";
const API_KEY = process.env.BATTLE_API_KEY ?? "lm-studio";
const TIMEOUT_MS = Number(process.env.BATTLE_TIMEOUT_MS ?? 300_000);
/**
 * Qwen-family models think by default and can spend the whole budget on it;
 * the soft switch on the last message turns that off. Harmless elsewhere.
 */
const NO_THINK = process.env.BATTLE_NO_THINK === "0" ? "" : " /no_think";
const MAX_TOKENS = Number(process.env.BATTLE_MAX_TOKENS ?? 2500);

/** The same grounding a workspace would retrieve — a small, concrete company. */
const CONTEXT = [
    "Acme Robotics — Q2 board pack, p. 3: revenue $1.42M (+18% QoQ), gross margin 42%, net burn $310k/month, cash $4.1M (13 months). List price unchanged for four quarters.",
    "Pricing memo, p. 1: proposed Tier B moves from $1,200 to $1,500/month with a usage cap of 10k picks; finance model shows margin recovering to 44% within one quarter; 3 of 41 customers are over the proposed cap today.",
    "Engineering note: usage-based metering needs the billing migration (est. 2 sprints); rollback = feature flag on the new invoice path.",
    "Support digest (last 30 days): 14 tickets mention 'surprise invoice'; 6 ask for a spending cap; 2 threaten churn over overage charges.",
    "Sales notes: 3 open deals asked about caps this month; Globex (largest, $96k ARR) objected to overage last renewal; MSA §7.2 requires 60 days' notice for price changes.",
];

const CHAT_QUESTION =
    "We are considering the Tier B price change in the pricing memo. From your seat, what should we do, and what would you push back on?";

function stripThink(text: string): string {
    // Reasoning models may emit <think>…</think>; the answer is what follows.
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function complete(messages: { role: string; content: string }[], temperature = 0.4) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    // The switch goes on the last message so it applies to this turn only.
    const sent = messages.map((m, i) =>
        i === messages.length - 1 ? { ...m, content: `${m.content}${NO_THINK}` } : m
    );
    try {
        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
            body: JSON.stringify({
                model: MODEL,
                messages: sent,
                temperature,
                max_tokens: MAX_TOKENS,
                chat_template_kwargs: { enable_thinking: NO_THINK === "" },
            }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
        const data = (await response.json()) as {
            choices: {
                message: { content: string; reasoning_content?: string };
                finish_reason?: string;
            }[];
            usage?: { total_tokens?: number; completion_tokens?: number };
        };
        const choice = data.choices[0];
        const text = stripThink(choice?.message.content ?? "");
        if (!text && choice?.finish_reason === "length") {
            throw new Error(`budget of ${MAX_TOKENS} tokens exhausted before an answer`);
        }
        return { text, tokens: data.usage?.total_tokens ?? 0 };
    } finally {
        clearTimeout(timer);
    }
}

const chatFn: CollabChatFn = async ({ messages, temperature }) => {
    const { text } = await complete(messages, temperature ?? 0.4);
    return text;
};

interface Check {
    agent: string;
    ok: boolean;
    problems: string[];
    ms: number;
    tokens: number;
    text: string;
}

const REFUSAL =
    /as an ai (language )?model|i cannot (help|assist) with|i'm unable to (help|assist)|i can't (help|assist) with that/i;

function judge(agentKey: string, text: string): string[] {
    const problems: string[] = [];
    if (text.trim().length < 200) problems.push(`too short (${text.trim().length} chars)`);
    if (REFUSAL.test(text)) problems.push("refused the task");
    if (/\bINPUT:\s*$/m.test(text)) problems.push("echoed the INPUT marker");
    if (/lorem ipsum/i.test(text)) problems.push("placeholder text");
    // Grounding: every seat was given the same numbers; an answer that uses none of them is talking past the sources.
    const anchors = [
        "42%",
        "44%",
        "1,500",
        "1500",
        "10k",
        "60 days",
        "Globex",
        "surprise invoice",
        "310k",
        "13 months",
        "2 sprints",
        "two sprints",
    ];
    if (!anchors.some(a => text.includes(a))) problems.push("uses none of the supplied figures");
    return problems;
}

async function main() {
    const started = Date.now();
    const report: string[] = [
        `# Battle test — starter agents`,
        ``,
        `Model: \`${MODEL}\` at \`${BASE_URL}\` · ${new Date().toISOString()}`,
        ``,
        `Question put to every agent in chat mode:`,
        ``,
        `> ${CHAT_QUESTION}`,
        ``,
        `Grounding supplied to every turn:`,
        ``,
        ...CONTEXT.map((c, i) => `${i + 1}. ${c}`),
        ``,
    ];

    // ---------------------------------------------------------------- chat
    const checks: Check[] = [];
    for (const starter of STARTER_AGENTS) {
        const agent = starterDefinition(starter);
        const system = [
            `You are ${agent.displayName}, the workspace's ${agent.role}. You are answering a colleague directly, in a one-to-one chat, on behalf of Launchstack.`,
            ``,
            agent.systemPrompt,
            ``,
            `Stay in this role for the whole answer. If the question is outside what this role should answer, say so in one line and answer what you can from the sources.`,
            ``,
            `## Grounding context`,
            `Only these passages are known-good. Do not invent facts beyond them; say so when something is unknown.`,
            ...CONTEXT.map((c, i) => `[${i + 1}] ${c}`),
        ].join("\n");
        const t0 = Date.now();
        let text = "";
        let tokens = 0;
        const problems: string[] = [];
        try {
            ({ text, tokens } = await complete(
                [
                    { role: "system", content: system },
                    { role: "user", content: CHAT_QUESTION },
                ],
                agent.temperature ?? 0.4
            ));
            problems.push(...judge(agent.key, text));
        } catch (err) {
            problems.push(`request failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        const ms = Date.now() - t0;
        checks.push({ agent: agent.key, ok: problems.length === 0, problems, ms, tokens, text });
        console.log(
            `${problems.length === 0 ? "ok  " : "FAIL"} ${agent.key.padEnd(12)} ${String(ms).padStart(6)}ms ${problems.join("; ")}`
        );
    }

    report.push(
        `## Chat mode`,
        ``,
        `| Agent | Result | Time | Tokens | Notes |`,
        `| --- | --- | ---: | ---: | --- |`
    );
    for (const c of checks) {
        report.push(
            `| ${c.agent} | ${c.ok ? "ok" : "**fail**"} | ${(c.ms / 1000).toFixed(1)}s | ${c.tokens} | ${c.problems.join("; ")} |`
        );
    }
    report.push(``);
    for (const c of checks) {
        report.push(`### @${c.agent}`, ``, c.text.trim() || "_(empty)_", ``);
    }

    // ------------------------------------------------------------- meeting
    const workflow = meetingWorkflow("daci-decision")!;
    const seats = workflow.agents;
    const participants = STARTER_AGENTS.filter(a => seats.includes(a.key)).map(a => {
        const d = starterDefinition(a);
        return {
            id: d.key,
            displayName: d.displayName,
            role: d.role,
            systemPrompt: d.systemPrompt,
            temperature: d.temperature ?? undefined,
            maxTurnChars: 1600,
        };
    });
    const store = new InMemoryChannelStore();
    const runtime = new LlmAgentRuntime(chatFn, { nodeId: "local", maxTokens: 900 });
    const meeting = await createMeeting({
        store,
        workspaceId: "battle",
        title: "Tier B price change",
        objective: "Decide whether to ship the Tier B price change in Q3 and name who owns it",
        agenda: workflow.agenda,
        participants,
        runtimes: [runtime],
        turnPolicy: { kind: "moderated", moderatorId: "facilitator" },
        maxTurns: 10,
        context: CONTEXT,
        phases: phasesForRoom(workflow, seats),
        workflowKey: workflow.key,
    });
    const t0 = Date.now();
    const meetingProblems: string[] = [];
    try {
        await meeting.orchestrator.run();
    } catch (err) {
        meetingProblems.push(`run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const state = meeting.orchestrator.getState();
    const transcript = await store.read(meeting.config.channelId);
    const chat = transcript.filter(m => m.kind === "chat");
    const speakers = new Set(chat.map(m => m.author.id));
    if (state.status !== "completed") meetingProblems.push(`ended in status ${state.status}`);
    if (chat.length < 6) meetingProblems.push(`only ${chat.length} turns`);
    for (const seat of seats) if (!speakers.has(seat)) meetingProblems.push(`@${seat} never spoke`);
    const failed = transcript.filter(m => m.meta?.event === "turn_failed");
    if (failed.length > 0) meetingProblems.push(`${failed.length} failed turn(s)`);
    const minutes = buildMinutes(meeting.config, state, transcript);
    if (minutes.decisions.length === 0) meetingProblems.push("no decision extracted");

    report.push(
        `## Meeting mode — ${workflow.title}`,
        ``,
        `Status: ${state.status} · ${state.turnIndex} turns · ${((Date.now() - t0) / 1000).toFixed(0)}s · ${meetingProblems.length === 0 ? "ok" : `**${meetingProblems.join("; ")}**`}`,
        ``,
        `Decisions extracted: ${minutes.decisions.length} · Action items: ${minutes.actionItems.length}`,
        ``,
        ...minutes.decisions.map(d => `- Decision (@${d.author}): ${d.text}`),
        ...minutes.actionItems.map(a => `- Action${a.owner ? ` (@${a.owner})` : ""}: ${a.text}`),
        ``,
        `### Transcript`,
        ``
    );
    for (const m of transcript) {
        const who =
            m.kind === "system" ? "_system_" : `**${m.author.displayName}** (@${m.author.id})`;
        report.push(`${who}: ${m.text.replace(/\n/g, "\n> ")}`, ``);
    }

    const failures = checks.filter(c => !c.ok).length + (meetingProblems.length > 0 ? 1 : 0);
    report.push(
        `## Verdict`,
        ``,
        `${checks.length - checks.filter(c => !c.ok).length}/${checks.length} chat prompts passed; meeting ${meetingProblems.length === 0 ? "passed" : "failed"}. Total ${((Date.now() - started) / 1000 / 60).toFixed(1)} min.`
    );

    mkdirSync(join(process.cwd(), "scripts", "out"), { recursive: true });
    const out = join(process.cwd(), "scripts", "out", "battle-test-agents.md");
    writeFileSync(out, report.join("\n"));
    console.log(
        `\nmeeting: ${state.status}, ${chat.length} turns, ${meetingProblems.join("; ") || "ok"}`
    );
    console.log(`report: ${out}`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
