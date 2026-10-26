/**
 * Runs → the wire contract in `~/lib/scenarios/types`. The only place a
 * world's internals are read for the UI, and the place shared runs are
 * redacted: a reader who isn't the creator sees evidence drawn from files
 * they can't open as "a file you don't have access to" (ADR-014). What the
 * simulated people wrote stays — the creator chose to share the run, as with
 * a shared chat whose citations are filtered on read.
 *
 * With the reader's locale, the few sentences the server composes for these
 * screens — an evidence item's label, "Someone who has left", the run's own
 * failure sentences — are in their language. The stored records stay
 * English (the labels also reach the model's prompts), and so does every
 * response made without a locale.
 */
import {
    roundsDone,
    stageOf,
    type ScenarioRunRecord,
    type StoredEvidence,
} from "@launchstack/pipelines/scenarios";
import type { RunListRow } from "@launchstack/pipelines/scenarios/db";
import { author, findAgent, followeesOf, followersOf, type World } from "@launchstack/simulation";

import type { Locale } from "~/i18n/locales";
import { translatorFor, wordEnglish } from "~/i18n/translate";
import type {
    PostTestResult,
    ScenarioDetail,
    ScenarioInjection,
    ScenarioPerson,
    ScenarioPost,
    ScenarioSource,
    ScenarioSummary,
    Stance,
} from "~/lib/scenarios/types";

export const LEFT_WORKSPACE = "Someone who has left";

/** `LEFT_WORKSPACE` in `locale`. */
export function leftWorkspaceName(locale: Locale = "en"): string {
    return locale === "en"
        ? LEFT_WORKSPACE
        : translatorFor(locale, "scenarios.server")("leftWorkspace");
}

/** Where each evidence kind's composed labels live in `scenarios.server.sourceLabels`. */
const LABEL_TREE: Record<ScenarioSource["kind"], string> = {
    document: "document",
    search: "search",
    prospect: "prospect",
    brand_comment: "brandComment",
    company_profile: "companyProfile",
    notes: "notes",
};

/**
 * An evidence label in `locale`: the parts the server composed ("Pasted
 * material", "Prospect: …", "…, page 3"), with the names inside them as
 * they are. A document's own title stays as it is.
 */
export function sourceLabel(
    kind: ScenarioSource["kind"],
    label: string,
    locale: Locale = "en"
): string {
    if (locale === "en") return label;
    return wordEnglish(label, `scenarios.server.sourceLabels.${LABEL_TREE[kind]}`, locale);
}

/** A run's failure in `locale` when it is one of the run's own sentences; a provider's stays as it came. */
export function runErrorText(error: string | null, locale: Locale = "en"): string | null {
    if (!error || locale === "en") return error;
    return wordEnglish(error, "scenarios.server.runErrors", locale);
}

type SummaryInput = Pick<
    RunListRow,
    | "id"
    | "kind"
    | "title"
    | "subject"
    | "status"
    | "step"
    | "agentCount"
    | "roundCount"
    | "createdByUserId"
    | "sharedAt"
    | "createdAt"
    | "finishedAt"
    | "headline"
>;

export function toSummary(
    run: SummaryInput,
    viewerUserId: string,
    names: Map<string, string>
): ScenarioSummary {
    return {
        id: run.id,
        kind: run.kind,
        title: run.title,
        subject: run.subject,
        status: run.status,
        stage: stageOf(run),
        round: roundsDone(run),
        rounds: run.roundCount,
        agents: run.agentCount,
        createdAt: run.createdAt.toISOString(),
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        createdByMe: run.createdByUserId === viewerUserId,
        createdByName: names.get(run.createdByUserId) ?? LEFT_WORKSPACE,
        shared: run.sharedAt !== null,
        headline: run.headline,
    };
}

export function recordSummary(
    run: ScenarioRunRecord,
    viewerUserId: string,
    names: Map<string, string>
): ScenarioSummary {
    return toSummary({ ...run, headline: run.report?.headline ?? null }, viewerUserId, names);
}

/** Whether a reader may see this evidence item's label and text. */
export function evidenceVisible(
    item: StoredEvidence,
    isCreator: boolean,
    visibleDocIds: ReadonlySet<number>
): boolean {
    if (isCreator) return true;
    if (item.documentIds.length === 0) return true;
    return item.documentIds.some(id => visibleDocIds.has(id));
}

export function toSources(
    evidence: StoredEvidence[],
    isCreator: boolean,
    visibleDocIds: ReadonlySet<number>,
    locale: Locale = "en"
): ScenarioSource[] {
    return evidence.map(item => {
        const visible = evidenceVisible(item, isCreator, visibleDocIds);
        return {
            id: item.id,
            kind: item.kind,
            // A redacted label is the client's to word (`redacted` says which).
            label: visible
                ? sourceLabel(item.kind, item.label, locale)
                : "A file you don't have access to",
            excerpt: visible ? item.text : null,
            href: visible ? item.href : null,
            redacted: !visible,
        };
    });
}

function authorKind(world: World, id: string): ScenarioPost["authorKind"] {
    if (id === "narrator") return "narrator";
    if (id === "brand") return "brand";
    return findAgent(world, id) ? "agent" : "narrator";
}

