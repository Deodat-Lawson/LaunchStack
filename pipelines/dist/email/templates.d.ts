import type { EmailTemplate } from "./types.js";
/**
 * Seed outreach templates (member.md Phase 5).
 *
 * Starting points a user can send as-is or hand to the generator as a shape to
 * imitate. Each one satisfies the deterministic validators out of the box:
 * a subject under the recommended length, `{{unsubscribeUrl}}` and
 * `{{senderIdentity}}` present, and every token declared in `variables`.
 *
 * They stay deliberately plain. Claims live in `{{valueProp}}` /
 * `{{proofPoint}}`, which resolve from the owner's own company data, so a seed
 * can never assert something the company has not actually said about itself.
 */
export interface SeedTemplate {
    id: string;
    name: string;
    description: string;
    template: EmailTemplate;
}
export declare const SEED_TEMPLATES: readonly SeedTemplate[];
export declare function seedTemplate(id: string): SeedTemplate | undefined;
//# sourceMappingURL=templates.d.ts.map
