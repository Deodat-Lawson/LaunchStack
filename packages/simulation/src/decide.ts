/**
 * One agent's turn: the observation prompt (OASIS's refresh → "pick what you
 * want to do") and a strict parser for the reply.
 */

import { asArray, asRecord, asString, clampStance, extractJson } from "./json";
import { cleanProse, clip } from "./text";
import {
    DEFAULT_CONFIG,
    WOULD_PAY,
    type Action,
    type ActionType,
    type AgentDecision,
    type AgentState,
    type Budget,
    type BuyingRole,
    type FeedItem,
    type ModelRequest,
    type Persona,
    type SwitchingCost,
    type World,
} from "./types";
import { followeesOf, followersOf, stanceLabel } from "./world";

export const ACTION_TYPES: ActionType[] = [
    "create_post",
    "comment",
    "like",
    "dislike",
    "repost",
    "quote",
    "follow",
    "do_nothing",
];

export const DECISION_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        thought: {
            type: "string",
            description: "One or two private sentences: what you think and why you act.",
        },
        stance: { type: "integer", minimum: -2, maximum: 2 },
        convincedBy: {
            type: ["string", "null"],
            description:
                "If your view moved toward the subject, the id of the feed post that moved it.",
        },
        wouldPay: { type: "string", enum: WOULD_PAY },
        objection: {
            type: ["string", "null"],
            description: "What still holds you back, in a few words, or null.",
        },
        actions: {
            type: "array",
            maxItems: 3,
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    type: { type: "string", enum: ACTION_TYPES },
                    postId: { type: ["string", "null"] },
                    text: { type: ["string", "null"] },
                    handle: { type: ["string", "null"] },
                },
                required: ["type", "postId", "text", "handle"],
            },
        },
    },
    required: ["thought", "stance", "convincedBy", "wouldPay", "objection", "actions"],
};

const BUDGET_LINES: Record<Budget, string> = {
    none: "You have no budget for this: paying for it means taking money from something else.",
    tight: "Money is tight: any new spend has to earn its place.",
    funded: "You have budget for the right tool, and you are careful how you spend it.",
};

const ROLE_LINES: Record<BuyingRole, string> = {
    decides: "You decide what gets bought.",
    influences: "You have a say in what gets bought, but someone else signs off.",
    uses: "You would use it, but you don't decide what gets bought.",
};

const SWITCHING_LINES: Record<SwitchingCost, string> = {
    low: "Switching would be easy for you.",
    medium: "Switching would take real effort.",
    high: "Switching would cost you a lot: time, data and habits built on what you use now.",
};

/** What the persona spends and on what, for worlds whose cast has a wallet. */
function walletLines(p: Persona): string[] {
    const today = p.currentSolution?.trim();
    return [
        today
            ? /^(nothing|none|n\/a)\.?$/i.test(today)
                ? "You don't pay for anything like this today."
                : `For this today you use: ${today}.`
            : "",
        p.budget ? BUDGET_LINES[p.budget] : "",
        p.buyingRole ? ROLE_LINES[p.buyingRole] : "",
        p.switchingCost ? SWITCHING_LINES[p.switchingCost] : "",
        p.objection ? `Your first doubt: "${p.objection}"` : "",
    ].filter(Boolean);
}

/** The persona block shared by turns and interviews. */
export function personaSystem(world: World, agent: AgentState): string {
    const p = agent.persona;
    return [
        `You are ${p.name} (${p.handle}). ${p.role}.`,
        p.bio,
        p.interests.length > 0 ? `You care about: ${p.interests.join(", ")}.` : "",
        ...walletLines(p),
        `Your view on the subject below is currently: ${stanceLabel(agent.stance)}.`,
        "",
        `Subject everyone is reacting to: ${world.situation ?? world.subject}`,
        world.brief ? `Background everyone knows:\n${world.brief}` : "",
    ]
        .filter(line => line !== "")
        .join("\n");
}

