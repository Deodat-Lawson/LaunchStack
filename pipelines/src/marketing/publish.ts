/**
 * Moved to @launchstack/tools/social-publish (unification PR-6): platform
 * publishing is a shared capability with per-platform adapters, typed config,
 * and token caching. Re-exported so existing imports keep working. New code
 * should import the tool directly.
 */
export {
    publishContent,
    publishToPlatform,
    type PublishRequest,
    type PublishResult,
} from "@launchstack/tools/social-publish";
