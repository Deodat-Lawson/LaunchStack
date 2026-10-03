import { getLinkedInAccessToken, getLinkedInApiVersion } from "../config";
import { createLinkedInPost, getLinkedInMember, LinkedInApiError } from "../linkedin";
import type { PublishAdapter, PublishRequest, PublishResult } from "../types";

function failure(error: string, extra: Partial<PublishResult> = {}): PublishResult {
    return { success: false, platform: "linkedin", error, ...extra };
}

/** A LinkedInApiError (or anything else thrown) as a PublishResult the scheduler can act on. */
function fromError(err: unknown, context?: string): PublishResult {
    if (!(err instanceof LinkedInApiError)) {
        return failure(err instanceof Error ? err.message : "Unknown error");
    }
    // 426 (or an explicit version complaint) means the requested
    // `LinkedIn-Version` fell out of LinkedIn's ~12-month support window —
    // point operators at the env override.
    if (!err.authFailed && !err.retryable && (err.status === 426 || /version/i.test(err.body))) {
        const version = getLinkedInApiVersion();
        return failure(
            `LinkedIn rejected API version ${version} (HTTP ${err.status}). Set LINKEDIN_API_VERSION to a currently supported YYYYMM version (LinkedIn supports each version for ~12 months). Details: ${err.body || err.message}`
        );
    }
    return failure(context ? `${context}: ${err.message}` : err.message, {
        authFailed: err.authFailed || undefined,
        retryable: err.retryable || undefined,
    });
}

/**
 * Who to post as. A workspace target carries its own token and author
 * (a member or a Page), so no lookup is needed; without one, the
 * deployment's env token posts as the member it belongs to.
 */
async function resolveAuthor(
    request: PublishRequest
): Promise<{ accessToken: string; authorUrn: string } | PublishResult> {
    const { target } = request;
    if (target) {
        if (target.kind !== "linkedin") {
            return failure(`A ${target.kind} account cannot publish to LinkedIn.`);
        }
        return { accessToken: target.accessToken, authorUrn: target.authorUrn };
    }

    const accessToken = getLinkedInAccessToken();
    if (!accessToken) return failure("LinkedIn credentials not configured");
    try {
        const member = await getLinkedInMember({ accessToken });
        return { accessToken, authorUrn: member.urn };
    } catch (err) {
        return fromError(err, "LinkedIn author lookup failed (check token scopes)");
    }
}

export const linkedinAdapter: PublishAdapter = {
    platform: "linkedin",
    async publish(request): Promise<PublishResult> {
        const author = await resolveAuthor(request);
        if ("success" in author) return author;

        try {
            // Images are uploaded first (owned by the author), then the post
            // goes out through the versioned Posts API (`/rest/posts`).
            const { postUrn, postUrl } = await createLinkedInPost({
                accessToken: author.accessToken,
                authorUrn: author.authorUrn,
                text: request.message,
                media: request.media,
            });
            return { success: true, platform: "linkedin", postId: postUrn, postUrl };
        } catch (err) {
            return fromError(err);
        }
    },
};
