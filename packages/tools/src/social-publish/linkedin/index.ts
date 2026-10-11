/**
 * LinkedIn REST client for Brand: who the token belongs to, which Pages it
 * administers, posting (with images), read-back of post and Page numbers,
 * and comments. Pure functions over an access token and an injectable
 * `fetch`; the host owns the token's storage and refresh.
 *
 * Every `/rest/*` call sends `Authorization: Bearer`, `LinkedIn-Version` and
 * `X-Restli-Protocol-Version: 2.0.0`. A non-2xx answer throws
 * LinkedInApiError: `authFailed` for 401 (or a 403 about the token itself),
 * `retryable` for 429, 5xx and network failures; a 403 for a missing
 * permission is neither, and its message carries LinkedIn's explanation.
 */
export {
    LinkedInApiError,
    type FetchLike,
    type LinkedInClientOptions,
    type LinkedInComment,
    type LinkedInMember,
    type LinkedInOrganization,
    type LinkedInOrgRole,
    type LinkedInPostStats,
} from "./types";
export { escapeLinkedInCommentary } from "./commentary";
export { getLinkedInMember } from "./members";
export {
    getOrganizationFollowerCount,
    getOrganizationPostStats,
    listAdministeredOrganizations,
} from "./organizations";
export {
    createLinkedInPost,
    deleteLinkedInPost,
    LINKEDIN_MAX_IMAGES,
    linkedInPostUrl,
    uploadLinkedInImage,
} from "./posts";
export { createLinkedInComment, listLinkedInComments } from "./comments";
