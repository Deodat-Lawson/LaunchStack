/**
 * @launchstack/pipelines/proposals — an AI grants department for a small
 * organisation: profile it from its own sources, find the funders that fit,
 * turn a funder's request into a checklist, draft each answer from
 * evidence, review the whole, and keep the answers worth reusing.
 *
 * Persistence helpers live in ./db (subpath `./grants/db`); the schema in
 * ./schema (`./grants/schema`).
 */
export * from "./types";
export * from "./evidence";
export * from "./text";
export * from "./requirements";
export * from "./library";
export * from "./review";
export * from "./render";
export * from "./prompts";
export * from "./ports";
export * from "./stages";
export * from "./run";
