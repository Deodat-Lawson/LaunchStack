/**
 * The report — OASIS/MiroFish's ReportAgent, reduced to one call over numbers
 * the engine computes itself. The model writes the words; every post it cites
 * must exist, and faction sizes come from the world, not from the model.
 */

import { asArray, asNumber, asRecord, asString, extractJson } from "./json";
import {
    engagementScore,
    factions,
    postReception,
    stanceShifts,
    topPosts,
    wouldPayCounts,
    type FactionKey,
    type PostReception,
} from "./metrics";
import { cleanProse, clip } from "./text";
import type { ModelRequest, World } from "./types";
import { author, findAgent, stanceLabel } from "./world";

export const REPORT_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        headline: { type: "string" },
        summary: { type: "string" },
        dynamics: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    text: { type: "string" },
                    postIds: { type: "array", items: { type: "string" } },
                },
                required: ["text", "postIds"],
            },
        },
        turningPoints: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    round: { type: "integer" },
                    text: { type: "string" },
                    postIds: { type: "array", items: { type: "string" } },
                },
                required: ["round", "text", "postIds"],
            },
        },
        factions: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    stance: { type: "string", enum: ["supportive", "neutral", "critical"] },
                    label: { type: "string" },
                    text: { type: "string" },
                },
                required: ["stance", "label", "text"],
            },
        },
        watchFor: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "summary", "dynamics", "turningPoints", "factions", "watchFor"],
};

export interface ScenarioReport {
    headline: string;
    summary: string;
    dynamics: Array<{ text: string; postIds: string[] }>;
    turningPoints: Array<{ round: number; text: string; postIds: string[] }>;
    factions: Array<{
        stance: FactionKey;
        label: string;
        text: string;
        share: number;
        agentIds: string[];
    }>;
    /** Signals worth watching for in reality. */
    watchFor: string[];
}

function postLine(world: World, id: string): string {
    const post = world.posts.find(p => p.id === id);
    if (!post) return "";
    const who = author(world, post.authorId);
    return `[${post.id}] round ${post.round} ${who.handle} (${post.kind}) · ${post.likes} likes · ${post.comments} comments · ${post.shares} shares: "${clip(post.text, 220)}"`;
}

export function buildReportRequest(
    world: World,
    options: { targetPostId?: string } = {}
): ModelRequest {
    const roundsTable = world.rounds
        .map(
            r =>
                `round ${r.round}: ${r.active} active, ${r.posts} posts, ${r.comments} comments, ${r.likes} likes, ${r.dislikes} dislikes, ${r.shares} shares, ${r.follows} follows; mean stance ${r.meanStance}; stance counts [-2..2] ${r.stanceCounts.join("/")}`
        )
        .join("\n");
    const top = topPosts(world, 12).map(p => postLine(world, p.id));
    const groups = factions(world);
    const factionLines = (Object.keys(groups) as FactionKey[]).map(key => {
        const ids = groups[key];
        const voices = ids
            .slice(0, 4)
            .map(id => findAgent(world, id))
            .filter(a => a?.lastThought)
            .map(a => `${a!.persona.handle} (${a!.persona.role}): "${clip(a!.lastThought!, 120)}"`);
        return `${key}: ${ids.length} of ${world.agents.length}${voices.length ? `\n  ${voices.join("\n  ")}` : ""}`;
    });
    const shifts = stanceShifts(world, 6).map(s => {
        const a = findAgent(world, s.agentId)!;
        return `${a.persona.handle} (${a.persona.role}): ${stanceLabel(s.from)} → ${stanceLabel(s.to)}`;
    });
    // Worlds from before turns were asked "would you pay?" have no answers; leave the block out.
    const [yes, maybe, no] = wouldPayCounts(world);
    const answered = yes + maybe + no;
    const objections = world.agents
        .filter(a => a.objection)
        .slice(0, 12)
        .map(a => `${a.persona.handle} (${a.persona.role}): "${clip(a.objection!, 120)}"`);
    const money =
        answered > 0
            ? [
                  "",
                  `Would pay at the end, of the ${answered} who answered: yes ${yes}, maybe ${maybe}, no ${no}.`,
                  ...(objections.length > 0
                      ? ["What still holds people back:", ...objections]
                      : []),
              ]
            : [];
    const events = world.posts
        .filter(p => p.kind === "event" || p.kind === "seed")
        .map(
            p =>
                `[${p.id}] round ${p.round} ${author(world, p.authorId).handle}: "${clip(p.text, 200)}"`
        );
    let reception = "";
    if (options.targetPostId) {
        const r = postReception(world, options.targetPostId);
        if (r) reception = receptionLine(r);
    }
    const system = [
        "You write the report on a finished social-network simulation for a founder team.",
        "This is a scenario, not a forecast: describe what happened among these simulated people and why, never what will happen in reality.",
        'Use only the data given. Cite posts by id in postIds (e.g. "p12"). Keep it concrete and short.',
        "headline: one sentence, at most 20 words. summary: at most 120 words.",
        "dynamics: three to five things that drove the conversation. turningPoints: up to four moments, by round.",
        "factions: one entry per group present (supportive, neutral, critical), with a short label and what they cared about.",
        "Liking the subject and paying for it are different: when the would-pay answers tell a different story from the stances, say so, and name what holds people back.",
        "watchFor: up to four signals the team could watch for in the real world to see whether this pattern is happening.",
        "Reply with JSON only.",
    ].join("\n");
    const prompt = [
        `Subject: ${world.subject}`,
        "",
        "Opening and injected posts:",
        events.join("\n") || "(none)",
        reception ? `\nPost under test: ${reception}` : "",
        "",
        "Rounds:",
        roundsTable,
        "",
        "Most engaged posts:",
        top.join("\n") || "(none)",
        "",
        "Factions at the end:",
        factionLines.join("\n"),
        ...money,
        "",
        "Biggest changes of mind:",
        shifts.join("\n") || "(nobody changed their mind)",
    ].join("\n");
    return { purpose: "report", system, prompt, schema: REPORT_SCHEMA, maxOutputTokens: 1800 };
}

