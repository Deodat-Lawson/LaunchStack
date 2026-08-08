/** Public entry for the email outreach pipeline. */
export * from "./types";
export * from "./contracts";
export * from "./models";
export * from "./merge";
export * from "./generator";
export * from "./reviewer";
export * from "./send";
export * from "./run";
export { addSuppression, isSuppressed } from "./db";

/* member.md — recipients, validation, company field mapping, seed templates. */
export * from "./recipients";
export * from "./validators";
export * from "./company-fields";
export * from "./templates";
