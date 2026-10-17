/**
 * Scenarios, as the API routes use them. Access rules:
 *
 * - Running a scenario takes `documents.read` (the same gate as Ask; both
 *   spend credits). Testing a Brand post takes `social.publish`, like
 *   composing it.
 * - A run is private to its creator until they share it with the whole
 *   workspace. Anyone else gets 404 for a private run. Only the creator
 *   cancels, adds events, renames, shares or deletes.
 * - Interviews are private to whoever asked.
 * - The Brand track record shows every linked post test's numbers to any
 *   member, like the rest of Brand's numbers; it carries no evidence.
 */
import { randomInt } from "node:crypto";

import { and, asc, count, eq, isNotNull } from "drizzle-orm";

import {
    buildTrackRecord,
    hashDraft,
    stageOf,
    unitCount,
    createLlmSimulationModel,
    type ScenarioRunRecord,
    type ScenarioSourcesInput,
} from "@launchstack/pipelines/scenarios";
import {
    addInjection,
    addInterview,
    createScenarioRun,
    createScenarioStore,
    deleteRun,
    getCompanyRun,
    linkPostTest,
    listInjections,
    listInterviews,
    listVisibleRuns,
    requestCancel,
    updateRunMeta,
} from "@launchstack/pipelines/scenarios/db";
import { partnerRelationships } from "@launchstack/pipelines/schema";
import {
    buildAnalystRequest,
    buildInterviewRequest,
    cleanAnswer,
    estimateRun,
    findAgent,
    MAX_AGENTS,
    MAX_ROUNDS,
} from "@launchstack/simulation";
import { document } from "@launchstack/store/schema";
import { llmChatTokens } from "@launchstack/store/credits";

import { scopedDocumentWhere } from "~/lib/authz/scope";
import { debitTokens, getBalance } from "~/lib/credits";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    SCENARIO_LIMITS,
    type CreatePostTestInput,
    type CreateScenarioInput,
    type PostTestLink,
    type PostTestResult,
    type ScenarioDetail,
    type ScenarioEstimate,
    type ScenarioInjection,
    type ScenarioInterview,
    type ScenarioSourceOptions,
    type ScenarioSummary,
    type TrackRecord,
} from "~/lib/scenarios/types";
import { db } from "~/server/db";
import { brandComments, companyMetadata } from "~/server/db/schema";
import { isMeteringEnforced } from "~/server/deployment";
import { workspaceLooks } from "~/server/profile/store";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { brandIdentity, visibleDocumentIds } from "./evidence";
import { listLinkedPostTests } from "./track-record";
import { dispatchRun, readScenariosExecutor, resumeIfStalled } from "./executor";
import { LEFT_WORKSPACE, recordSummary, toDetail, toPostTest, toSummary } from "./views";

export class ScenarioError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
        readonly extra: Record<string, unknown> = {}
    ) {
        super(message);
        this.name = "ScenarioError";
    }
}

const notFound = () => new ScenarioError("Scenario not found", 404, "not_found");
const notCreator = () =>
    new ScenarioError("Only the person who started this run can do that.", 403, "forbidden");

type Ctx = Pick<WorkspaceContext, "authUserId" | "companyId" | "can" | "documentScope">;

async function namesFor(companyId: bigint, ids: Iterable<string>): Promise<Map<string, string>> {
    const looks = await workspaceLooks(companyId, ids);
    const out = new Map<string, string>();
    for (const [id, look] of looks) out.set(id, look.member ? look.displayName : LEFT_WORKSPACE);
    return out;
}

/** The run if the viewer may read it: their own, or shared with the workspace. */
async function readableRun(ctx: Ctx, id: number): Promise<ScenarioRunRecord> {
    const run = await getCompanyRun(ctx.companyId, id);
    if (!run) throw notFound();
    if (run.createdByUserId !== ctx.authUserId && !run.sharedAt) throw notFound();
    return run;
}

async function ownRun(ctx: Ctx, id: number): Promise<ScenarioRunRecord> {
    const run = await readableRun(ctx, id);
    if (run.createdByUserId !== ctx.authUserId) throw notCreator();
    return run;
}