export function receptionLine(r: PostReception): string {
    return `${r.postId}: seen by ${r.exposed}, engaged ${r.engaged} (${Math.round(r.engagementRate * 100)}%), ${r.likes} likes, ${r.dislikes} dislikes, ${r.comments} comments, ${r.shares} shares; sentiment ${r.startingSentiment} → ${r.sentiment}`;
}

export function parseReport(text: string, world: World): ScenarioReport | undefined {
    const root = asRecord(extractJson(text));
    if (!root) return undefined;
    const headline = clip(cleanProse(asString(root.headline) ?? ""), 200);
    const summary = clip(cleanProse(asString(root.summary) ?? ""), 1200);
    if (!headline || !summary) return undefined;
    const ids = new Set(world.posts.map(p => p.id));
    const postIds = (v: unknown) => [
        ...new Set(
            asArray(v)
                .map(x =>
                    asString(x)
                        ?.trim()
                        .replace(/^\[|\]$/g, "")
                )
                .filter((x): x is string => !!x && ids.has(x))
        ),
    ];
    const groups = factions(world);
    const total = Math.max(1, world.agents.length);
    const seenFactions = new Set<FactionKey>();
    const factionList: ScenarioReport["factions"] = [];
    for (const raw of asArray(root.factions)) {
        const item = asRecord(raw);
        const stance = asString(item?.stance) as FactionKey | undefined;
        if (!item || !stance || !(stance in groups) || seenFactions.has(stance)) continue;
        if (groups[stance].length === 0) continue;
        seenFactions.add(stance);
        factionList.push({
            stance,
            label: clip(cleanProse(asString(item.label) ?? stance), 60),
            text: clip(cleanProse(asString(item.text) ?? ""), 400),
            share: Math.round((groups[stance].length / total) * 100) / 100,
            agentIds: groups[stance],
        });
    }
    // Groups the model skipped still get a row, so shares always add up.
    for (const key of ["supportive", "neutral", "critical"] as FactionKey[]) {
        if (!seenFactions.has(key) && groups[key].length > 0) {
            factionList.push({
                stance: key,
                label: key[0]!.toUpperCase() + key.slice(1),
                text: "",
                share: Math.round((groups[key].length / total) * 100) / 100,
                agentIds: groups[key],
            });
        }
    }
    return {
        headline,
        summary,
        dynamics: asArray(root.dynamics)
            .map(asRecord)
            .filter((d): d is Record<string, unknown> => !!d && !!asString(d.text))
            .slice(0, 6)
            .map(d => ({
                text: clip(cleanProse(asString(d.text)!), 400),
                postIds: postIds(d.postIds),
            })),
        turningPoints: asArray(root.turningPoints)
            .map(asRecord)
            .filter((d): d is Record<string, unknown> => !!d && !!asString(d.text))
            .slice(0, 5)
            .map(d => ({
                round: Math.max(0, Math.min(world.round, Math.round(asNumber(d.round) ?? 0))),
                text: clip(cleanProse(asString(d.text)!), 300),
                postIds: postIds(d.postIds),
            })),
        factions: factionList,
        watchFor: asArray(root.watchFor)
            .map(w => clip(cleanProse(asString(w) ?? ""), 200))
            .filter(Boolean)
            .slice(0, 4),
    };
}

/** Rank posts for the report's evidence list; exported for hosts that show it. */
export function rankPosts(world: World, limit: number): Array<{ id: string; score: number }> {
    return topPosts(world, limit).map(p => ({ id: p.id, score: engagementScore(p) }));
}
