import { type CampaignRecord, type EmailTemplate, type Recipient, type TemplateReview, type TemplateVersion } from "./types.js";
/**
 * Stage 1 of the campaign lifecycle: produce content.
 *
 * Generates (or accepts a human edit of) a template, reviews it, and appends
 * it as an immutable version. Nothing here delivers anything — this stage is
 * probabilistic and freely repeatable, which is exactly why it is separated
 * from the irreversible one.
 */
export interface PrepareEmailCampaignArgs {
    companyId: number;
    /** Omit to create a new campaign; pass an id to append a version to one. */
    campaignId?: number;
    /** Required when creating a campaign. */
    name?: string;
    goal?: string;
    /**
     * A hand-written template. When present the LLM is not called for
     * generation and the version is recorded as `human_edited`.
     */
    template?: EmailTemplate;
    /** Audience, stored now so it can be reviewed before approval. */
    recipients?: Recipient[];
    /** Skip the review call (the review verdict is then null). Default false. */
    skipReview?: boolean;
    actorUserId?: number | null;
}
export interface PreparedEmailCampaign {
    campaign: CampaignRecord;
    version: TemplateVersion;
    template: EmailTemplate;
    review: TemplateReview | null;
}
export declare function prepareEmailCampaign(args: PrepareEmailCampaignArgs): Promise<PreparedEmailCampaign>;
//# sourceMappingURL=prepare.d.ts.map