function requireRead(ctx: Ctx): void {
    if (!ctx.can("documents.read")) {
        throw new ScenarioError(
            "Your role can't run scenarios in this workspace.",
            403,
            "forbidden"
        );
    }
}

// ─── Estimate and create ─────────────────────────────────────────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.max(min, Math.min(max, n));
}

export function creditsForEstimate(
    agents: number,
    rounds: number
): { calls: number; credits: number } {
    const e = estimateRun({ agents, rounds });
    return { calls: e.calls, credits: llmChatTokens(e.inputTokens, e.outputTokens) };
}

export async function estimateScenario(
    ctx: Ctx,
    agentsRaw: unknown,
    roundsRaw: unknown
): Promise<ScenarioEstimate> {
    const agents = clampInt(
        agentsRaw,
        SCENARIO_LIMITS.agents.min,
        MAX_AGENTS,
        SCENARIO_LIMITS.agents.default
    );
    const rounds = clampInt(
        roundsRaw,
        SCENARIO_LIMITS.rounds.min,
        MAX_ROUNDS,
        SCENARIO_LIMITS.rounds.default
    );
    const { calls, credits } = creditsForEstimate(agents, rounds);
    const enforced = isMeteringEnforced();
    const balance = enforced ? await getBalance(ctx.companyId) : null;
    return {
        agents,
        rounds,
        calls,
        credits,
        balance,
        enough: !enforced || (balance ?? 0) >= credits,
    };
}

async function requireCredits(ctx: Ctx, credits: number): Promise<void> {
    if (!isMeteringEnforced()) return;
    const balance = await getBalance(ctx.companyId);
    if (balance < credits) {
        throw new ScenarioError(
            "Not enough credits to start this run.",
            402,
            "insufficient_credits",
            { required: credits }
        );
    }
}

function cleanSources(raw: Partial<ScenarioSourcesInput> | undefined): ScenarioSourcesInput {
    const ids: unknown[] = Array.isArray(raw?.documentIds) ? raw.documentIds : [];
    return {
        documentIds: [
            ...new Set(
                ids.filter(
                    (id): id is number =>
                        typeof id === "number" && Number.isSafeInteger(id) && id > 0
                )
            ),
        ],
        searchFiles: raw?.searchFiles === true,
        prospects: raw?.prospects === true,
        brandComments: raw?.brandComments === true,
        companyProfile: raw?.companyProfile === true,
        notes: typeof raw?.notes === "string" ? raw.notes.trim() : "",
    };
}

