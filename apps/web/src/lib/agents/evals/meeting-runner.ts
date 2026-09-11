/**
 * Runs the meeting eval scenarios and scores them.
 *
 * Each scenario is executed as a *real* meeting — same orchestrator, same turn
 * policies, same human-takeover path as production — with scripted utterances
 * standing in for model output. That keeps the suite deterministic while still
 * exercising everything between "start" and "minutes".
 */

import {
    createMeeting,
    evaluateMeeting,
    fixedClock,
    InMemoryChannelStore,
    ScriptedAgentRuntime,
    sequentialIdFactory,
    summarizeMeetingEvals,
    type MeetingEvalResult,
    type MeetingEvalSuiteReport,
} from "@launchstack/collab";

import { MEETING_EVAL_SCENARIOS, type MeetingEvalScenario } from "./meeting-scenarios";

export interface ScenarioOutcome {
    scenario: MeetingEvalScenario;
    result: MeetingEvalResult;
    /** Expectation violations. Empty means the scenario behaved as documented. */
    violations: string[];
}

export async function runMeetingScenario(scenario: MeetingEvalScenario): Promise<ScenarioOutcome> {
    const clock = fixedClock(1_700_000_000_000, 1_000);
    const store = new InMemoryChannelStore(clock, sequentialIdFactory());

    const { orchestrator, config } = await createMeeting({
        store,
        workspaceId: "eval",
        title: scenario.title,
        objective: scenario.objective,
        agenda: scenario.agenda,
        participants: scenario.participants,
        runtimes: [new ScriptedAgentRuntime(scenario.script)],
        turnPolicy: scenario.turnPolicy,
        maxTurns: scenario.maxTurns,
        context: scenario.context,
        clock,
        newId: sequentialIdFactory(),
    });

    await orchestrator.start();

    const takeover = scenario.humanTakeover;
    for (let turn = 0; turn < scenario.maxTurns; turn++) {
        if (takeover && orchestrator.getState().turnIndex === takeover.beforeTurn) {
            await orchestrator.takeOver({
                humanId: "eval-human",
                displayName: takeover.displayName,
                asPersonaId: takeover.asPersonaId,
            });
            await orchestrator.postHumanMessage({
                humanId: "eval-human",
                displayName: takeover.displayName,
                text: takeover.text,
            });
            // One blocked step, deliberately: a takeover that does not actually
            // stop the agents should show up as a handoff failure, not pass quietly.
            await orchestrator.step();
            await orchestrator.release();
        }
        const step = await orchestrator.step();
        if (step.done) break;
    }

    if (orchestrator.getState().status !== "completed") {
        await orchestrator.complete("eval run finished");
    }

    const transcript = await store.read(config.channelId);
    const result = evaluateMeeting(config, orchestrator.getState(), transcript);

    return { scenario, result, violations: checkExpectations(scenario, result) };
}

function checkExpectations(scenario: MeetingEvalScenario, result: MeetingEvalResult): string[] {
    const violations: string[] = [];
    const { expect: want } = scenario;

    if (want.shouldPass && !result.passed) {
        violations.push(
            `expected to pass, scored ${result.overall}${
                result.failures.length > 0 ? ` (failed: ${result.failures.join(", ")})` : ""
            }`
        );
    }
    if (!want.shouldPass && result.passed) {
        violations.push(`expected to fail, but passed with ${result.overall}`);
    }
    if (want.minScore !== undefined && result.overall < want.minScore) {
        violations.push(`overall ${result.overall} < ${want.minScore}`);
    }
    if (want.maxScore !== undefined && result.overall > want.maxScore) {
        violations.push(`overall ${result.overall} > ${want.maxScore}`);
    }

    const byId = new Map(result.dimensions.map(d => [d.id, d]));
    for (const [id, floor] of Object.entries(want.minDimension ?? {})) {
        const dimension = byId.get(id);
        if (!dimension) {
            violations.push(`missing dimension "${id}"`);
        } else if (dimension.score < floor) {
            violations.push(`${id} ${dimension.score.toFixed(2)} < ${floor}`);
        }
    }
    for (const [id, ceiling] of Object.entries(want.maxDimension ?? {})) {
        const dimension = byId.get(id);
        if (!dimension) {
            violations.push(`missing dimension "${id}"`);
        } else if (dimension.score > ceiling) {
            violations.push(`${id} ${dimension.score.toFixed(2)} > ${ceiling}`);
        }
    }

    return violations;
}

export interface MeetingEvalRun {
    outcomes: ScenarioOutcome[];
    report: MeetingEvalSuiteReport;
    /** Scenarios whose behaviour did not match their documented expectation. */
    violations: Array<{ scenarioId: string; problems: string[] }>;
    /** Mean score across the scenarios that are supposed to be good meetings. */
    positiveMeanScore: number;
    /** Mean score across the deliberately bad meetings. Should be well below. */
    negativeMeanScore: number;
}

export async function runMeetingEvals(
    scenarios: MeetingEvalScenario[] = MEETING_EVAL_SCENARIOS
): Promise<MeetingEvalRun> {
    const outcomes: ScenarioOutcome[] = [];
    for (const scenario of scenarios) {
        outcomes.push(await runMeetingScenario(scenario));
    }

    const mean = (values: number[]) =>
        values.length === 0
            ? 0
            : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000;

    return {
        outcomes,
        report: summarizeMeetingEvals(outcomes.map(o => o.result)),
        violations: outcomes
            .filter(o => o.violations.length > 0)
            .map(o => ({ scenarioId: o.scenario.id, problems: o.violations })),
        positiveMeanScore: mean(
            outcomes.filter(o => o.scenario.expect.shouldPass).map(o => o.result.overall)
        ),
        negativeMeanScore: mean(
            outcomes.filter(o => !o.scenario.expect.shouldPass).map(o => o.result.overall)
        ),
    };
}

/** Human-readable report for the CLI. */
export function formatMeetingEvalRun(run: MeetingEvalRun): string {
    const lines: string[] = [
        "Meeting evaluation",
        "==================",
        "",
        `Scenarios      ${run.report.total}`,
        `Behaved as documented  ${run.report.total - run.violations.length}/${run.report.total}`,
        `Mean score     ${run.report.meanScore}`,
        `  good meetings   ${run.positiveMeanScore}`,
        `  bad meetings    ${run.negativeMeanScore}`,
        `  separation      ${Math.round((run.positiveMeanScore - run.negativeMeanScore) * 1000) / 1000}`,
        "",
        "By dimension",
    ];

    for (const [id, score] of Object.entries(run.report.byDimension)) {
        lines.push(`  ${id.padEnd(16)} ${score.toFixed(3)}`);
    }

    lines.push("", "Scenarios");
    for (const outcome of run.outcomes) {
        const verdict = outcome.violations.length === 0 ? "ok" : "MISMATCH";
        lines.push(
            `  [${verdict}] ${outcome.scenario.id.padEnd(22)} score ${outcome.result.overall.toFixed(3)} ` +
                `${outcome.result.passed ? "pass" : "fail"} (expected ${outcome.scenario.expect.shouldPass ? "pass" : "fail"})`
        );
        for (const dimension of outcome.result.dimensions) {
            lines.push(
                `      ${dimension.id.padEnd(16)} ${dimension.score.toFixed(2)}  ${dimension.detail}`
            );
        }
        for (const problem of outcome.violations) {
            lines.push(`      ! ${problem}`);
        }
    }

    return lines.join("\n");
}
