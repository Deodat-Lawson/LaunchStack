import { Resend } from "resend";

// Lazy-init so the module can be imported without blowing up when
// RESEND_API_KEY is missing (e.g. during build / type-check).
let _resend: Resend | null = null;

export function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error(
        "RESEND_API_KEY is not set. Email sending is unavailable.",
      );
    }
    _resend = new Resend(key);
  }
  return _resend;
}

export const FROM =
  process.env.EMAIL_FROM ?? "Launchstack <noreply@launchstack.ai>";

export const REPLY_TO = process.env.EMAIL_REPLY_TO;