export function toPosts(world: World): ScenarioPost[] {
    const commentsByPost = new Map<string, ScenarioPost["comments"]>();
    for (const c of world.comments) {
        const who = author(world, c.authorId);
        const list = commentsByPost.get(c.postId) ?? [];
        list.push({
            id: c.id,
            authorId: c.authorId,
            authorName: who.name,
            authorHandle: who.handle,
            round: c.round,
            text: c.text,
        });
        commentsByPost.set(c.postId, list);
    }
    return world.posts.map(p => {
        const who = author(world, p.authorId);
        const root = p.rootId ? world.posts.find(x => x.id === p.rootId) : undefined;
        return {
            id: p.id,
            authorId: p.authorId,
            authorName: who.name,
            authorHandle: who.handle,
            authorKind: authorKind(world, p.authorId),
            round: p.round,
            kind: p.kind,
            text: p.text,
            root: root
                ? {
                      id: root.id,
                      authorHandle: author(world, root.authorId).handle,
                      text: root.text,
                  }
                : null,
            likes: p.likes,
            dislikes: p.dislikes,
            shares: p.shares,
            comments: commentsByPost.get(p.id) ?? [],
        };
    });
}

export function toPeople(world: World): ScenarioPerson[] {
    return world.agents.map(a => {
        const id = a.persona.id;
        return {
            id,
            name: a.persona.name,
            handle: a.persona.handle,
            role: a.persona.role,
            bio: a.persona.bio,
            interests: a.persona.interests,
            grounding: a.persona.grounding,
            sources: a.persona.sourceIds,
            startStance: (a.stanceHistory[0] ?? a.stance) as Stance,
            stance: a.stance as Stance,
            stanceHistory: a.stanceHistory as Stance[],
            activity: a.persona.activity,
            followers: followersOf(world, id).length,
            following: followeesOf(world, id).length,
            posts: world.posts.filter(p => p.authorId === id && p.kind !== "repost").length,
            comments: world.comments.filter(c => c.authorId === id).length,
            lastThought: a.lastThought ?? null,
            currentSolution: a.persona.currentSolution ?? null,
            budget: a.persona.budget ?? null,
            buyingRole: a.persona.buyingRole ?? null,
            switchingCost: a.persona.switchingCost ?? null,
            firstObjection: a.persona.objection ?? null,
            wouldPay: a.wouldPay ?? null,
            objection: a.objection ?? null,
        };
    });
}

export interface DetailContext {
    viewerUserId: string;
    names: Map<string, string>;
    /** Files the viewer may read among those the evidence cites. */
    visibleDocIds: ReadonlySet<number>;
    injections: ScenarioInjection[];
    /** The reader's language, for the labels and errors the server composed. English when absent. */
    locale?: Locale;
}

export function toDetail(run: ScenarioRunRecord, ctx: DetailContext): ScenarioDetail {
    const isCreator = run.createdByUserId === ctx.viewerUserId;
    const world = run.world;
    return {
        ...recordSummary(run, ctx.viewerUserId, ctx.names),
        brief: run.brief && run.brief.brief.length > 0 ? run.brief.brief : null,
        sourcesUsed: run.sources,
        sources: toSources(run.evidence ?? [], isCreator, ctx.visibleDocIds, ctx.locale),
        people: world ? toPeople(world) : [],
        posts: world ? toPosts(world) : [],
        roundStats: (world?.rounds ?? []).map(r => ({
            round: r.round,
            active: r.active,
            posts: r.posts,
            comments: r.comments,
            likes: r.likes,
            dislikes: r.dislikes,
            shares: r.shares,
            follows: r.follows,
            meanStance: r.meanStance,
            stanceCounts: r.stanceCounts,
        })),
        report: run.report,
        reception: run.reception
            ? {
                  postId: run.reception.postId,
                  exposed: run.reception.exposed,
                  engaged: run.reception.engaged,
                  engagementRate: run.reception.engagementRate,
                  likes: run.reception.likes,
                  dislikes: run.reception.dislikes,
                  comments: run.reception.comments,
                  shares: run.reception.shares,
                  startingSentiment: run.reception.startingSentiment,
                  sentiment: run.reception.sentiment,
              }
            : null,
        injections: ctx.injections,
        eventsOpen:
            (run.status === "queued" || run.status === "running") &&
            !run.eventsClosedAt &&
            run.step < 2 + run.roundCount,
        error: runErrorText(run.error, ctx.locale),
        estimate: { calls: run.estimate.calls, credits: run.estimate.credits },
        usage: { calls: run.usage.calls, credits: run.usage.credits },
        canManage: isCreator,
        draft: run.draft ? { text: run.draft.text, networks: run.draft.networks } : null,
    };
}

export function toPostTest(run: ScenarioRunRecord, locale: Locale = "en"): PostTestResult {
    const world = run.world;
    const sampleComments =
        world && run.reception
            ? world.comments
                  .filter(c => c.postId === run.reception!.postId)
                  .slice(0, 5)
                  .map(c => {
                      const agent = findAgent(world, c.authorId);
                      return {
                          name: agent?.persona.name ?? author(world, c.authorId).name,
                          handle: agent?.persona.handle ?? author(world, c.authorId).handle,
                          role: agent?.persona.role ?? "",
                          text: c.text,
                          stance: (agent?.stance ?? 0) as Stance,
                      };
                  })
            : [];
    return {
        runId: run.id,
        status: run.status,
        stage: stageOf(run),
        round: roundsDone(run),
        rounds: run.roundCount,
        text: run.draft?.text ?? "",
        reception: run.reception
            ? {
                  postId: run.reception.postId,
                  exposed: run.reception.exposed,
                  engaged: run.reception.engaged,
                  engagementRate: run.reception.engagementRate,
                  likes: run.reception.likes,
                  dislikes: run.reception.dislikes,
                  comments: run.reception.comments,
                  shares: run.reception.shares,
                  startingSentiment: run.reception.startingSentiment,
                  sentiment: run.reception.sentiment,
              }
            : null,
        headline: run.report?.headline ?? null,
        sampleComments,
        error: runErrorText(run.error, locale),
    };
}
