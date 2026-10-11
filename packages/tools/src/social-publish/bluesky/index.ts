/**
 * Bluesky client for Brand: verify a handle + app password, post (with
 * images), read back post counts and profiles, list and send replies. Pure
 * functions over credentials and an injectable `fetch`.
 *
 * Writes go to the account's PDS (`credentials.service`, else
 * BLUESKY_SERVICE_URL, else https://bsky.social) with a session cached per
 * (PDS, identifier) for 55 minutes; reads go to the public AppView with no
 * sign-in. Failures throw BlueskyApiError: `authFailed` for a refused
 * password or session, `retryable` for 429, 5xx and network failures.
 */
export {
    BlueskyApiError,
    type BlueskyCredentials,
    type BlueskyOptions,
    type BlueskyPostRef,
    type BlueskyPostStats,
    type BlueskyProfile,
    type BlueskyReply,
    type FetchLike,
} from "./types";
export { resetBlueskySessions } from "./http";
export {
    BLUESKY_MAX_GRAPHEMES,
    detectFacets,
    graphemeLength,
    type Facet,
    type FacetFeature,
} from "./richtext";
export {
    BLUESKY_MAX_IMAGE_BYTES,
    BLUESKY_MAX_IMAGES,
    blueskyPostUrl,
    createBlueskyPost,
    getBlueskyPostStats,
    getBlueskyProfile,
    listBlueskyReplies,
    verifyBlueskyCredentials,
} from "./client";
