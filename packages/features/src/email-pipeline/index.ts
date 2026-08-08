/** Public entry for the email outreach pipeline. */
export * from "./types";
export * from "./contracts";
export * from "./models";
export * from "./merge";
export * from "./generator";
export * from "./reviewer";
export * from "./send";

/** Campaign lifecycle: generate → approve → deliver, as separate transitions. */
export * from "./prepare";
export * from "./approve";
export * from "./dispatch";
export * from "./automation";

/** One-shot orchestration (legacy `/api/email-pipeline/send`). */
export * from "./run";

export {
  addSuppression,
  isSuppressed,
  getCampaign,
  listCampaigns,
  listTemplateVersions,
  getTemplateVersion,
  getLatestTemplateVersion,
  listApprovals,
  listRecipients,
  upsertRecipients,
  listSendAttempts,
} from "./db";
