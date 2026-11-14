/**
 * Battle test: every starter agent's prompt, and phased meetings between
 * them, run against a real model. No mocks, no scripted turns.
 *
 * Uses any OpenAI-compatible endpoint (LM Studio by default) so it runs
 * without the deployment's model configuration:
 *
 *   BATTLE_BASE_URL=http://localhost:1234/v1 BATTLE_MODEL=qwen/qwen3.5-9b \
 *   SKIP_ENV_VALIDATION=true pnpm exec tsx scripts/battle-test-agents.ts
 *
 * Meeting turns get the same budget the app gives them (`server/collab/
 * turn-budget.ts`): low reasoning effort and room for a full reply. Override
 * to compare, e.g. the budget meetings had before:
 *
 *   BATTLE_REASONING=default BATTLE_MEETING_MAX_TOKENS=800
 *
 * Other knobs: BATTLE_WORKFLOWS (comma-separated recipe keys, default
 * daci-decision,premortem), BATTLE_SKIP_CHAT=1 to skip the one-to-one chat
 * prompts, BATTLE_NO_THINK=0 for endpoints that are not Qwen-style.
 *
 * Writes a markdown report with every prompt's output and each meeting's
 * turns, phases and transcript to scripts/out/battle-test-agents.md
 * (gitignored), a JSON summary beside it, and exits non-zero when a turn is
 * cut off, fails or speaks for another seat, a seat a phase lists is never
 * heard, or a chat answer is empty, refuses or breaks character.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    buildMinutes,
    createMeeting,
    InMemoryChannelStore,
    keepOwnVoice,
    LlmAgentRuntime,
    type AgentPersona,
    type ChannelMessage,
    type CollabChatFn,
} from "@launchstack/collab";
import { meetingWorkflow, phasesForRoom, workflowTurnCount } from "~/lib/agents/meeting-workflows";
import { STARTER_AGENTS, starterDefinition } from "~/lib/agents/starter-agents";
import { MEETING_TURN_EFFORTS, MEETING_TURN_MAX_OUTPUT_TOKENS } from "~/server/collab/turn-budget";

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
/** Meeting turns: the app's cap unless overridden. */
const MEETING_MAX_TOKENS = Number(
    process.env.BATTLE_MEETING_MAX_TOKENS ?? MEETING_TURN_MAX_OUTPUT_TOKENS
);
/**
 * Meeting turns: the app's effort (`low`) unless overridden; `default` sends no
 * reasoning setting at all, which is what meetings did before.
 */
const MEETING_REASONING = process.env.BATTLE_REASONING ?? MEETING_TURN_EFFORTS[0];
const WORKFLOWS = (process.env.BATTLE_WORKFLOWS ?? "daci-decision,premortem")
    .split(",")
    .map(key => key.trim())
    .filter(Boolean);
const SKIP_CHAT = process.env.BATTLE_SKIP_CHAT === "1";

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

/** What each recipe is asked to produce in this test. */
const OBJECTIVES: Record<string, string> = {
    "daci-decision": "Decide whether to ship the Tier B price change in Q3 and name who owns it",
    premortem:
        "Find the ways the Tier B price change fails and assign a mitigation to each one that matters",
};

