import type {
  EmailTemplate,
  Recipient,
  RenderedEmail,
  TemplateReview,
} from "./types";

/**
 * Pipeline interfaces (the frozen seam member.md builds against).
 */

/** Generate a company-grounded template for a company. */
export type GenerateTemplateFn = (args: {
  companyId: number;
  goal?: string;
}) => Promise<{ template: EmailTemplate; companyContext: string }>;

/** Review a template with an LLM (scores only). */
export type ReviewTemplateFn = (args: {
  template: EmailTemplate;
  companyContext: string;
}) => Promise<TemplateReview>;

/** Render one recipient's concrete email. Owned by member.md. */
export type MergeFn = (
  template: EmailTemplate,
  recipient: Recipient,
) => RenderedEmail;

/**
 * Delivers one fully-rendered email. SMTP (nodemailer) or an HTTP provider
 * (Resend/SendGrid) implement this identically — the pipeline is adapter-agnostic.
 */
export interface SendAdapter {
  readonly name: string;
  send(email: {
    to: string;
    subject: string;
    body: string;
    headers?: Record<string, string>;
    /**
     * Stable per-recipient key. Providers that support it (Resend, SendGrid)
     * should pass it through so their own dedup catches a duplicate we failed
     * to catch — the last line of defence before a second email is delivered.
     */
    idempotencyKey?: string;
  }): Promise<{ messageId: string }>;
}