const BEHAVIOUR = [
    "You are on a social network. Behave exactly as this person would: their priorities, their " +
        "voice, their patience. Most people scroll past most posts; act only when this person plausibly " +
        "would. Write posts and comments in their voice, at the length people really write online (one " +
        "to three sentences). Never say you are an AI, a model, a character or in a simulation.",
    "Spend the way this person spends. Before you warm to anything, ask what it would cost you: " +
        "money, the time and risk of moving off what you use now, and who you would have to convince. " +
        "Claims, hype and other people's excitement don't move you; specifics, proof and people like " +
        "you vouching from experience might. Liking a post costs nothing and says little about whether " +
        "you would pay. Most people end a round where they started it; change your view only when " +
        "something in your feed gives you a concrete reason.",
].join("\n\n");

function formatFeed(feed: FeedItem[]): string {
    if (feed.length === 0) return "Nothing new in your feed.";
    return feed
        .map(item => {
            const tag =
                item.reason === "pinned"
                    ? " (pinned)"
                    : item.reason === "following"
                      ? " (you follow them)"
                      : "";
            const stats = `${item.likes} likes · ${item.shares} shares · ${item.comments} comments`;
            const head =
                item.kind === "repost" && item.root
                    ? `[${item.postId}] ${item.authorName} ${item.authorHandle}${tag} reposted ${item.root.handle} · ${stats}\n  "${item.root.text}"`
                    : item.kind === "quote" && item.root
                      ? `[${item.postId}] ${item.authorName} ${item.authorHandle}${tag} quoting ${item.root.handle} · ${stats}\n  "${item.text}"\n  > "${item.root.text}"`
                      : `[${item.postId}] ${item.authorName} ${item.authorHandle}${tag} · ${stats}\n  "${item.text}"`;
            const comments = item.recentComments
                .map(c => `  ↳ ${c.handle}: "${c.text}"`)
                .join("\n");
            return comments ? `${head}\n${comments}` : head;
        })
        .join("\n\n");
}

export function buildDecisionRequest(
    world: World,
    agent: AgentState,
    feed: FeedItem[]
): ModelRequest {
    const id = agent.persona.id;
    const round = world.round + 1;
    const memory = agent.memory.slice(-8).map(m => `- Round ${m.round}: ${m.text}`);
    const step = world.config.maxStanceStep ?? DEFAULT_CONFIG.maxStanceStep;
    const prompt = [
        `Round ${round}. You have ${followersOf(world, id).length} followers and follow ${followeesOf(world, id).length} accounts.`,
        "",
        "What you remember:",
        memory.length > 0 ? memory.join("\n") : "- Nothing yet; this is your first look.",
        ...(agent.wouldPay
            ? [`Last time you thought about paying for it, your answer was: ${agent.wouldPay}.`]
            : []),
        ...(agent.objection ? [`What held you back last time: "${agent.objection}"`] : []),
        "",
        "Your feed:",
        formatFeed(feed),
        "",
        `Decide what you do now. Take up to ${world.config.maxActionsPerRound} actions, or do nothing. ` +
            "Use only post ids shown in your feed. To follow someone, give their handle.",
        "Reply with JSON only, in this shape:",
        '{"thought": "…", "stance": 0, "convincedBy": null, "wouldPay": "no", "objection": "…", "actions": [{"type": "like", "postId": "p3", "text": null, "handle": null}]}',
        "Action types: create_post (text), comment (postId, text), like (postId), dislike (postId), " +
            "repost (postId), quote (postId, text), follow (handle), do_nothing.",
        `"stance" is your view on the subject after reading: -2 strongly against, 0 undecided, 2 strongly in favour. It moves at most ${step === 1 ? "one step" : `${step} steps`} from where you are.`,
        '"convincedBy": if your view moved toward the subject, the id of the post in your feed that moved it; otherwise null. A view that warms with no post behind it stays where it was.',
        '"wouldPay": as things stand, would you spend your own or your company\'s money on what is on offer: "yes", "maybe" or "no".',
        '"objection": what still holds you back, in a few words of your own, or null if nothing does.',
    ].join("\n");
    return {
        purpose: "decide",
        system: `${personaSystem(world, agent)}\n\n${BEHAVIOUR}`,
        prompt,
        schema: DECISION_SCHEMA,
        maxOutputTokens: 700,
    };
}

