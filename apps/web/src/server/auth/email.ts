/**
 * Outbound email seam for auth flows (password reset today; verification if
 * it is ever turned on).
 *
 * Same philosophy as pipelines/src/email/send.ts: the default adapter logs
 * instead of sending, so nothing leaves the machine until a real provider is
 * wired in behind this one function. A self-host without an email provider
 * still gets fully working sign-in/sign-up; a requested reset link lands in
 * the server log, where an operator can hand it to the user directly.
 */

type AuthEmail = {
    to: string;
    subject: string;
    text: string;
};

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
    console.info(`[auth-email] (console adapter) → ${email.to}: ${email.subject}\n${email.text}`);
}
