/**
 * End-to-end persistence probe for the agent harness, against a throwaway
 * database: migrations applied, starters seeded, a phased meeting created
 * and reloaded (the phase cursor is recomputed from the row), a chat session
 * stored with its agent. No model calls.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/<db> \
 *   SKIP_ENV_VALIDATION=true pnpm exec tsx scripts/probe-agent-harness.ts
 */

import { db } from "~/server/db";
import { company } from "@launchstack/store/schema";
import { ensureStarterPersonas, getPersonaByKey, updatePersona } from "~/server/collab/personas";
import {
    createMeetingForCompany,
    getMeetingRuntime,
    listMeetingsForCompany,
} from "~/server/collab/runtime";
import { createSession, getSession, appendMessages } from "~/server/sessions/repository";
import { meetingWorkflow, phasesForRoom } from "~/lib/agents/meeting-workflows";
import { resolveChatAgent } from "~/server/collab/chat-agent";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
    const [row] = await db
        .insert(company)
        .values({ name: "Probe Co", numberOfEmployees: "3" } as never)
        .returning({ id: company.id });
    const companyId = BigInt(String(row!.id));
    console.log("company", companyId);

    const roster = await ensureStarterPersonas(companyId);
    assert(roster.length === 10, `expected 10 starters, got ${roster.length}`);
    assert(
        roster.every(p => p.builtin),
        "starters are marked builtin"
    );
    const finance = roster.find(p => p.id === "finance")!;
    assert(
        finance.tools === null && finance.style === "organized",
        "finance carries harness fields"
    );
    const again = await ensureStarterPersonas(companyId);
    assert(again.length === 10, "seeding is idempotent");

    await updatePersona(companyId, finance.dbId, {
        tools: ["retrieval", "reasoning", "attachments"],
        mode: "subagent",
    });
    const edited = await getPersonaByKey(companyId, "finance");
    assert(
        edited?.tools !== null && !edited?.tools?.includes("web") && edited?.mode === "subagent",
        "tools and mode persist"
    );
    await expectReject(
        () =>
            resolveChatAgent(companyId, "finance", {
                webSearch: true,
                thinking: false,
                hasAttachments: false,
            }),
        400
    );
    const summoned = await resolveChatAgent(companyId, "finance", {
        webSearch: true,
        thinking: false,
        hasAttachments: false,
        mentioned: true,
    });
    assert(summoned?.turn.webSearch === false, "policy applied on resolve");

    const workflow = meetingWorkflow("decision-review")!;
    const seats = workflow.agents;
    const created = await createMeetingForCompany({
        companyId,
        createdByUserId: "probe",
        title: "Probe decision",
        objective: "Decide something",
        agenda: workflow.agenda,
        participants: roster
            .filter(p => seats.includes(p.id))
            .map(p => ({
                id: p.id,
                displayName: p.displayName,
                role: p.role,
                systemPrompt: p.systemPrompt,
            })),
        turnPolicy: { kind: "moderated", moderatorId: "facilitator" },
        maxTurns: 10,
        phases: phasesForRoom(workflow, seats),
        workflowKey: workflow.key,
    });
    assert(created.config.phases?.length === 4, "phases stored on the meeting");
    assert(created.config.workflowKey === "decision-review", "workflow key stored");
    await created.orchestrator.start();
    const state = created.orchestrator.getState();
    assert(
        state.status === "running" && state.phaseIndex === 0,
        `started in phase 0, got ${JSON.stringify(state)}`
    );
    assert(
        state.nextSpeakerId === "facilitator",
        `frame phase opens with the chair, got ${state.nextSpeakerId}`
    );
    // Let the persist listener flush, then reload from the row.
    await new Promise(resolve => setTimeout(resolve, 300));
    const listed = await listMeetingsForCompany(companyId);
    assert(
        listed[0]?.phases?.length === 4 && listed[0].workflowKey === "decision-review",
        "row carries the plan"
    );
    const reloaded = await getMeetingRuntime(created.row.id, companyId);
    assert(reloaded?.config.phases?.length === 4, "reload rebuilds phases");

    const session = await createSession(
        { companyId, userId: "probe" },
        {
            messages: [
                { role: "user", text: "hi", agentKey: "analyst" },
                { role: "assistant", text: "hello", agentKey: "analyst" },
            ],
            agentKey: "analyst",
        }
    );
    assert(session.agentKey === "analyst", "session stores its agent");
    await appendMessages({ companyId, userId: "probe" }, session.id, {
        messages: [
            { role: "user", text: "@critic?", agentKey: "critic" },
            { role: "assistant", text: "attack", agentKey: "critic" },
        ],
        agentKey: null,
    });
    const stored = await getSession({ companyId, userId: "probe" }, session.id);
    assert(stored?.agentKey === null, "append can clear the session agent");
    assert(
        stored.messages.map(m => m.agentKey).join(",") === "analyst,analyst,critic,critic",
        "turn agents persist"
    );

    console.log("PROBE OK");
    process.exit(0);
}

async function expectReject(fn: () => Promise<unknown>, status: number) {
    try {
        await fn();
    } catch (err) {
        assert(
            (err as { status?: number }).status === status,
            `expected ${status}, got ${(err as Error).message}`
        );
        return;
    }
    throw new Error(`expected a ${status}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
