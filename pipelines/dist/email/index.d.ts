/** Public entry for the email outreach pipeline. */
export * from "./types.js";
export * from "./contracts.js";
export * from "./models.js";
export * from "./merge.js";
export * from "./generator.js";
export * from "./reviewer.js";
export * from "./send.js";
export * from "./unsubscribe-token.js";
/** Campaign lifecycle: generate → approve → deliver, as separate transitions. */
export * from "./prepare.js";
export * from "./approve.js";
export * from "./dispatch.js";
export * from "./automation.js";
/** One-shot orchestration (legacy `/api/email-pipeline/send`). */
export * from "./run.js";
export { addSuppression, appendTemplateVersion, claimAutomationCampaign, createCampaign, freezeRecipients, reclaimAbandonedAttempts, isSuppressed, getCampaign, listCampaigns, listTemplateVersions, getTemplateVersion, getLatestTemplateVersion, listApprovals, listRecipients, upsertRecipients, listSendAttempts, } from "./db.js";
export * from "./recipients.js";
export * from "./validators.js";
export * from "./company-fields.js";
export * from "./templates.js";
//# sourceMappingURL=index.d.ts.map