export async function createScenario(
    ctx: Ctx,
    input: Partial<CreateScenarioInput>
): Promise<ScenarioSummary> {
    requireRead(ctx);
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    if (!subject) throw new ScenarioError("Describe the situation to simulate.", 400, "invalid");
    if (subject.length > SCENARIO_LIMITS.subjectMax) {
        throw new ScenarioError(
            `Keep the situation under ${SCENARIO_LIMITS.subjectMax} characters.`,
            400,
            "invalid"
        );
    }
    const sources = cleanSources(input.sources);
    if (sources.documentIds.length > SCENARIO_LIMITS.documentsMax) {
        throw new ScenarioError(
            `Pick at most ${SCENARIO_LIMITS.documentsMax} files.`,
            400,
            "invalid"
        );
    }
    if (sources.notes.length > SCENARIO_LIMITS.notesMax) {
        throw new ScenarioError(
            `Keep pasted material under ${SCENARIO_LIMITS.notesMax} characters.`,
            400,
            "invalid"
        );
    }
    // Files the creator can't open are dropped here and again when evidence is gathered.
    const visible = await visibleDocumentIds(
        ctx.companyId,
        await ctx.documentScope(),
        sources.documentIds
    );
    sources.documentIds = sources.documentIds.filter(id => visible.has(id));

    const agents = clampInt(
        input.agents,
        SCENARIO_LIMITS.agents.min,
        MAX_AGENTS,
        SCENARIO_LIMITS.agents.default
    );
    const rounds = clampInt(
        input.rounds,
        SCENARIO_LIMITS.rounds.min,
        MAX_ROUNDS,
        SCENARIO_LIMITS.rounds.default
    );
    const estimate = estimateRun({ agents, rounds });
    const credits = llmChatTokens(estimate.inputTokens, estimate.outputTokens);
    await requireCredits(ctx, credits);

    const titleRaw = typeof input.title === "string" ? input.title.trim() : "";
    const title = (titleRaw || subject).slice(0, 120);
    const run = await createScenarioRun({
        companyId: ctx.companyId,
        createdByUserId: ctx.authUserId,
        kind: "scenario",
        title,
        subject,
        agentCount: agents,
        roundCount: rounds,
        seed: randomInt(1, 2 ** 31 - 1),
        sources,
        estimate: {
            calls: estimate.calls,
            inputTokens: estimate.inputTokens,
            outputTokens: estimate.outputTokens,
            credits,
        },
    });
    await dispatchRun(run);
    return recordSummary(run, ctx.authUserId, await namesFor(ctx.companyId, [run.createdByUserId]));
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function listScenarios(ctx: Ctx): Promise<ScenarioSummary[]> {
    const rows = await listVisibleRuns({
        companyId: ctx.companyId,
        viewerUserId: ctx.authUserId,
        kind: "scenario",
    });
    const names = await namesFor(
        ctx.companyId,
        rows.map(r => r.createdByUserId)
    );
    return rows.map(r => toSummary(r, ctx.authUserId, names));
}

export async function scenarioSourceOptions(ctx: Ctx): Promise<ScenarioSourceOptions> {
    const scope = await ctx.documentScope();
    const [docs, [prospects], [comments], [profile]] = await Promise.all([
        db
            .select({ id: document.id, title: document.title, folder: document.category })
            .from(document)
            .where(scopedDocumentWhere(ctx.companyId, scope))
            .orderBy(asc(document.title))
            .limit(500),
        db
            .select({ n: count() })
            .from(partnerRelationships)
            .where(eq(partnerRelationships.companyId, ctx.companyId)),
        db
            .select({ n: count() })
            .from(brandComments)
            .where(and(eq(brandComments.companyId, ctx.companyId), eq(brandComments.isOwn, false))),
        db
            .select({ n: count() })
            .from(companyMetadata)
            .where(
                and(
                    eq(companyMetadata.companyId, ctx.companyId),
                    isNotNull(companyMetadata.metadata)
                )
            ),
    ]);
    return {
        documents: docs.map(d => ({ id: Number(d.id), title: d.title, folder: d.folder || null })),
        prospects: prospects?.n ?? 0,
        brandComments: comments?.n ?? 0,
        companyProfile: (profile?.n ?? 0) > 0,
    };
}

function toInjection(row: {
    id: number;
    text: string;
    appliedRound: number | null;
    createdAt: Date;
}): ScenarioInjection {
    return {
        id: row.id,
        text: row.text,
        round: row.appliedRound,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function getScenarioDetail(ctx: Ctx, id: number): Promise<ScenarioDetail> {
    const run = await readableRun(ctx, id);
    resumeIfStalled(run);
    const isCreator = run.createdByUserId === ctx.authUserId;
    const cited = (run.evidence ?? []).flatMap(e => e.documentIds);
    const visibleDocIds = isCreator
        ? new Set<number>()
        : await visibleDocumentIds(ctx.companyId, await ctx.documentScope(), cited);
    const [injections, names] = await Promise.all([
        listInjections(run.id),
        namesFor(ctx.companyId, [run.createdByUserId]),
    ]);
    return toDetail(run, {
        viewerUserId: ctx.authUserId,
        names,
        visibleDocIds,
        injections: injections.map(toInjection),
    });
}

// ─── Manage ──────────────────────────────────────────────────────────────────

export async function updateScenario(
    ctx: Ctx,
    id: number,
    patch: { title?: unknown; shared?: unknown }
): Promise<ScenarioSummary> {
    await ownRun(ctx, id);
    const title = typeof patch.title === "string" ? patch.title.trim().slice(0, 120) : undefined;
    if (title !== undefined && !title)
        throw new ScenarioError("A title can't be empty.", 400, "invalid");
    const shared = typeof patch.shared === "boolean" ? patch.shared : undefined;
    await updateRunMeta(ctx.companyId, id, { title, shared }, new Date());
    const run = (await getCompanyRun(ctx.companyId, id))!;
    return recordSummary(run, ctx.authUserId, await namesFor(ctx.companyId, [run.createdByUserId]));
}

export async function deleteScenario(ctx: Ctx, id: number): Promise<void> {
    await ownRun(ctx, id);
    await deleteRun(ctx.companyId, id);
}

export async function cancelScenario(ctx: Ctx, id: number): Promise<ScenarioSummary> {
    const run = await ownRun(ctx, id);
    if (run.status === "queued" || run.status === "running") {
        const now = new Date();
        await requestCancel(ctx.companyId, id, now);
        // No live in-process executor: nothing will look at the flag, so stop it here.
        const held = run.leaseUntil && run.leaseUntil.getTime() > now.getTime();
        if (!held && readScenariosExecutor() === "inline") {
            await createScenarioStore().finish(id, "cancelled", null, now);
        }
    }
    const fresh = (await getCompanyRun(ctx.companyId, id))!;
    return recordSummary(
        fresh,
        ctx.authUserId,
        await namesFor(ctx.companyId, [fresh.createdByUserId])
    );
}

export async function addScenarioEvent(
    ctx: Ctx,
    id: number,
    textRaw: unknown
): Promise<ScenarioInjection> {
    const run = await ownRun(ctx, id);
    if (run.status !== "running" && run.status !== "queued") {
        throw new ScenarioError(
            "Events can only be added while the run is going.",
            409,
            "not_running"
        );
    }
    if (run.step >= 2 + run.roundCount) {
        throw new ScenarioError(
            "The last round has finished; this event would never appear.",
            409,
            "not_running"
        );
    }
    const text = typeof textRaw === "string" ? textRaw.trim() : "";
    if (!text) throw new ScenarioError("Describe the event.", 400, "invalid");
    if (text.length > SCENARIO_LIMITS.eventMax) {
        throw new ScenarioError(
            `Keep events under ${SCENARIO_LIMITS.eventMax} characters.`,
            400,
            "invalid"
        );
    }
    const row = await addInjection({
        companyId: ctx.companyId,
        runId: id,
        createdByUserId: ctx.authUserId,
        text,
    });
    return toInjection(row);
}

// ─── Interviews ──────────────────────────────────────────────────────────────

function toInterview(row: {
    id: number;
    agentId: string;
    question: string;
    answer: string;
    createdAt: Date;
}): ScenarioInterview {
    return {
        id: row.id,
        agentId: row.agentId,
        question: row.question,
        answer: row.answer,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function listScenarioInterviews(ctx: Ctx, id: number): Promise<ScenarioInterview[]> {
    await readableRun(ctx, id);
    return (await listInterviews(id, ctx.authUserId)).map(toInterview);
}

export async function askScenario(
    ctx: Ctx,
    id: number,
    agentIdRaw: unknown,
    questionRaw: unknown
): Promise<ScenarioInterview> {
    requireRead(ctx);
    const run = await readableRun(ctx, id);
    const world = run.world;
    if (!world || world.round < 1) {
        throw new ScenarioError(
            "Interviews open once the first round has finished.",
            409,
            "not_ready"
        );
    }
    const agentId = typeof agentIdRaw === "string" ? agentIdRaw : "";
    if (agentId !== "analyst" && !findAgent(world, agentId))
        throw new ScenarioError("No such person in this run.", 400, "invalid");
    const question = typeof questionRaw === "string" ? questionRaw.trim() : "";
    if (!question) throw new ScenarioError("Ask a question.", 400, "invalid");
    if (question.length > SCENARIO_LIMITS.questionMax) {
        throw new ScenarioError(
            `Keep questions under ${SCENARIO_LIMITS.questionMax} characters.`,
            400,
            "invalid"
        );
    }
    const history = (await listInterviews(id, ctx.authUserId))
        .filter(r => r.agentId === agentId)
        .slice(-4)
        .map(r => ({ question: r.question, answer: r.answer }));
    const request =
        agentId === "analyst"
            ? buildAnalystRequest(world, run.report?.summary ?? "", question, history)
            : buildInterviewRequest(world, agentId, question, history);
    await requireCredits(ctx, 4_000);
    const reply = await withWorkspaceChatModels(ctx.companyId, () =>
        createLlmSimulationModel().complete(request)
    );
    const credits = llmChatTokens(reply.usage?.inputTokens ?? 0, reply.usage?.outputTokens ?? 0);
    if (credits > 0) {
        await debitTokens({
            companyId: ctx.companyId,
            amount: credits,
            service: "scenario_simulation",
            description: `Scenario "${run.title}": interview`,
            referenceId: `scenario:${run.id}`,
        });
    }
    const answer = cleanAnswer(reply.text);
    if (!answer) throw new ScenarioError("No answer came back; try again.", 502, "empty_answer");
    const row = await addInterview({
        companyId: ctx.companyId,
        runId: id,
        askedByUserId: ctx.authUserId,
        agentId,
        question,
        answer,
    });
    return toInterview(row);
}

// ─── Brand post tests ────────────────────────────────────────────────────────

const NETWORKS = new Set([
    "linkedin",
    "bluesky",
    "x",
    "reddit",
    "instagram",
    "facebook",
    "threads",
]);

export async function createPostTest(
    ctx: Ctx,
    input: Partial<CreatePostTestInput>
): Promise<PostTestResult> {
    if (!ctx.can("social.publish")) {
        throw new ScenarioError("Your role can read Brand but not test posts.", 403, "forbidden");
    }
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) throw new ScenarioError("Write the post first.", 400, "invalid");
    if (text.length > 3000)
        throw new ScenarioError("Posts over 3,000 characters can't be tested.", 400, "invalid");
    const networks = (Array.isArray(input.networks) ? input.networks : [])
        .filter((n): n is string => typeof n === "string")
        .map(n => n.toLowerCase())
        .filter(n => NETWORKS.has(n));
    const { agents, rounds } = SCENARIO_LIMITS.postTest;
    const estimate = estimateRun({ agents, rounds });
    const credits = llmChatTokens(estimate.inputTokens, estimate.outputTokens);
    await requireCredits(ctx, credits);
    const brand = await brandIdentity(ctx.companyId);
    const run = await createScenarioRun({
        companyId: ctx.companyId,
        createdByUserId: ctx.authUserId,
        kind: "post_test",
        title: `Post test: ${text.slice(0, 80)}`,
        subject: `How people react to this post from ${brand.name}`,
        agentCount: agents,
        roundCount: rounds,
        seed: randomInt(1, 2 ** 31 - 1),
        sources: {
            documentIds: [],
            searchFiles: false,
            prospects: true,
            brandComments: true,
            companyProfile: true,
            notes: "",
        },
        estimate: {
            calls: estimate.calls,
            inputTokens: estimate.inputTokens,
            outputTokens: estimate.outputTokens,
            credits,
        },
        draft: { text, networks, brandName: brand.name, brandHandle: brand.handle },
        draftHash: hashDraft(text),
    });
    await dispatchRun(run);
    return toPostTest(run);
}

export async function getPostTest(ctx: Ctx, id: number): Promise<PostTestResult> {
    const run = await readableRun(ctx, id);
    if (run.kind !== "post_test") throw notFound();
    resumeIfStalled(run);
    return toPostTest(run);
}

export async function brandTrackRecord(ctx: Ctx): Promise<TrackRecord> {
    return buildTrackRecord(await listLinkedPostTests(ctx.companyId));
}

/**
 * Link a finished post test to the posts just composed from it — only when
 * the composed text is the text that was tested.
 */
export async function linkComposedPosts(
    ctx: { companyId: bigint; authUserId: string },
    postTestId: number,
    body: string,
    brandPostIds: string[]
): Promise<PostTestLink> {
    const run = await getCompanyRun(ctx.companyId, postTestId);
    if (!run || run.kind !== "post_test" || run.createdByUserId !== ctx.authUserId) {
        return { runId: postTestId, linked: false, stale: false };
    }
    const stale = hashDraft(body) !== run.draftHash;
    if (stale || run.status !== "done" || brandPostIds.length === 0) {
        return { runId: postTestId, linked: false, stale };
    }
    await linkPostTest(ctx.companyId, postTestId, brandPostIds);
    return { runId: postTestId, linked: true, stale: false };
}

/** For tests and the run view: whether a run still has units left. */
export function unitsLeft(run: Pick<ScenarioRunRecord, "status" | "step" | "roundCount">): number {
    return stageOf(run) === "done" ? 0 : Math.max(0, unitCount(run.roundCount) - run.step);
}
