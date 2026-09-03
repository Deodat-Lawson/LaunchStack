/**
 * Moved to the retrieval brick: it is a retrieval policy, not a vertical
 * capability, and holding it here forced a cross-brick import for every
 * consumer. Kept as a re-export so packages/tools consumers (brand-voice,
 * company-context, claim-evidence, persona) and the pipelines keep their
 * import paths; new code should import
 * @launchstack/retrieval/tools/grounded-retrieval directly.
 */
export * from "@launchstack/retrieval/tools/grounded-retrieval";
