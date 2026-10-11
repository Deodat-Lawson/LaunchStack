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

/**
 * Whether the message actually left the machine. Callers that show a link
 * (invitations) use it to tell the person to send that link themselves
 * instead of implying an email is on its way.
 */
export interface AuthEmailResult {
    delivered: boolean;
}

export async function sendAuthEmail(email: AuthEmail): Promise<AuthEmailResult> {
    console.info(`[auth-email] (console adapter) → ${email.to}: ${email.subject}\n${email.text}`);
    return { delivered: false };
}
