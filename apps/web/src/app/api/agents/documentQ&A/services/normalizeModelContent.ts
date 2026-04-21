/**
 * Legacy re-export shim. The real implementation now lives in
 * @launchstack/core/llm so that features and non-Next hosts can share the
 * same LaTeX post-processor. New call sites should import it directly:
 *
 *   import { normalizeModelContent } from "@launchstack/core/llm";
 */
export { normalizeModelContent } from "@launchstack/core/llm";
export { normalizeModelContent as default } from "@launchstack/core/llm";