function stripThink(text: string): string {
    // Reasoning models may emit <think>…</think>; the answer is what follows.
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

interface CallRecord {
    ms: number;
    finishReason: string | null;
    completionTokens: number;
    reasoningTokens: number;
    chars: number;
}

/** Every model call, in order; meeting turns read their slice of it. */
const calls: CallRecord[] = [];

async function complete(
    messages: { role: string; content: string }[],
    options: { temperature?: number; maxTokens?: number; reasoningEffort?: string } = {}
) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const maxTokens = options.maxTokens ?? MAX_TOKENS;
    // The switch goes on the last message so it applies to this turn only.
    const sent = messages.map((m, i) =>
        i === messages.length - 1 ? { ...m, content: `${m.content}${NO_THINK}` } : m
    );
    const t0 = Date.now();
    try {
        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
            body: JSON.stringify({
                model: MODEL,
                messages: sent,
                temperature: options.temperature ?? 0.4,
                max_tokens: maxTokens,
                ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
                ...(NO_THINK ? { chat_template_kwargs: { enable_thinking: false } } : {}),
            }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
        const data = (await response.json()) as {
            choices: {
                message: { content: string | null; reasoning_content?: string };
                finish_reason?: string;
            }[];
            usage?: {
                total_tokens?: number;
                completion_tokens?: number;
                completion_tokens_details?: { reasoning_tokens?: number };
            };
        };
        const choice = data.choices[0];
        const text = stripThink(choice?.message.content ?? "");
        calls.push({
            ms: Date.now() - t0,
            finishReason: choice?.finish_reason ?? null,
            completionTokens: data.usage?.completion_tokens ?? 0,
            reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
            chars: text.length,
        });
        if (!text && choice?.finish_reason === "length") {
            throw new Error(`budget of ${maxTokens} tokens exhausted before an answer`);
        }
        return { text, tokens: data.usage?.total_tokens ?? 0 };
    } finally {
        clearTimeout(timer);
    }
}

/** Meeting turns: raw model text, untrimmed, so a cut-off turn shows as one. */
const meetingChat: CollabChatFn = async ({ messages, temperature }) => {
    const { text } = await complete(messages, {
        temperature,
        maxTokens: MEETING_MAX_TOKENS,
        reasoningEffort: MEETING_REASONING === "default" ? undefined : MEETING_REASONING,
    });
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

function judge(text: string): string[] {
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

/**
 * Ends like a finished thought: terminal punctuation, a closing bracket,
 * quote or emphasis, or a table row. A heuristic for the report; the model's
 * own `finish_reason: length` is what proves a cut.
 */
function endsCleanly(text: string): boolean {
    const last = text.trim().split("\n").filter(Boolean).at(-1)?.trim() ?? "";
    return /[.!?…)"'”’*_`|]$/.test(last);
}

interface TurnRow {
    turn: number;
    phase: number | null;
    speaker: string;
    chars: number;
    failed: boolean;
    finishReason: string | null;
    reasoningTokens: number;
    completionTokens: number;
    modelCalls: number;
    ms: number;
    endsCleanly: boolean;
    retriedOwnVoice: boolean;
    cutOtherVoices: boolean;
    foreignLabel: string | null;
}

interface MeetingRun {
    key: string;
    title: string;
    status: string;
    seconds: number;
    turns: TurnRow[];
    phases: { title: string; listed: string[]; heard: string[]; missing: string[] }[];
    seatTurns: Record<string, number>;
    problems: string[];
    decisions: number;
    actionItems: number;
    transcript: ChannelMessage[];
}

async function runMeeting(key: string): Promise<MeetingRun> {
    const workflow = meetingWorkflow(key);
    if (!workflow) throw new Error(`Unknown workflow "${key}"`);
    const seats = workflow.agents;
    const participants: AgentPersona[] = STARTER_AGENTS.filter(a => seats.includes(a.key)).map(
        a => {
            const d = starterDefinition(a);
            return {
                id: d.key,
                displayName: d.displayName,
                role: d.role,
                systemPrompt: d.systemPrompt,
                temperature: d.temperature ?? undefined,
                maxTurnChars: d.maxTurnChars ?? undefined,
                route: d.route ?? undefined,
            };
        }
    );
    const phases = phasesForRoom(workflow, seats);
    const store = new InMemoryChannelStore();
    const meeting = await createMeeting({
        store,
        workspaceId: "battle",
        title: `Tier B price change — ${workflow.title}`,
        objective:
            OBJECTIVES[key] ??
            workflow.objectiveTemplate.replace(/<[^>]+>/g, "the Tier B price change"),
        agenda: workflow.agenda,
        participants,
        runtimes: [new LlmAgentRuntime(meetingChat, { nodeId: "local" })],
        turnPolicy: { kind: workflow.turnPolicy, moderatorId: workflow.moderator },
        maxTurns: workflowTurnCount(workflow),
        context: CONTEXT,
        phases,
        workflowKey: workflow.key,
    });

    const callsByTurn = new Map<number, { calls: CallRecord[]; ms: number }>();
    const problems: string[] = [];
    const t0 = Date.now();
    try {
        for (;;) {
            const turnIndex = meeting.orchestrator.getState().turnIndex;
            const before = calls.length;
            const started = Date.now();
            const step = await meeting.orchestrator.step();
            callsByTurn.set(turnIndex, { calls: calls.slice(before), ms: Date.now() - started });
            if (step.done || step.skipped) break;
        }
    } catch (err) {
        problems.push(`run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const state = meeting.orchestrator.getState();
    const transcript = await store.read(meeting.config.channelId);

    // Turns in order, with the phase each fell in.
    const turns: TurnRow[] = [];
    let phase: number | null = null;
    for (const message of transcript) {
        if (message.meta?.event === "phase") phase = Number(message.meta.phaseIndex);
        const failed = message.meta?.event === "turn_failed";
        if (message.kind !== "chat" && !failed) continue;
        const turn = turns.length;
        const record = callsByTurn.get(turn);
        const used = record?.calls.at(-1);
        const speaker = failed ? String(message.meta?.personaId) : message.author.id;
        const voice = keepOwnVoice(
            message.text,
            participants.find(p => p.id === speaker) ?? { id: speaker, displayName: speaker },
            participants
        );
        turns.push({
            turn,
            phase,
            speaker,
            chars: failed ? 0 : message.text.length,
            failed,
            finishReason: used?.finishReason ?? null,
            reasoningTokens: record?.calls.reduce((sum, c) => sum + c.reasoningTokens, 0) ?? 0,
            completionTokens: record?.calls.reduce((sum, c) => sum + c.completionTokens, 0) ?? 0,
            modelCalls: record?.calls.length ?? 0,
            ms: record?.ms ?? 0,
            endsCleanly: !failed && endsCleanly(message.text),
            retriedOwnVoice: message.meta?.retriedOwnVoice === true,
            cutOtherVoices: message.meta?.cutOtherVoices === true,
            foreignLabel: voice.cut ? (voice.spokeAs ?? "a later line") : null,
        });
    }

    const phaseReport = phases.map((p, index) => {
        const heard = turns.filter(t => t.phase === index && !t.failed).map(t => t.speaker);
        const listed = p.speakerIds ?? [];
        return {
            title: p.title,
            listed,
            heard,
            missing: listed.filter(id => !heard.includes(id)),
        };
    });
    const seatTurns: Record<string, number> = {};
    for (const t of turns) if (!t.failed) seatTurns[t.speaker] = (seatTurns[t.speaker] ?? 0) + 1;

    if (state.status !== "completed") problems.push(`ended in status ${state.status}`);
    const cut = turns.filter(t => t.finishReason === "length");
    if (cut.length > 0) {
        problems.push(
            `${cut.length} turn(s) cut off at the cap: ${cut.map(t => t.turn + 1).join(", ")}`
        );
    }
    const failedTurns = turns.filter(t => t.failed);
    if (failedTurns.length > 0) problems.push(`${failedTurns.length} failed turn(s)`);
    for (const p of phaseReport) {
        if (p.missing.length > 0) {
            problems.push(
                `phase "${p.title}" never heard ${p.missing.map(id => `@${id}`).join(", ")}`
            );
        }
    }
    for (const seat of seats) {
        if (!seatTurns[seat]) problems.push(`@${seat} never spoke`);
    }
    const foreign = turns.filter(t => t.foreignLabel);
    if (foreign.length > 0) {
        problems.push(`${foreign.length} turn(s) still speak for another seat`);
    }
    const minutes = buildMinutes(meeting.config, state, transcript);
    if (minutes.decisions.length === 0 && key === "daci-decision") {
        problems.push("no decision extracted");
    }

    return {
        key,
        title: workflow.title,
        status: state.status,
        seconds: (Date.now() - t0) / 1000,
        turns,
        phases: phaseReport,
        seatTurns,
        problems,
        decisions: minutes.decisions.length,
        actionItems: minutes.actionItems.length,
        transcript,
    };
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

async function main() {
    const started = Date.now();
    const report: string[] = [
        `# Battle test — starter agents`,
        ``,
        `Model: \`${MODEL}\` at \`${BASE_URL}\` · ${new Date().toISOString()}`,
        ``,
        `Meeting turns: reasoning \`${MEETING_REASONING}\`, cap ${MEETING_MAX_TOKENS} tokens.`,
        ``,
        `Grounding supplied to every turn:`,
        ``,
        ...CONTEXT.map((c, i) => `${i + 1}. ${c}`),
        ``,
    ];

    // ---------------------------------------------------------------- chat
    const checks: Check[] = [];
    if (!SKIP_CHAT) {
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
                    { temperature: agent.temperature ?? 0.4 }
                ));
                problems.push(...judge(text));
            } catch (err) {
                problems.push(
                    `request failed: ${err instanceof Error ? err.message : String(err)}`
                );
            }
            const ms = Date.now() - t0;
            checks.push({
                agent: agent.key,
                ok: problems.length === 0,
                problems,
                ms,
                tokens,
                text,
            });
            console.log(
                `${problems.length === 0 ? "ok  " : "FAIL"} ${agent.key.padEnd(12)} ${String(ms).padStart(6)}ms ${problems.join("; ")}`
            );
        }

        report.push(
            `## Chat mode`,
            ``,
            `> ${CHAT_QUESTION}`,
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
    }

    // ------------------------------------------------------------- meetings
    const runs: MeetingRun[] = [];
    for (const key of WORKFLOWS) {
        console.log(`\nmeeting: ${key}`);
        const run = await runMeeting(key);
        runs.push(run);

        for (const t of run.turns) {
            const flag = t.failed
                ? "FAILED"
                : t.finishReason === "length"
                  ? "CUT"
                  : t.endsCleanly
                    ? "ok"
                    : "ok?";
            console.log(
                `  ${String(t.turn + 1).padStart(2)} p${(t.phase ?? 0) + 1} ${t.speaker.padEnd(11)} ${String(t.chars).padStart(5)}ch ${flag.padEnd(6)} ${String(t.reasoningTokens).padStart(5)} reasoning ${String(t.completionTokens).padStart(5)} out ${(t.ms / 1000).toFixed(1).padStart(5)}s${t.retriedOwnVoice ? " retried-own-voice" : ""}${t.cutOtherVoices ? " cut-other-voice" : ""}`
            );
        }
        for (const p of run.phases) {
            console.log(
                `  phase ${p.title}: ${p.heard.join(" → ") || "(nobody)"}${p.listed.length ? ` (listed ${p.listed.join(", ")})` : " (open)"}${p.missing.length ? `  MISSING ${p.missing.join(", ")}` : ""}`
            );
        }
        console.log(`  turns per seat: ${JSON.stringify(run.seatTurns)}`);
        console.log(`  ${run.status}, ${run.problems.join("; ") || "ok"}`);

        const spoken = run.turns.filter(t => !t.failed);
        report.push(
            `## Meeting — ${run.title}`,
            ``,
            `Status: ${run.status} · ${run.turns.length} turns · ${run.seconds.toFixed(0)}s · ${run.problems.length === 0 ? "ok" : `**${run.problems.join("; ")}**`}`,
            ``,
            `Turn length: median ${percentile(
                spoken.map(t => t.chars),
                50
            )} chars (min ${Math.min(...spoken.map(t => t.chars))}, max ${Math.max(...spoken.map(t => t.chars))}). Latency: median ${(
                percentile(
                    spoken.map(t => t.ms),
                    50
                ) / 1000
            ).toFixed(1)}s, p90 ${(
                percentile(
                    spoken.map(t => t.ms),
                    90
                ) / 1000
            ).toFixed(1)}s. Reasoning tokens: median ${percentile(
                spoken.map(t => t.reasoningTokens),
                50
            )}, max ${Math.max(...spoken.map(t => t.reasoningTokens))}. Decisions ${run.decisions} · action items ${run.actionItems}.`,
            ``,
            `| # | Phase | Speaker | Chars | Finish | Ends cleanly | Reasoning | Output | Calls | Time |`,
            `| ---: | --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: |`,
            ...run.turns.map(
                t =>
                    `| ${t.turn + 1} | ${run.phases[t.phase ?? 0]?.title ?? ""} | @${t.speaker} | ${t.chars} | ${t.failed ? "**failed**" : (t.finishReason ?? "?")} | ${t.endsCleanly ? "yes" : "**no**"} | ${t.reasoningTokens} | ${t.completionTokens} | ${t.modelCalls} | ${(t.ms / 1000).toFixed(1)}s |`
            ),
            ``,
            `| Phase | Listed | Heard, in order | Missing |`,
            `| --- | --- | --- | --- |`,
            ...run.phases.map(
                p =>
                    `| ${p.title} | ${p.listed.map(id => `@${id}`).join(", ") || "everyone"} | ${p.heard.map(id => `@${id}`).join(" → ")} | ${p.missing.map(id => `@${id}`).join(", ") || "—"} |`
            ),
            ``,
            `Turns per seat: ${Object.entries(run.seatTurns)
                .map(([seat, n]) => `@${seat} ${n}`)
                .join(" · ")}`,
            ``,
            `### Transcript`,
            ``
        );
        for (const m of run.transcript) {
            const who =
                m.kind === "system" ? "_system_" : `**${m.author.displayName}** (@${m.author.id})`;
            report.push(`${who}: ${m.text.replace(/\n/g, "\n> ")}`, ``);
        }
    }

    const chatFailures = checks.filter(c => !c.ok).length;
    const meetingFailures = runs.filter(r => r.problems.length > 0).length;
    report.push(
        `## Verdict`,
        ``,
        `${SKIP_CHAT ? "Chat prompts skipped" : `${checks.length - chatFailures}/${checks.length} chat prompts passed`}; ${runs.length - meetingFailures}/${runs.length} meetings passed. Total ${((Date.now() - started) / 1000 / 60).toFixed(1)} min.`
    );

    mkdirSync(join(process.cwd(), "scripts", "out"), { recursive: true });
    const out = join(process.cwd(), "scripts", "out", "battle-test-agents.md");
    writeFileSync(out, report.join("\n"));
    writeFileSync(
        out.replace(/\.md$/, ".json"),
        JSON.stringify(
            {
                model: MODEL,
                reasoning: MEETING_REASONING,
                maxTokens: MEETING_MAX_TOKENS,
                meetings: runs.map(({ transcript: _transcript, ...run }) => run),
            },
            null,
            2
        )
    );
    console.log(`\nreport: ${out}`);
    process.exit(chatFailures + meetingFailures === 0 ? 0 : 1);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