const TYPE_ALIASES: Record<string, ActionType> = {
    create_post: "create_post",
    post: "create_post",
    comment: "comment",
    create_comment: "comment",
    reply: "comment",
    like: "like",
    like_post: "like",
    dislike: "dislike",
    dislike_post: "dislike",
    repost: "repost",
    share: "repost",
    quote: "quote",
    quote_post: "quote",
    follow: "follow",
    do_nothing: "do_nothing",
    nothing: "do_nothing",
    none: "do_nothing",
};

function normalizePostId(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const m = /p?(\d+)/i.exec(raw.trim());
    return m ? `p${m[1]}` : undefined;
}

/**
 * Parse a reply into a decision. Actions that point outside the agent's feed,
 * name an unknown handle, or lack required text are dropped, and so is a
 * `convincedBy` that isn't in the feed. The stance is the one the model asked
 * for; the round's stance guard decides how much of it applies. Returns
 * undefined when the reply is not JSON at all (the caller counts that as a
 * failed turn).
 */
export function parseDecision(
    text: string,
    context: { world: World; agent: AgentState; feed: FeedItem[] }
): AgentDecision | undefined {
    const root = asRecord(extractJson(text));
    if (!root) return undefined;
    const { world, agent, feed } = context;
    const feedIds = new Set(feed.map(f => f.postId));
    const handles = new Map(world.agents.map(a => [a.persona.handle.toLowerCase(), a.persona.id]));
    const max = world.config.maxActionsPerRound;

    const actions: Action[] = [];
    const seen = new Set<string>();
    for (const raw of asArray(root.actions)) {
        if (actions.length >= max) break;
        const item = asRecord(raw);
        if (!item) continue;
        const type = TYPE_ALIASES[(asString(item.type) ?? "").toLowerCase().trim()];
        if (!type) continue;
        const postId = normalizePostId(asString(item.postId) ?? asString(item.post_id));
        const body = cleanProse(asString(item.text) ?? asString(item.content) ?? "");
        let action: Action | undefined;
        switch (type) {
            case "do_nothing":
                break;
            case "create_post":
                if (body) action = { type, text: clip(body, 500) };
                break;
            case "comment":
            case "quote":
                if (postId && feedIds.has(postId) && body) action = { type, postId, text: body };
                break;
            case "like":
            case "dislike":
            case "repost":
                if (postId && feedIds.has(postId)) action = { type, postId };
                break;
            case "follow": {
                const handle = (asString(item.handle) ?? asString(item.agentId) ?? "")
                    .trim()
                    .toLowerCase();
                const target =
                    handles.get(handle.startsWith("@") ? handle : `@${handle}`) ??
                    world.agents.find(a => a.persona.id === handle)?.persona.id;
                if (target && target !== agent.persona.id) action = { type, agentId: target };
                break;
            }
        }
        if (!action) continue;
        const key = JSON.stringify(action);
        if (seen.has(key)) continue;
        seen.add(key);
        actions.push(action);
    }
    const convincedBy = normalizePostId(asString(root.convincedBy) ?? asString(root.convinced_by));
    const pay = (asString(root.wouldPay) ?? asString(root.would_pay))?.trim().toLowerCase();
    const wouldPay = WOULD_PAY.find(w => w === pay);
    const objection = clip(cleanProse(asString(root.objection) ?? ""), 200);
    return {
        thought: clip(cleanProse(asString(root.thought) ?? ""), 280),
        stance: clampStance(root.stance, agent.stance),
        ...(convincedBy && feedIds.has(convincedBy) ? { convincedBy } : {}),
        ...(wouldPay ? { wouldPay } : {}),
        ...(objection && !/^(null|none|nothing)\.?$/i.test(objection) ? { objection } : {}),
        actions: actions.length > 0 ? actions : [{ type: "do_nothing" }],
    };
}
