/** Comments on LinkedIn posts (socialActions/comments): reading them and replying. */
import { decodeId, encodeUrn, linkedInContext, linkedInRequest, mapLimit, readJson } from "./http";
import { LinkedInApiError, type LinkedInClientOptions, type LinkedInComment } from "./types";
import { nonBlank } from "../text";

interface CommentElement {
    commentUrn?: string;
    $URN?: string;
    id?: string;
    actor?: string;
    "actor~"?: {
        localizedName?: string;
        localizedFirstName?: string;
        localizedLastName?: string;
    };
    message?: { text?: string };
    created?: { actor?: string; time?: number };
    parentComment?: string;
    object?: string;
    commentsSummary?: { aggregatedTotalComments?: number; totalFirstLevelComments?: number };
}

const DEFAULT_COUNT = 50;

function toComment(
    el: CommentElement,
    fallback: { objectUrn: string; parentCommentUrn?: string | null }
): LinkedInComment | null {
    const objectUrn = el.object ?? fallback.objectUrn;
    const urn =
        el.commentUrn ?? el.$URN ?? (el.id ? `urn:li:comment:(${objectUrn},${el.id})` : null);
    if (!urn) return null;
    const id = el.id ?? /,([^,()]+)\)$/.exec(urn)?.[1] ?? urn;
    const decorated = el["actor~"];
    const actorName =
        nonBlank(decorated?.localizedName) ??
        nonBlank(
            [decorated?.localizedFirstName, decorated?.localizedLastName].filter(Boolean).join(" ")
        ) ??
        null;
    return {
        urn,
        id,
        objectUrn,
        parentCommentUrn: el.parentComment ?? fallback.parentCommentUrn ?? null,
        actorUrn: el.actor ?? el.created?.actor ?? "",
        actorName,
        text: el.message?.text ?? "",
        createdAt: new Date(el.created?.time ?? 0),
    };
}

function hasReplies(el: CommentElement): boolean {
    const summary = el.commentsSummary;
    return (summary?.aggregatedTotalComments ?? summary?.totalFirstLevelComments ?? 0) > 0;
}

/**
 * Who wrote each comment: LinkedIn returns only the actor's URN unless the
 * request asks it to decorate the actor (`actor~`), which the Comments API
 * documents for current versions. Decoration is being retired version by
 * version, so a request LinkedIn rejects for its projection (400) is made
 * again without one — names then fall back to the host.
 */
const ACTOR_PROJECTION =
    "(elements*(*,actor~(localizedFirstName,localizedLastName,localizedName,vanityName)))";

async function readCommentElements(
    ctx: ReturnType<typeof linkedInContext>,
    targetUrn: string,
    count: number,
    what: string
): Promise<CommentElement[]> {
    const base = `/rest/socialActions/${encodeUrn(targetUrn)}/comments?count=${count}`;
    let res: Response;
    try {
        res = await linkedInRequest(ctx, { path: `${base}&projection=${ACTOR_PROJECTION}`, what });
    } catch (error) {
        if (!(error instanceof LinkedInApiError) || error.status !== 400) throw error;
        res = await linkedInRequest(ctx, { path: base, what });
    }
    const data = await readJson<{ elements?: CommentElement[] }>(res);
    return data?.elements ?? [];
}

/**
 * Comments on a post, newest first. LinkedIn lists first-level comments on
 * the post; when a comment reports replies of its own (`commentsSummary`),
 * those are read too (`includeReplies`, default on), each tolerated if it
 * fails. `actorName` is filled only when LinkedIn decorates the actor
 * (`actor~`); otherwise it is null and the host resolves names it knows.
 */
export async function listLinkedInComments(
    opts: LinkedInClientOptions & { postUrn: string; count?: number; includeReplies?: boolean }
): Promise<LinkedInComment[]> {
    const ctx = linkedInContext(opts);
    const count = opts.count ?? DEFAULT_COUNT;

    const elements = await readCommentElements(
        ctx,
        opts.postUrn,
        count,
        "read the post's comments"
    );

    const comments: LinkedInComment[] = [];
    const threads: LinkedInComment[] = [];
    for (const el of elements) {
        const comment = toComment(el, { objectUrn: opts.postUrn });
        if (!comment) continue;
        comments.push(comment);
        if (opts.includeReplies !== false && hasReplies(el)) threads.push(comment);
    }

    const replies = await mapLimit(threads, 4, async parent => {
        try {
            const nested = await readCommentElements(
                ctx,
                parent.urn,
                count,
                "read replies to a comment"
            );
            return nested
                .map(el =>
                    toComment(el, { objectUrn: parent.objectUrn, parentCommentUrn: parent.urn })
                )
                .filter((c): c is LinkedInComment => c !== null);
        } catch {
            return [];
        }
    });

    const seen = new Set<string>();
    return [...comments, ...replies.flat()]
        .filter(c => (seen.has(c.urn) ? false : (seen.add(c.urn), true)))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Comment on a post as `actorUrn`; with `parentCommentUrn`, a reply to that
 * comment (posted to the parent comment's thread, `object` still the post).
 * Returns LinkedIn's echo of the comment when it sends one; otherwise the id
 * from `x-restli-id` and what was sent.
 */
export async function createLinkedInComment(
    opts: LinkedInClientOptions & {
        actorUrn: string;
        postUrn: string;
        parentCommentUrn?: string | null;
        text: string;
    }
): Promise<LinkedInComment> {
    const ctx = linkedInContext(opts);
    const parent = nonBlank(opts.parentCommentUrn) ?? null;
    const target = parent ?? opts.postUrn;

    const res = await linkedInRequest(ctx, {
        method: "POST",
        path: `/rest/socialActions/${encodeUrn(target)}/comments`,
        json: {
            actor: opts.actorUrn,
            object: opts.postUrn,
            message: { text: opts.text },
            ...(parent ? { parentComment: parent } : {}),
        },
        what: parent ? "reply to the comment" : "comment on the post",
    });

    // x-restli-id carries the new comment's id (sometimes its full URN).
    const header = decodeId(res.headers.get("x-restli-id"));
    const headerUrn = header?.startsWith("urn:li:comment:") ? header : null;
    const headerId = headerUrn ? (/,([^,()]+)\)$/.exec(headerUrn)?.[1] ?? null) : header;

    const echoed = await readJson<CommentElement>(res);
    const fromBody = echoed
        ? toComment(
              {
                  ...echoed,
                  commentUrn: echoed.commentUrn ?? headerUrn ?? undefined,
                  id: echoed.id ?? headerId ?? undefined,
              },
              { objectUrn: opts.postUrn, parentCommentUrn: parent }
          )
        : null;
    if (fromBody) {
        return {
            ...fromBody,
            actorUrn: fromBody.actorUrn || opts.actorUrn,
            text: fromBody.text || opts.text,
            createdAt: echoed?.created?.time ? fromBody.createdAt : new Date(),
        };
    }

    const id = headerId ?? "";
    return {
        urn: headerUrn ?? (id ? `urn:li:comment:(${opts.postUrn},${id})` : ""),
        id,
        objectUrn: opts.postUrn,
        parentCommentUrn: parent,
        actorUrn: opts.actorUrn,
        actorName: null,
        text: opts.text,
        createdAt: new Date(),
    };
}
