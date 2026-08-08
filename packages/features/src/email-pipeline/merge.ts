import type { EmailTemplate, Recipient, RenderedEmail } from "./types";

/**
 * Token substitution helpers + a DEFAULT merge. member.md owns the production
 * `merge()`; this default keeps the send path runnable and encodes the
 * "no unresolved {{token}}" contract everything relies on.
 */

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Replace {{token}} with vars[token]; leave unknown tokens intact (so the guard catches them). */
export function renderTokens(
  text: string,
  vars: Record<string, string>,
): string {
  return text.replace(TOKEN_RE, (_m, key: string) =>
    key in vars ? vars[key]! : `{{${key}}}`,
  );
}

/** Any {{tokens}} still present after rendering (must be empty before sending). */
export function unresolvedTokens(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[1]!);
}

/** Default per-recipient renderer. member.md replaces this with the real MergeFn. */
export function simpleMerge(
  template: EmailTemplate,
  recipient: Recipient,
): RenderedEmail {
  const vars: Record<string, string> = {
    firstName: recipient.name?.trim().split(/\s+/)[0] ?? "there",
    recipientCompany: recipient.company?.trim() ?? "your team",
    ...recipient.vars,
  };
  return {
    subject: renderTokens(template.subject, vars),
    body: renderTokens(template.body, vars),
  };
}
